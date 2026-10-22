import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {retryVendorSync,vendorSyncSummary} from '../lib/vendor-sync.mjs';
import {manualAutomationStep} from '../lib/manual-automation.mjs';
import {automationStatus} from '../lib/automation-runner.mjs';
import {advanceManualAudit,manualAuditMessage} from '../lib/manual-audit-client.mjs';
const require=createRequire(resolve('package.json'));
const {Miniflare}=require(require.resolve('miniflare',{paths:[require.resolve('wrangler')]}));
async function setup(t){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-05-15',d1Databases:['DB'],r2Buckets:['BUCKET']});t.after(()=>mf.dispose());
 const db=await mf.getD1Database('DB'),bucket=await mf.getR2Bucket('BUCKET');
 await db.prepare('CREATE TABLE records(id TEXT PRIMARY KEY,owner TEXT,entity TEXT,data TEXT,created TEXT,updated TEXT)').run();
 await db.prepare('CREATE TABLE invoices(id TEXT PRIMARY KEY,owner TEXT,source_document_id TEXT,supplier_key TEXT,supplier_name TEXT,invoice_number TEXT,capture_method TEXT,audit_reasons TEXT,audit_status TEXT,analysis_status TEXT,created TEXT,updated TEXT,currency TEXT,invoice_total TEXT,audit_flag TEXT,invoice_date TEXT,audit_ledger_revision INTEGER,audit_rule_version TEXT,UNIQUE(owner,source_document_id))').run();
 const put=async(id,entity,data,owner='jim',created=new Date().toISOString())=>db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)').bind(id,owner,entity,JSON.stringify(data),created,created).run();
 await put('tournas','Supplier',{name:'Tournas',status:'active'});
 return {db,bucket,put};
}
test('manual HTTP steps resume a saved collection cursor and keep completed retries idempotent',async t=>{
 const {db,bucket}=await setup(t);let calls=0;
 const operations={master:async({supplier})=>({vendor_id:supplier.id,url:"https://example.test/master",spreadsheet_id:"master"}),report:async({supplier,type})=>({id:supplier.id+type,name:type+".pdf"}),collect:async({jobId})=>{calls++;assert.equal(jobId,calls===1?undefined:'saved-job');return {job_id:'saved-job',needs_continue:calls===1,totals:{pdfs_saved:2,emails_found:calls,errors:0}};}};
 const context={owner:'jim',db,bucket,operations};
 let run=await manualAutomationStep(context);const id=run.id;assert.equal(run.needs_continue,true);assert.equal(calls,1);
 run=await manualAutomationStep({...context,runId:id});assert.equal(run.id,id);assert.equal(calls,2);assert.equal(run.collected,2,'cumulative collection totals are not added twice');
 for(let step=0;step<20&&run.needs_continue;step++)run=await manualAutomationStep({...context,runId:id});
 assert.equal(run.status,'completed');assert.ok(run.last_successful_run);
 assert.equal((await manualAutomationStep({...context,runId:id})).status,'completed');assert.equal(calls,2);
 assert.equal((await db.prepare("SELECT COUNT(*) n FROM records WHERE entity='AutomationLock'").first()).n,0);
 assert.equal((await manualAutomationStep({...context,owner:'other',runId:id})).status,'failed');
});
test('active locks block a duplicate with visible expiry; expired locks resume without deleting old run history',async t=>{
 const {db,bucket,put}=await setup(t);const expires=Date.now()+60000;
 await put('automation:lock:jim','AutomationLock',{lease:'other-step',expires});
 const blocked=await manualAutomationStep({owner:'jim',db,bucket});assert.equal(blocked.status,'already_running');assert.equal(blocked.lock_expires,expires);assert.match(manualAuditMessage(blocked),/running/);
 await db.prepare('UPDATE records SET data=? WHERE id=?').bind(JSON.stringify({lease:'expired-step',expires:1}),'automation:lock:jim').run();
 const old={status:'running',reason:'manual',stage:'collecting',started:'2026-10-09T00:00:00Z'};await put('old-run','AutomationRun',old);
 const run=await manualAutomationStep({owner:'jim',db,bucket,operations:{master:async()=>({}),report:async()=>({id:"report",name:"report.pdf"}),collect:async()=>({job_id:'recovered-job',needs_continue:true,totals:{pdfs_saved:0}})}});
 assert.equal(run.recovered_from,'old-run');assert.equal(run.collection_since,old.started);
 assert.deepEqual(JSON.parse((await db.prepare('SELECT data FROM records WHERE id=?').bind('old-run').first()).data),old);
});
test('failed collection is visibly resumable and does not claim a successful run',async t=>{
 const {db,bucket}=await setup(t);let fails=true;
 const operations={master:async({supplier})=>({vendor_id:supplier.id,url:"https://example.test/master",spreadsheet_id:"master"}),report:async({supplier,type})=>({id:supplier.id+type,name:type+".pdf"}),collect:async()=>{if(fails)throw Error('Google authorization needs attention.');return {job_id:'retry',needs_continue:false,totals:{pdfs_saved:0,errors:0}};}};
 const context={owner:'jim',db,bucket,operations};const paused=await manualAutomationStep(context);
 assert.equal(paused.status,'needs_retry');assert.equal(paused.needs_continue,false);assert.equal(paused.workflow_index,0);assert.match(manualAuditMessage(paused),/authorization/);assert.equal(paused.last_successful_run,undefined);
 fails=false;const resumed=await manualAutomationStep(context);assert.equal(resumed.id,paused.id);assert.equal(resumed.status,'running');assert.equal(resumed.workflow_index,1);
});
test('one invoice per step, separate sheet sync and existing approved invoices remain unchanged',async t=>{
 const {db,bucket,put}=await setup(t);const stamp=new Date().toISOString();
 await put('doc1','Document',{name:'original1.pdf',file_type:'pdf',source_kind:'gmail',workflow:'tournas'},'jim',stamp);
 await put('doc2','Document',{name:'approved.pdf',file_type:'pdf',source_kind:'gmail',workflow:'tournas'},'jim',stamp);
 await db.prepare('INSERT INTO invoices(id,owner,source_document_id,supplier_key,supplier_name,invoice_number,capture_method,audit_reasons,audit_status,analysis_status,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind('approved','jim','doc2','tournas','Tournas','2','verified','[]','approved','analyzed',stamp,stamp).run();
 const before=await db.prepare('SELECT * FROM invoices WHERE id=?').bind('approved').first();let processes=0,syncs=0;
 const operations={master:async({supplier})=>({vendor_id:supplier.id,url:"https://example.test/master",spreadsheet_id:"master"}),report:async({supplier,type})=>({id:supplier.id+type,name:type+".pdf"}),collect:async()=>({job_id:'job',needs_continue:false,totals:{pdfs_saved:0,errors:0}}),process:async({invoice})=>{processes++;assert.notEqual(invoice.id,'approved');await db.prepare("UPDATE invoices SET capture_method='extraction',supplier_key='tournas',audit_status='needs_review',audit_reasons='[]' WHERE id=?").bind(invoice.id).run();return {status:'saved'};},sync:async()=>{syncs++;return {status:'completed'};}};
 const context={owner:'jim',db,bucket,operations};let run=await manualAutomationStep(context);run.collection_since='2026-10-09T00:00:00Z';await db.prepare('UPDATE records SET data=? WHERE id=?').bind(JSON.stringify(run),run.id).run();
 for(let step=0;step<15&&run.needs_continue;step++)run=await manualAutomationStep({...context,runId:run.id});
 assert.equal(run.status,'completed');assert.equal(processes,1);assert.equal(syncs,2);assert.equal(run.analyzed,1);assert.equal(run.preserved,1);
 assert.deepEqual(await db.prepare('SELECT * FROM invoices WHERE id=?').bind('approved').first(),before);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM invoices').first()).n,2);
});
test('default manual runs queue new and unfinished files but skip already processed history',async t=>{
 const {db,bucket,put}=await setup(t),old='2026-10-01T00:00:00.000Z';
 await put('old-done','Document',{name:'old-done.pdf',file_type:'pdf',source_kind:'gmail',workflow:'tournas',automation_processed_at:old},'jim',old);
 await db.prepare('INSERT INTO invoices(id,owner,source_document_id,capture_method,audit_status,analysis_status,audit_ledger_revision,created) VALUES(?,?,?,?,?,?,?,?)').bind('done','jim','old-done','extraction','needs_review','needs_review',4,old).run();
 await put('old-failed','Document',{name:'old-failed.pdf',file_type:'pdf',source_kind:'gmail',workflow:'tournas',automation_review_reason:'Previous extraction failed'},'jim',old);
 await put('old-pending','Document',{name:'old-pending.pdf',file_type:'pdf',source_kind:'gmail',workflow:'tournas'},'jim',old);
 const context={owner:'jim',db,bucket,operations:{collect:async()=>({needs_continue:false,totals:{}}),master:async()=>({}),report:async()=>({id:'report'})}};
 let run=await manualAutomationStep(context);
 const stamp=new Date(Date.now()+1000).toISOString();
 await put('new-file','Document',{name:'new-file.pdf',file_type:'pdf',source_kind:'gmail',workflow:'tournas'},'jim',stamp);
 for(let n=0;n<8&&run.stage!=='queueing';n++)run=await manualAutomationStep({...context,runId:run.id});
 run=await manualAutomationStep({...context,runId:run.id});
 assert.deepEqual(run.document_ids,['old-failed','old-pending','new-file']);
 assert.equal(run.audit_mode,'incremental');
});
test('date-range and full-rescan scopes select the requested source files and survive resume',async t=>{
 const {db,bucket,put}=await setup(t);
 await put('jan-file','Document',{name:'jan.pdf',file_type:'pdf',source_kind:'gmail',workflow:'tournas',source_email_received:'2026-01-15T12:00:00.000Z'},'jim','2026-10-01T00:00:00.000Z');
 await put('feb-file','Document',{name:'feb.pdf',file_type:'pdf',source_kind:'gmail',workflow:'tournas',source_email_received:'2026-02-01T00:00:00.000Z'},'jim','2026-10-02T00:00:00.000Z');
 const context={owner:'jim',db,bucket,operations:{collect:async()=>({needs_continue:false,totals:{}}),master:async()=>({}),report:async()=>({id:'report'})}};
 let run=await manualAutomationStep({...context,auditMode:'date_range',dateFrom:'2026-01-01',dateTo:'2026-01-31'});
 for(let n=0;n<8&&run.stage!=='queueing';n++)run=await manualAutomationStep({...context,runId:run.id});
 run=await manualAutomationStep({...context,runId:run.id});
 assert.deepEqual(run.document_ids,['jan-file']);assert.equal(run.audit_mode,'date_range');assert.equal(run.date_from,'2026-01-01');
 const invalid=await manualAutomationStep({...context,auditMode:'date_range',dateFrom:'2026-02-30',dateTo:'2026-03-01'});assert.equal(invalid.status,'failed');
 const {db:fullDb,bucket:fullBucket,put:putFull}=await setup(t);
 await putFull('jan-file','Document',{name:'jan.pdf',file_type:'pdf',source_kind:'gmail',workflow:'tournas',source_email_received:'2026-01-15T12:00:00.000Z'},'jim','2026-10-01T00:00:00.000Z');
 await putFull('feb-file','Document',{name:'feb.pdf',file_type:'pdf',source_kind:'gmail',workflow:'tournas',source_email_received:'2026-02-01T00:00:00.000Z'},'jim','2026-10-02T00:00:00.000Z');
 const fullContext={...context,db:fullDb,bucket:fullBucket};
 let full=await manualAutomationStep({...fullContext,auditMode:'full'});
 for(let n=0;n<8&&full.stage!=='queueing';n++)full=await manualAutomationStep({...fullContext,runId:full.id});
 full=await manualAutomationStep({...fullContext,runId:full.id});
 assert.deepEqual(full.document_ids,['jan-file','feb-file']);assert.equal(full.audit_mode,'full');
});
test('client follows durable IDs and stops with honest feedback on busy, failure and connection loss',async()=>{
 const progress=[],bodies=[];let step=0;
 const result=await advanceManualAudit({send:async body=>{bodies.push(body);return step++?{id:'run',status:'completed',needs_continue:false}:{id:'run',status:'running',stage:'collecting',needs_continue:true};},onProgress:row=>progress.push(row)});
 assert.equal(result.status,'completed');assert.deepEqual(bodies,[{},{run_id:'run'}]);assert.equal(progress.length,2);
 const busy=await advanceManualAudit({send:async()=>({status:'already_running',needs_continue:false}),onProgress:()=>{}});assert.match(manualAuditMessage(busy),/running/);
 await assert.rejects(advanceManualAudit({send:async()=>{throw Error('Connection interrupted');},onProgress:()=>{}}),/interrupted/);
 const controller=new AbortController();controller.abort();await assert.rejects(advanceManualAudit({signal:controller.signal,send:async()=>assert.fail('must not send after unmount'),onProgress:()=>{}}),/paused/);
});
test('selected workspace ID stays attached to the audit start and every resumed step',async()=>{
 const bodies=[];let step=0;
 const result=await advanceManualAudit({supplierId:'akron',send:async body=>{bodies.push(body);return step++?{id:'vendor-run',status:'completed',needs_continue:false}:{id:'vendor-run',status:'running',needs_continue:true};},onProgress:()=>{}});
 assert.equal(result.status,'completed');assert.deepEqual(bodies,[{supplier_id:'akron'},{run_id:'vendor-run',supplier_id:'akron'}]);
});
test('automation status returns only the requested workspace run for its scoped resume state',async t=>{
 const {db,put}=await setup(t);
 await put('all-run','AutomationRun',{status:'completed',supplier_id:null});
 await put('akron-run','AutomationRun',{status:'needs_retry',supplier_id:'akron'});
 await put('tournas-run','AutomationRun',{status:'running',supplier_id:'tournas'});
 const status=await automationStatus({owner:'jim',db,supplierId:'akron'});
 assert.equal(status.last_selected_workspace_run.id,'akron-run');assert.equal(status.last_selected_workspace_run.supplier_id,'akron');
});
test('workspace run status scopes saved issues, totals and findings to the selected supplier',async t=>{
 const {db,put}=await setup(t);
 await put('akron-doc','Document',{name:'akron-original.pdf',file_type:'pdf',workflow:'akron',source_kind:'gmail',automation_review_reason:'Akron import failed',automation_sheet_sync_status:'failed'});
 await put('tournas-doc','Document',{name:'tournas-original.pdf',file_type:'pdf',workflow:'tournas',source_kind:'gmail',automation_review_reason:'Tournas import failed',automation_sheet_sync_status:'failed'});
 for(const [id,doc,supplier,total] of [['akron-invoice','akron-doc','Akron','10.00'],['tournas-invoice','tournas-doc','Tournas','99.00']]){
  await db.prepare('INSERT INTO invoices(id,owner,source_document_id,supplier_key,supplier_name,invoice_number,capture_method,audit_reasons,audit_status,analysis_status,created,updated,currency,invoice_total,audit_flag,invoice_date) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,'jim',doc,supplier.toLowerCase(),supplier,'1','extraction',JSON.stringify([{color:'ORANGE',reason:`${supplier} finding`}]),'needs_review','analyzed','2026-10-10','2026-10-10','EUR',total,'ORANGE','2026-10-10').run();
 }
 await put('akron-outcome','CollectionOutcome',{job_id:'akron-job',pdfs_saved:1,document_id:'akron-doc'});
 await put('older-outcome','CollectionOutcome',{job_id:'older-job',pdfs_saved:1,document_id:'tournas-doc'});
 await put('akron-run','AutomationRun',{supplier_id:'akron',status:'completed',collection_job_ids:['akron-job'],document_ids:['akron-doc']});
 const scoped=await automationStatus({owner:'jim',db,supplierId:'akron'});
 assert.equal(scoped.failed_jobs,1);assert.equal(scoped.failed_sheets,1);assert.deepEqual(scoped.total_invoiced_by_currency,[{currency:'EUR',amount:'10',invoice_count:1,invalid_totals:0}]);
 assert.equal(scoped.outstanding_reviews,1);assert.deepEqual(scoped.priority_findings.map(item=>item.supplier),['Akron']);assert.equal(scoped.scope_supplier_id,'akron');assert.equal(scoped.last_selected_workspace_run.finding_details[0].invoice_id,'akron-invoice');assert.equal(scoped.last_selected_workspace_run.finding_details[0].source_document_id,'akron-doc');assert.deepEqual(scoped.last_selected_workspace_run.pdf_details,[{document_id:'akron-doc',name:'akron-original.pdf',workflow:'akron',pages:null}]);
 const overall=await automationStatus({owner:'jim',db});assert.equal(overall.failed_jobs,2);assert.equal(overall.failed_sheets,2);assert.deepEqual(overall.total_invoiced_by_currency,[{currency:'EUR',amount:'109',invoice_count:2,invalid_totals:0}]);
});
test('manual and unattended completion timestamps stay separate and failed attempts cannot claim success',async t=>{
 const {db,put}=await setup(t);
 await put('manual-success','AutomationRun',{reason:'manual',status:'completed',started:'2026-10-09T00:00:00Z',completed:'2026-10-09T00:01:00Z',last_successful_run:'2026-10-09T00:01:00Z'},'jim','2026-10-09T00:00:00Z');
 await put('manual-paused','AutomationRun',{reason:'manual',status:'needs_retry',started:'2026-10-10T00:00:00Z'},'jim','2026-10-10T00:00:00Z');
 const first=await automationStatus({owner:'jim',db});assert.equal(first.last_manual_run.id,'manual-paused');assert.equal(first.last_successful_manual_run,'2026-10-09T00:01:00Z');assert.equal(first.last_successful_unattended_run,null);
 await put('scheduled-success','AutomationRun',{reason:'scheduled',status:'completed',last_successful_run:'2026-10-08T00:01:00Z'},'jim','2026-10-08T00:00:00Z');
 const after=await automationStatus({owner:'jim',db});assert.equal(after.last_successful_unattended_run,'2026-10-08T00:01:00Z');assert.equal(after.last_successful_manual_run,first.last_successful_manual_run);assert.equal(after.last_manual_run.id,'manual-paused');
 assert.equal((await automationStatus({owner:'other',db})).last_manual_run,null);
});
test('recent extraction failures count immediately regardless of legacy processing status, owner scoped and without sheet double-counting',async t=>{
 const {db,put}=await setup(t);
 await put('failed-new','Document',{automation_review_reason:'PDF reader failed',automation_last_attempt:new Date().toISOString()});
 await put('failed-both','Document',{processing_status:'needs_review',automation_review_reason:'Extraction failed',automation_sheet_sync_status:'failed'});
 await put('sheet-only','Document',{automation_sheet_sync_status:'failed'});
 await put('other-failed','Document',{automation_review_reason:'Private failure'},'other');
 const status=await automationStatus({owner:'jim',db});assert.equal(status.failed_jobs,2);assert.equal(status.failed_sheets,2);
 await db.prepare("UPDATE records SET data=? WHERE id='failed-new'").bind(JSON.stringify({automation_review_reason:null})).run();
 assert.equal((await automationStatus({owner:'jim',db})).failed_jobs,1);
});
test('explicit manual retry includes old queued failures immediately and totals keep cents with owner isolation',async t=>{
 const {db,bucket,put}=await setup(t);
 await put('old-doc','Document',{name:'retry.pdf',file_type:'pdf',source_kind:'gmail',workflow:'tournas',automation_review_reason:'Old read failure',automation_last_attempt:new Date().toISOString()},'jim','2026-10-01T00:00:00Z');
 await db.prepare("INSERT INTO invoices(id,owner,source_document_id,analysis_status,audit_status,currency,invoice_total) VALUES('retry','jim','old-doc','awaiting_analysis','not_started',NULL,'18,60')").run();
 await db.prepare("INSERT INTO invoices(id,owner,source_document_id,analysis_status,audit_status,currency,invoice_total) VALUES('private','other','private-doc','needs_review','needs_review',NULL,'999,99')").run();
 const context={owner:'jim',db,bucket,operations:{master:async()=>({}),report:async()=>({id:"report",name:"report.pdf"}),collect:async()=>({job_id:'retry-job',needs_continue:false,totals:{pdfs_saved:0,errors:0}})}};
 let run=await manualAutomationStep(context);
 run=await manualAutomationStep({...context,runId:run.id});
 run=await manualAutomationStep({...context,runId:run.id});
 while(run.stage!=='analyzing'&&run.needs_continue)run=await manualAutomationStep({...context,runId:run.id});
 assert.deepEqual(run.document_ids,['old-doc']);
 assert.deepEqual((await automationStatus({owner:'jim',db})).total_invoiced_by_currency,[{currency:'Unknown currency',amount:'18.6',invoice_count:1,invalid_totals:0}]);
});
test('vendor run never collects or queues another vendor and cannot resume under another selection',async t=>{
 const {db,bucket,put}=await setup(t);await put('akron','Supplier',{name:'Akron',status:'active'});await put('a-doc','Document',{name:'a.pdf',file_type:'pdf',source_kind:'gmail',workflow:'akron'});await put('t-doc','Document',{name:'t.pdf',file_type:'pdf',source_kind:'gmail',workflow:'tournas'});
 const calls=[];const context={owner:'jim',db,bucket,supplierId:'akron',operations:{collect:async({supplier})=>{calls.push(supplier.id);return {needs_continue:false,totals:{}};},master:async({supplier})=>({vendor_id:supplier.id,url:'https://example.test/akron',spreadsheet_id:'akron-master'}),report:async()=>({id:'report',name:'report.pdf'})}};
 let run=await manualAutomationStep(context);for(let i=0;i<10&&run.stage!=='analyzing';i++)run=await manualAutomationStep({...context,runId:run.id});assert.deepEqual(calls,['akron']);assert.deepEqual(run.document_ids,['a-doc']);const wrong=await manualAutomationStep({...context,supplierId:'tournas',runId:run.id});assert.equal(wrong.status,'failed');assert.match(wrong.error,/original vendor selection/);assert.equal(JSON.parse((await db.prepare('SELECT data FROM records WHERE id=?').bind(run.id).first()).data).status,'running');
});

test('repair sync retries only an existing captured invoice for its vendor; summaries preserve last success after a failure',async t=>{
 const {db,put}=await setup(t);await put('akron','Supplier',{name:'Akron'});
 await put('vendor-master:jim:akron','VendorMaster',{vendor_id:'akron',spreadsheet_id:'akron-master',status:'ready'});
 await put('failed-doc','Document',{workflow:'akron',automation_sheet_sync_status:'failed'});
 await put('other-vendor-doc','Document',{workflow:'tournas',automation_sheet_sync_status:'failed'});
 await db.prepare("INSERT INTO invoices(id,owner,source_document_id,capture_method,audit_status,created) VALUES('captured','jim','failed-doc','extraction','needs_review','2026-10-10')").run();
 await db.prepare("INSERT INTO invoices(id,owner,source_document_id,capture_method,audit_status,created) VALUES('wrong-vendor','jim','other-vendor-doc','extraction','needs_review','2026-10-09')").run();
 const supplier={id:'akron',master_id:'akron-master'};let calls=0;
 const context={db,owner:'jim',supplier,sync:async({invoiceId,master})=>{calls++;assert.equal(invoiceId,'captured');assert.equal(master.spreadsheet_id,'akron-master');return {status:'completed',invoice_number:'3129',verified:{invoice_line_rows:1,line_item_rows:0}};}};
 assert.equal((await retryVendorSync({...context,invoiceId:'wrong-vendor'})).done,true);assert.equal(calls,0);
 assert.equal((await retryVendorSync(context)).done,false);assert.equal(calls,1);
 assert.equal((await retryVendorSync(context)).done,true);assert.equal(calls,1);
 const other=JSON.parse((await db.prepare("SELECT data FROM records WHERE id='other-vendor-doc'").first()).data);assert.equal(other.automation_sheet_sync_status,'failed');
 await put('good-sync','SheetsSync',{spreadsheet_id:'akron-master',status:'completed',invoice_number:'3129',completed:'2026-10-10T10:00:00Z',verified:{invoice_line_rows:1,line_item_rows:0}},'jim','2026-10-10T10:00:00Z');
 await put('failed-sync','SheetsSync',{spreadsheet_id:'akron-master',status:'failed',error:'Read quota',completed:'2026-10-10T11:00:00Z'},'jim','2026-10-10T11:00:00Z');
 const summary=await vendorSyncSummary({db,owner:'jim',supplier});assert.equal(summary.last_verified.invoice,'3129');assert.equal(summary.last_attempt.status,'failed');assert.equal(summary.last_verified.verified.invoice_line_rows,1);
 assert.equal((await vendorSyncSummary({db,owner:'other',supplier})).last_verified,null);
});


test('new all-vendor audits use overall routing without changing vendor master mappings',async t=>{
 const {db,bucket,put}=await setup(t);
 await put('akron','Supplier',{name:'Akron',status:'active',master_id:'akron-permanent'});
 const context={owner:'jim',db,bucket,operations:{collect:async()=>({needs_continue:false,totals:{}}),master:async({supplier})=>({vendor_id:supplier.id,scope:'overall',spreadsheet_id:'combined',url:'https://example.test/combined'}),report:async()=>({id:'report'})}};
 let run=await manualAutomationStep(context);
 assert.equal(run.master_scope,'overall');
 for(let n=0;n<12&&run.stage!=='queueing';n++)run=await manualAutomationStep({...context,runId:run.id});
 assert.equal(run.masters.akron.spreadsheet_id,'combined');
 const supplier=JSON.parse((await db.prepare("SELECT data FROM records WHERE id='akron'").first()).data);
 assert.equal(supplier.master_id,'akron-permanent');
});
