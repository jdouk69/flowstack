import {collectAutomationStep,putInvoiceInQueue,processInvoice,markDocument} from './automation-runner.mjs';
import {ensureVendorMaster,syncVendorInvoice} from './vendor-master.mjs';
import {ensureCombinedMaster,syncCombinedInvoice} from './combined-master.mjs';
import {createVendorReport} from './vendor-reports.mjs';

const now=()=>new Date().toISOString();
const read=row=>row?JSON.parse(row.data):null;
const publicRun=run=>({...run,needs_continue:run.status==='running',can_resume:run.status==='needs_retry'});

// One durable step per HTTP request. No detached work or invented background schedule.
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
export async function manualAutomationStep({owner,db,bucket,key,runId,supplierId=null,auditMode='incremental',dateFrom=null,dateTo=null,operations={}}){
 if(!['incremental','date_range','full'].includes(auditMode))return {status:'failed',needs_continue:false,error:'Choose a valid audit scope.'};
 if(auditMode==='date_range'&&(!validDate(dateFrom)||!validDate(dateTo)||dateFrom>dateTo))return {status:'failed',needs_continue:false,error:'Choose a valid start and end date for the email received range.'};
 const collect=operations.collect||collectAutomationStep,process=operations.process||processInvoice,sync=operations.sync||syncVendorInvoice,master=operations.master||ensureVendorMaster,report=operations.report||createVendorReport;
 const lockId='automation:lock:'+owner,lease=crypto.randomUUID(),expires=Date.now()+180000;
 const claimed=await db.prepare("INSERT INTO records(id,owner,entity,data,created,updated) VALUES(?,?,'AutomationLock',?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated WHERE records.owner=excluded.owner AND CAST(json_extract(records.data,'$.expires') AS INTEGER)<? RETURNING id").bind(lockId,owner,JSON.stringify({lease,expires}),now(),now(),Date.now()).first();
 if(!claimed){const lock=read(await db.prepare("SELECT data FROM records WHERE owner=? AND id=? AND entity='AutomationLock'").bind(owner,lockId).first());return {status:'already_running',needs_continue:false,lock_expires:lock?.expires||null,message:'Another audit step is still running. Progress refreshes automatically. Resume only after it finishes or its lock expires.'};}
 let run;
 const save=async()=>{run.updated=now();await db.prepare("INSERT INTO records(id,owner,entity,data,created,updated) VALUES(?,?,'AutomationRun',?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated WHERE records.owner=excluded.owner AND records.entity=excluded.entity").bind(run.id,owner,JSON.stringify(run),run.started,run.updated).run();};
 try{
  const row=runId?await db.prepare("SELECT id,data FROM records WHERE owner=? AND id=? AND entity='AutomationRun'").bind(owner,runId).first():await db.prepare("SELECT id,data FROM records WHERE owner=? AND entity='AutomationRun' AND json_extract(data,'$.execution_mode')='stepped' AND json_extract(data,'$.status') IN ('running','needs_retry') AND COALESCE(json_extract(data,'$.supplier_id'),'')=? ORDER BY created DESC,id DESC LIMIT 1").bind(owner,supplierId||'').first();
  if(runId&&!row)throw Error('This saved audit run was not found for your account.');
  run=row?{...read(row),id:row.id}:null;
  if(run&&run.supplier_id!==undefined&&(run.supplier_id||null)!==supplierId)return {status:'failed',needs_continue:false,error:'Resume this audit from its original vendor selection.'};
  if(run&&run.execution_mode!=='stepped')throw Error('This older run cannot be continued directly. Start a new manual run to resume its saved collection checkpoints.');
  if(run&&['completed','completed_with_errors'].includes(run.status))return publicRun(run);
  if(!run){
   const prior=await db.prepare("SELECT id,data FROM records WHERE owner=? AND entity='AutomationRun' AND json_extract(data,'$.status')='running' ORDER BY created DESC,id DESC LIMIT 1").bind(owner).first();
   const old=read(prior);
   const suppliers=(await db.prepare("SELECT id,data FROM records WHERE owner=? AND entity='Supplier' ORDER BY created,id").bind(owner).all()).results||[];
   if(supplierId&&!suppliers.some(row=>row.id===supplierId))throw Error('Vendor workflow not found.');
   run={supplier_id:supplierId,master_scope:supplierId?'vendor':'overall',audit_mode:auditMode,...(auditMode==='date_range'?{date_from:dateFrom,date_to:dateTo}:{}),masters:{},master_index:0,report_index:0,reports:[],id:'automation:run:'+owner+':'+crypto.randomUUID(),execution_mode:'stepped',status:'running',reason:'manual',started:now(),collection_since:old?.collection_since||old?.started||now(),recovered_from:prior?.id||null,stage:'collecting',workflow_ids:suppliers.filter(row=>(!supplierId||row.id===supplierId)&&!['disabled','paused'].includes(read(row).status)).map(row=>row.id),workflow_index:0,workflow_totals:{},collected:0,queued:0,analyzed:0,preserved:0,findings:0,needs_review:0,failed:0,errors:[],step_errors:[],document_index:0};
   if(!run.workflow_ids.length)throw Error('No active vendor workflows selected.');
   await save();
  }
  run.status='running';run.step_errors=[];
  const supplierRows=(await db.prepare("SELECT id,data FROM records WHERE owner=? AND entity='Supplier' ORDER BY created,id").bind(owner).all()).results||[];
  const supplierById=new Map(supplierRows.map(row=>[row.id,{id:row.id,...read(row)}]));
  if(run.stage==='collecting'){
   const supplier=supplierById.get(run.workflow_ids[run.workflow_index]);
   if(run.workflow_index>=run.workflow_ids.length)run.stage='masters';
   else if(!supplier){run.errors.push('A saved supplier workflow is unavailable.');run.workflow_index++;}
   else{
    run.current_supplier=supplier.name;
    const result=await collect({owner,db,bucket,key,supplier,jobId:run.collection_job_id});
    run.collection_job_id=result.job_id;
    run.workflow_totals[supplier.id]=result.totals||{};
    run.collected=Object.values(run.workflow_totals).reduce((n,value)=>n+Number(value.pdfs_saved||0),0);
    run.emails_checked=Object.values(run.workflow_totals).reduce((n,value)=>n+Number(value.emails_found||0),0);
    if(!result.needs_continue){
     if(result.totals?.errors){run.errors.push(`${supplier.name}: ${result.totals.errors} collection item(s) need review.`);}
     run.workflow_index++;run.collection_job_id=null;
    }
   }
  }else if(run.stage==='masters'){
   const supplier=supplierById.get(run.workflow_ids[run.master_index||0]);
   if(!supplier)run.stage='queueing';
   else{run.current_supplier=supplier.name;const result=await (operations.master||(run.master_scope==='overall'?ensureCombinedMaster:master))({owner,db,key,supplier});(run.masters??={})[supplier.id]=result;if(run.master_scope!=='overall')await db.prepare("UPDATE records SET data=json_set(data,'$.master_url',?,'$.master_status','ready','$.master_id',?,'$.master_error',NULL),updated=? WHERE owner=? AND id=? AND entity='Supplier'").bind(result.url||'',result.spreadsheet_id||'',now(),owner,supplier.id).run();run.master_index=(run.master_index||0)+1;}
  }else if(run.stage==='queueing'){
   const base="r.owner=? AND r.entity='Document' AND json_extract(r.data,'$.file_type')='pdf' AND json_extract(r.data,'$.source_kind')='gmail' AND COALESCE(json_extract(r.data,'$.merged'),0)=0 AND COALESCE(json_extract(r.data,'$.invoice_review_classification'),'')<>'not_invoice' AND json_extract(r.data,'$.workflow') IN (SELECT value FROM json_each(?))";
   let sql=`SELECT r.id,r.data FROM records r WHERE ${base}`,values=[owner,JSON.stringify(run.workflow_ids)];
   if(run.audit_mode==='date_range'){
    sql+=" AND substr(COALESCE(json_extract(r.data,'$.source_email_received'),json_extract(r.data,'$.created_date'),r.created),1,10) BETWEEN ? AND ?";values.push(run.date_from,run.date_to);
   }else if(run.audit_mode!=='full'){
    sql+=" AND (r.created>=? OR COALESCE(json_extract(r.data,'$.automation_review_reason'),'')<>'' OR json_extract(r.data,'$.automation_sheet_sync_status')='failed' OR EXISTS (SELECT 1 FROM invoices i WHERE i.owner=r.owner AND i.source_document_id=r.id AND (i.analysis_status='awaiting_analysis' OR i.audit_status='not_started' OR (i.audit_status='needs_review' AND i.capture_method IS NOT NULL AND i.audit_ledger_revision IS NULL))) OR (NOT EXISTS (SELECT 1 FROM invoices i WHERE i.owner=r.owner AND i.source_document_id=r.id) AND COALESCE(json_extract(r.data,'$.automation_processed_at'),'')=''))";values.push(run.collection_since||run.started);
   }
   sql+=' ORDER BY r.created,r.id LIMIT 501';
   const docs=(await db.prepare(sql).bind(...values).all()).results||[];
   if(docs.length>500)throw Error('More than 500 source files match this run. Narrow the date range or choose a smaller selection; no records were removed.');
   run.document_ids=docs.filter(row=>run.workflow_ids.includes(read(row).workflow)).map(row=>row.id);
   run.queued=run.document_ids.length;run.stage='analyzing';
  }else if(run.stage==='analyzing'){
   const documentId=run.document_ids[run.document_index];
   if(!documentId)run.stage='reports';
   else{
    const source=await db.prepare("SELECT * FROM records WHERE owner=? AND id=? AND entity='Document'").bind(owner,documentId).first();
    if(!source)throw Error('An original source document is unavailable. No invoice was overwritten.');
    const document=read(source);run.current_document=document.name;
    if(document.invoice_review_classification==='not_invoice'){run.skipped=(run.skipped||0)+1;run.document_index++;}else{
    const invoice=await putInvoiceInQueue(db,owner,documentId);
    if(!invoice){run.skipped=(run.skipped||0)+1;run.document_index++;}
    else
    if(invoice.audit_status==='excluded'){run.preserved++;run.document_index++;}
    else if(invoice.audit_status==='approved'){run.preserved++;run.pending_sync={invoice_id:invoice.id,document_id:documentId};run.stage='syncing';}
    else{
     try{
      const result=await process({owner,db,bucket,invoice,supplierById});
      if(result.status==='skipped'){run.skipped=(run.skipped||0)+1;run.document_index++;}else{
      if(!['saved','preserved'].includes(result.status))throw Error('Invoice capture did not complete.');
      await markDocument(db,owner,source,{automation_review_reason:null,automation_last_attempt:now()});
      const current=await db.prepare('SELECT * FROM invoices WHERE owner=? AND id=?').bind(owner,invoice.id).first();
      if(result.status==='preserved')run.preserved++;else{
       run.analyzed++;run.needs_review++;
       let reasons=[];try{reasons=JSON.parse(current.audit_reasons||'[]').filter(reason=>['RED','ORANGE','YELLOW'].includes(reason.color));}catch{}
       run.findings+=reasons.length;
       if(reasons.length){run.finding_details??=[];run.finding_details.push({invoice_id:current.id,source_document_id:documentId,invoice_number:current.invoice_number||'Number not extracted',supplier:current.supplier_name||supplierById.get(read(source).workflow)?.name||'Supplier needs review',invoice_date:current.invoice_date||null,reasons:reasons.slice(0,3)});}
      }
      run.pending_sync={invoice_id:invoice.id,document_id:documentId};run.stage='syncing';
      }
     }catch(error){run.failed++;run.needs_review++;run.errors.push(`${document.name||invoice.id}: ${String(error.message||error).slice(0,500)}`);await markDocument(db,owner,source,{automation_review_reason:String(error.message||error).slice(0,500),automation_last_attempt:now()});run.document_index++;}
    }
   }
   }
  }else if(run.stage==='syncing'){
   const invoice=await db.prepare('SELECT * FROM invoices WHERE owner=? AND id=?').bind(owner,run.pending_sync.invoice_id).first();
   const source=await db.prepare("SELECT * FROM records WHERE owner=? AND id=? AND entity='Document'").bind(owner,run.pending_sync.document_id).first();
   if(!invoice||!source)throw Error('The source or invoice is unavailable for synchronization.');
   let result={status:'not_configured'};
   try{const supplier=supplierById.get(read(source).workflow);if(!supplier)throw Error('Vendor workflow unavailable for synchronization.');result=await (operations.sync||(run.master_scope==='overall'?syncCombinedInvoice:sync))({owner,db,invoiceId:invoice.id,key,supplier,master:run.masters?.[supplier.id],origin:'https://flowstack.jimdoukakis.chatgpt.site'});if(result.status!=='completed')throw Error('Master synchronization did not verify completion.');(run.sheet_sync??=[]).push({vendor_id:supplier.id,invoice:invoice.invoice_number||invoice.id,completed:result.completed,verified:result.verified,skipped:!!result.skipped});}
   catch(error){result={status:'failed'};run.errors.push(`Google Sheets — invoice ${invoice.invoice_number||invoice.id}: ${String(error.message||error).slice(0,400)}`);run.failed++;}
   await markDocument(db,owner,source,{automation_sheet_sync_status:result.status,automation_processed_at:now()});
   run.pending_sync=null;run.document_index++;run.stage='analyzing';
  }
  if(run.stage==='reports'){
   const index=run.report_index||0,supplier=supplierById.get(run.workflow_ids[Math.floor(index/2)]);
   if(!supplier)run.stage='complete';
   else{run.current_supplier=supplier.name;const created=await report({owner,db,bucket,key,supplier,run,type:index%2?'technical':'investigation'});(run.reports??=[]).push({id:created.id,name:created.name,url:'/api/flow/documents/'+encodeURIComponent(created.id),drive_url:created.drive_url||null});run.report_index=index+1;}
  }
  if(run.stage==='complete'){
   run.status=run.errors.length?'completed_with_errors':'completed';run.completed=now();run.last_successful_run=run.errors.length?null:run.completed;
  }
  await save();return publicRun(run);
 }catch(error){
  if(!run)return {status:'failed',needs_continue:false,error:String(error.message||error)};
  run.status='needs_retry';run.step_errors=[String(error.message||error).slice(0,600)];await save();return publicRun(run);
 }finally{
  // Only release this request's lease; never clear another active run's lock.
  await db.prepare("DELETE FROM records WHERE id=? AND owner=? AND json_extract(data,'$.lease')=?").bind(lockId,owner,lease).run();
 }
}
