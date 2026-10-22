import {collectWorkflow} from './workflow-collection.mjs';
import {invoiceReview} from './invoice-review.mjs';
import {invoiceBatches} from './invoice-batch.mjs';
import {analyzePages} from './extraction/suppliers/tournas.mjs';
import {serverPages} from './extraction/server-pdf.mjs';
import {extractionCaptureDraft} from './extraction/capture-draft.mjs';
import {decimal,formatDecimal} from './invoice-audit.mjs';
import {syncTournasInvoice} from './tournas-master-sync.mjs';

const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store'}});
const now=()=>new Date().toISOString();
const runId=owner=>'automation:run:'+owner+':'+crypto.randomUUID();
const internal=(url,body,method='POST')=>new Request('https://internal.local/api/flow/'+url,{method,headers:{origin:'https://internal.local','content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
const readData=row=>row?JSON.parse(row.data):null;
async function saveRecord(db,owner,id,entity,data){
 const stamp=now();
 await db.prepare("INSERT INTO records(id,owner,entity,data,created,updated) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated WHERE records.owner=excluded.owner AND records.entity=excluded.entity").bind(id,owner,entity,JSON.stringify(data),stamp,stamp).run();
}
async function responseData(response){const body=await response.json();if(!response.ok)throw Error(body.error||`Stage failed (${response.status})`);return body;}
async function callCollect({owner,db,bucket,key,supplier,mode='incremental'}){
 const params={owner,db,bucket,key};
 const saved=await db.prepare("SELECT data FROM records WHERE owner=? AND id=? AND entity='CollectionJob'").bind(owner,'collection:job:'+owner+':'+supplier.id).first();
 let retryFailed=false;if(saved){const previous=JSON.parse(saved.data);if(previous.done&&previous.run_id){const failed=await db.prepare("SELECT COUNT(*) AS n FROM records WHERE owner=? AND entity='CollectionOutcome' AND json_extract(data,'$.job_id')=? AND json_extract(data,'$.errors')>0").bind(owner,previous.run_id).first();retryFailed=Number(failed?.n||0)>0;}}
 let body=await responseData(await collectWorkflow(internal('functions/downloadPdfs',{supplier_id:supplier.id,mode,...(retryFailed?{retry_failed:true}:{})}),params));
 let passes=0;
 while(body.needs_continue&&passes++<200){
  body=await responseData(await collectWorkflow(internal('functions/downloadPdfs',{supplier_id:supplier.id,job_id:body.job_id}),params));
 }
 if(body.needs_continue)throw Error(`Collection for ${supplier.name} reached its safe continuation limit; resume on the next daily run.`);
 return body.totals||{};
}
export async function collectAutomationStep({owner,db,bucket,key,supplier,jobId}){
 const saved=await db.prepare("SELECT data FROM records WHERE owner=? AND id=? AND entity='CollectionJob'").bind(owner,'collection:job:'+owner+':'+supplier.id).first();
 let retryFailed=false;
 if(!jobId&&saved){const previous=JSON.parse(saved.data);if(previous.done&&previous.run_id){const failed=await db.prepare("SELECT COUNT(*) AS n FROM records WHERE owner=? AND entity='CollectionOutcome' AND json_extract(data,'$.job_id')=? AND json_extract(data,'$.errors')>0").bind(owner,previous.run_id).first();retryFailed=Number(failed?.n||0)>0;}}
 return responseData(await collectWorkflow(internal('functions/downloadPdfs',{supplier_id:supplier.id,mode:'incremental',...(jobId?{job_id:jobId}:{}),...(retryFailed?{retry_failed:true}:{})}),{owner,db,bucket,key,maxAttachments:1,maxMessages:2}));
}
export function supplierTemplate(name){
 const text=String(name||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
 if(/tournas|tourn[aά]ς|τουρνα/.test(text))return 'tournas';
 if(/akron|ακρον/.test(text))return 'akron';
 if(/ergobeton|εργομπετον/.test(text))return 'ergobeton';
 return null;
}
export async function putInvoiceInQueue(db,owner,documentId){
 const source=await db.prepare("SELECT data FROM records WHERE owner=? AND id=? AND entity='Document'").bind(owner,documentId).first();
 if(!source||readData(source).invoice_review_classification==='not_invoice')return null;
 const id=crypto.randomUUID(),stamp=now();
 await db.prepare("INSERT INTO invoices(id,owner,source_document_id,analysis_status,audit_status,created,updated) SELECT ?,?,?, 'awaiting_analysis','not_started',?,? WHERE EXISTS(SELECT 1 FROM records WHERE id=? AND owner=? AND entity='Document' AND COALESCE(json_extract(data,'$.invoice_review_classification'),'')<>'not_invoice') ON CONFLICT(owner,source_document_id) DO NOTHING").bind(id,owner,documentId,stamp,stamp,documentId,owner).run();
 return db.prepare('SELECT * FROM invoices WHERE owner=? AND source_document_id=?').bind(owner,documentId).first();
}
export async function markDocument(db,owner,row,patch){
 await db.prepare("UPDATE records SET data=json_patch(data,?),updated=? WHERE id=? AND owner=? AND entity='Document' AND COALESCE(json_extract(data,'$.invoice_review_classification'),'')<>'not_invoice'").bind(JSON.stringify(patch),now(),row.id,owner).run();
}
// Apply exactly the same completeness checks as manual extraction capture.
// Missing printed supplier/currency stay unknown and produce review findings.
export function validateAutomaticPages(pages,template){
 return extractionCaptureDraft({pages:pages.length,merged:false},{pages:JSON.stringify(pages),analysis:JSON.stringify(analyzePages(pages,template)),revision:0});
}
export function invoiceTotals(rows){
 const groups=new Map();
 for(const row of rows){
  const currency=String(row.currency||'').trim(),key=/^(?:€|EUR)$/i.test(currency)?'EUR':currency||'Unknown currency';
  const group=groups.get(key)||{amount:0n,invalid:0,count:0};
  const amount=decimal(row.invoice_total);
  if(amount===null)group.invalid++;else{group.amount+=amount;group.count++;}
  groups.set(key,group);
 }
 return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([currency,group])=>({currency,amount:formatDecimal(group.amount),invoice_count:group.count,invalid_totals:group.invalid}));
}
export async function processInvoice({owner,db,bucket,invoice,supplierById}){
 if(invoice.capture_method){
  if(invoice.audit_status==='needs_review')await responseData(await invoiceReview(internal('invoices/'+invoice.id+'/audit',{revision:invoice.revision}),{db,owner,id:invoice.id,action:'audit'}));
  return {status:'preserved',invoice_id:invoice.id};
 }
 const sourceRow=await db.prepare("SELECT * FROM records WHERE owner=? AND id=? AND entity='Document'").bind(owner,invoice.source_document_id).first();
 if(!sourceRow)throw Error('Original source document is missing.');
 const document=readData(sourceRow);
 if(document.invoice_review_classification==='not_invoice')return {status:'skipped',reason:'Skipped — not an invoice.'};
 if(document.storage_kind==='drive_reference'||document.merged||document.file_type!=='pdf'||!document.key)throw Error('This source is a Drive reference, merged file, or non-PDF and needs manual review.');
 const supplier=supplierById.get(document.workflow),template=supplierTemplate(supplier?.name);
 if(!template)throw Error('Supplier has no verified automatic invoice parser. Original remains queued for manual review.');
 const object=await bucket.get(document.key);if(!object)throw Error('Original PDF is unavailable in secure storage.');
 const bytes=new Uint8Array(await object.arrayBuffer());
 const pages=await serverPages(bytes);
 validateAutomaticPages(pages,template);
 const batchResult=await responseData(await invoiceBatches(internal('invoice-batches',{confirmed:true,template,invoice_ids:[invoice.id]}),{db,bucket,owner}));
 const batch=batchResult.batch;
 const result=await responseData(await invoiceBatches(internal('invoice-batches',{id:batch.id,invoice_id:invoice.id,action:'process',pages}),{db,bucket,owner}));
 if(!['saved','preserved'].includes(result.item.status))throw Error(result.item.reason||'Invoice processing needs review.');
 return {status:result.item.status,audit_flag:result.item.flag||null,invoice_id:invoice.id,batch_id:batch.id};
}

export async function runDailyAutomation({owner,db,bucket,key,reason='scheduled'}){
 const lockId='automation:lock:'+owner,lease=crypto.randomUUID(),stamp=now(),expiry=Date.now()+10*60*1000;
 const claimed=await db.prepare("INSERT INTO records(id,owner,entity,data,created,updated) VALUES(?,?,'AutomationLock',?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated WHERE records.owner=excluded.owner AND CAST(json_extract(records.data,'$.expires') AS INTEGER)<? RETURNING id").bind(lockId,owner,JSON.stringify({lease,expires:expiry}),stamp,stamp,Date.now()).first();
 if(!claimed)return {status:'already_running'};
 const id=runId(owner),run={status:'running',reason,started:stamp,stage:'starting',collected:0,queued:0,analyzed:0,findings:0,needs_review:0,failed:0,errors:[]};
 await saveRecord(db,owner,id,'AutomationRun',run);
 const checkpoint=async(stage,patch={})=>{Object.assign(run,patch,{stage,updated:now()});await saveRecord(db,owner,id,'AutomationRun',run);};
 try{
  const suppliers=(await db.prepare("SELECT id,data FROM records WHERE owner=? AND entity='Supplier' ORDER BY created,id").bind(owner).all()).results||[];
  const active=suppliers.map(row=>({id:row.id,...readData(row)})).filter(s=>s.status!=='disabled'&&s.status!=='paused');
  const supplierById=new Map(active.map(s=>[s.id,s]));
  await checkpoint('collecting',{workflow_count:active.length});
  for(const supplier of active){
   try{const result=await callCollect({owner,db,bucket,key,supplier});run.collected+=Number(result.pdfs_saved||0);if(result.errors)run.errors.push(`${supplier.name}: ${result.errors} collection item(s) failed.`);}
   catch(error){run.errors.push(`${supplier.name}: ${String(error.message||error).slice(0,400)}`);}
   await checkpoint('collecting');
  }
  await checkpoint('queueing');
  const retryBefore=new Date(Date.now()-60*60*1000).toISOString();
  const docs=(await db.prepare("SELECT r.id,r.data FROM records r WHERE r.owner=? AND r.entity='Document' AND json_extract(r.data,'$.file_type')='pdf' AND json_extract(r.data,'$.source_kind')='gmail' AND COALESCE(json_extract(r.data,'$.merged'),0)=0 AND COALESCE(json_extract(r.data,'$.invoice_review_classification'),'')<>'not_invoice' AND (r.created>=? OR EXISTS(SELECT 1 FROM invoices i WHERE i.owner=r.owner AND i.source_document_id=r.id AND i.analysis_status='awaiting_analysis' AND COALESCE(json_extract(r.data,'$.automation_last_attempt'),'')<?) OR json_extract(r.data,'$.automation_sheet_sync_status')='failed') ORDER BY r.created,r.id LIMIT 500").bind(owner,run.started,retryBefore).all()).results||[];
  const awaiting=[];
  for(const row of docs){const document=readData(row);if(!supplierById.has(document.workflow))continue;try{const invoice=await putInvoiceInQueue(db,owner,row.id);if(invoice)awaiting.push(invoice);}catch(error){run.errors.push(`Queue ${document.name||row.id}: ${error.message}`);}}
  const queued=await db.prepare("SELECT COUNT(*) AS n FROM invoices i JOIN records r ON r.id=i.source_document_id AND r.owner=i.owner WHERE i.owner=? AND COALESCE(json_extract(r.data,'$.invoice_review_classification'),'')<>'not_invoice' AND analysis_status='awaiting_analysis' AND audit_status='not_started'").bind(owner).first();run.queued=Number(queued?.n||0);
  await checkpoint('analyzing');
  for(const invoice of awaiting.slice(0,100)){
   const source=docs.find(row=>row.id===invoice.source_document_id);const doc=source?readData(source):{};
   let sheetAttempted=false;
   try{
    const result=await processInvoice({owner,db,bucket,invoice,supplierById});
    if(result.status==='skipped'){run.skipped=(run.skipped||0)+1;await checkpoint('analyzing');continue;}
    const current=await db.prepare('SELECT * FROM invoices WHERE owner=? AND id=?').bind(owner,invoice.id).first();
    if(current?.capture_method){
     run.analyzed++;run.needs_review++;
     try{run.findings+=JSON.parse(current.audit_reasons||'[]').filter(reason=>['YELLOW','ORANGE','RED'].includes(reason.color)).length;}catch{}
     let sheetSync=null;
     if(String(current.supplier_key||'').toLowerCase()==='tournas'||/tournas|τουρνα/i.test(current.supplier_name||'')){sheetAttempted=true;sheetSync=await syncTournasInvoice({owner,db,invoiceId:invoice.id,key,origin:'https://flowstack.jimdoukakis.chatgpt.site'});}
     if(source)await markDocument(db,owner,source,{processing_status:'needs_review',automation_review_reason:null,automation_batch_id:result.batch_id||null,automation_processed_at:now(),automation_sheet_sync_status:sheetSync?.status||'not_configured'});
    }
   }
   catch(error){run.failed++;run.needs_review++;run.errors.push(`${doc.name||invoice.id}: ${String(error.message||error).slice(0,500)}`);if(source)await markDocument(db,owner,source,{processing_status:'needs_review',automation_review_reason:String(error.message||error).slice(0,500),automation_last_attempt:now(),...(sheetAttempted?{automation_sheet_sync_status:'failed'}:{})});}
   await checkpoint('analyzing');
  }
  const end=now();run.status=run.errors.length?'completed_with_errors':'completed';run.stage='complete';run.completed=end;run.last_successful_run=run.errors.length?null:end;run.outstanding_reviews=run.needs_review;
  await saveRecord(db,owner,id,'AutomationRun',run);
  return {id,...run};
 }catch(error){
  run.status='failed';run.stage=run.stage||'failed';run.failed++;run.errors.push(String(error.message||error).slice(0,1000));run.completed=now();
  await saveRecord(db,owner,id,'AutomationRun',run);return {id,...run};
 }finally{
  await db.prepare("DELETE FROM records WHERE id=? AND owner=? AND json_extract(data,'$.lease')=?").bind(lockId,owner,lease).run();
 }
}

export async function automationStatus({owner,db,supplierId=null}){
 const rows=(await db.prepare("SELECT id,data,created FROM records WHERE owner=? AND entity='AutomationRun' ORDER BY created DESC,id DESC LIMIT 20").bind(owner).all()).results||[];
 const latest=rows.map(row=>({id:row.id,...readData(row),created:row.created}));
 const allRun=await db.prepare("SELECT id,data FROM records WHERE owner=? AND entity='AutomationRun' AND COALESCE(json_extract(data,'$.supplier_id'),'')='' ORDER BY created DESC,id DESC LIMIT 1").bind(owner).first();
 const selectedRun=supplierId?await db.prepare("SELECT id,data FROM records WHERE owner=? AND entity='AutomationRun' AND json_extract(data,'$.supplier_id')=? ORDER BY created DESC,id DESC LIMIT 1").bind(owner,supplierId).first():null;
 const enrichRun=async row=>{
  if(!row)return null;
  const run={id:row.id,...readData(row)};
  let collectedIds=Array.isArray(run.collected_document_ids)?run.collected_document_ids:[];
  if(!Array.isArray(run.collected_document_ids)&&Array.isArray(run.collection_job_ids)&&run.collection_job_ids.length){
   const outcomes=(await db.prepare("SELECT data FROM records WHERE owner=? AND entity='CollectionOutcome' AND json_extract(data,'$.job_id') IN (SELECT value FROM json_each(?)) AND json_extract(data,'$.pdfs_saved')>0 ORDER BY created,id").bind(owner,JSON.stringify(run.collection_job_ids)).all()).results||[];
   collectedIds=outcomes.map(row=>readData(row)?.document_id).filter(Boolean);
  }else if(!Array.isArray(run.collected_document_ids)&&!Array.isArray(run.collection_job_ids)&&run.reason==='manual'&&run.started){
   const outcomes=(await db.prepare("SELECT data FROM records WHERE owner=? AND entity='CollectionOutcome' AND created>=? AND created<=? AND json_extract(data,'$.pdfs_saved')>0 ORDER BY created,id").bind(owner,run.started,run.completed||run.updated||now()).all()).results||[];
   collectedIds=outcomes.map(row=>readData(row)?.document_id).filter(Boolean);
  }
  run.collected_document_ids=[...new Set(collectedIds)];
  if(run.collected_document_ids.length){
   const documents=(await db.prepare("SELECT id,data FROM records WHERE owner=? AND entity='Document' AND id IN (SELECT value FROM json_each(?)) AND json_extract(data,'$.file_type')='pdf' ORDER BY created,id").bind(owner,JSON.stringify(run.collected_document_ids)).all()).results||[];
   run.pdf_details=documents.map(document=>{const data=readData(document);return {document_id:document.id,name:data.name||'Original PDF',workflow:data.workflow||null,pages:Number.isInteger(data.pages)?data.pages:null};});
  }else run.pdf_details=[];
  if(Array.isArray(run.document_ids)&&run.document_ids.length){
   const invoices=(await db.prepare("SELECT id,source_document_id,invoice_number,invoice_date,supplier_name,audit_reasons FROM invoices WHERE owner=? AND source_document_id IN (SELECT value FROM json_each(?)) AND audit_status!='excluded' ORDER BY updated DESC").bind(owner,JSON.stringify(run.document_ids)).all()).results||[];
   const invoiceById=new Map(invoices.map(invoice=>[invoice.id,invoice]));
   if(Array.isArray(run.finding_details))run.finding_details=run.finding_details.map(item=>({...item,source_document_id:item.source_document_id||invoiceById.get(item.invoice_id)?.source_document_id||null}));
   else{
   run.finding_details=[];
   for(const invoice of invoices){let reasons=[];try{reasons=JSON.parse(invoice.audit_reasons||'[]').filter(reason=>['RED','ORANGE','YELLOW'].includes(reason.color));}catch{}if(reasons.length)run.finding_details.push({invoice_id:invoice.id,source_document_id:invoice.source_document_id,invoice_number:invoice.invoice_number||'Number not extracted',supplier:invoice.supplier_name||'Supplier needs review',invoice_date:invoice.invoice_date||null,reasons:reasons.slice(0,3)});}
   }
  }
  return run;
 };
 const selectedRunStatus=await enrichRun(selectedRun),allRunStatus=await enrichRun(allRun);
 const scopedRuns=supplierId?latest.filter(run=>run.supplier_id===supplierId):latest.filter(run=>!run.supplier_id);
 const lastSuccess=scopedRuns.find(run=>run.status==='completed'&&run.last_successful_run)?.last_successful_run||null;
 const runScope=supplierId?" AND json_extract(data,'$.supplier_id')=?":" AND COALESCE(json_extract(data,'$.supplier_id'),'')=''";
 const runScopeValues=supplierId?[owner,supplierId]:[owner];
 const lastManual=await db.prepare(`SELECT id,data FROM records WHERE owner=? AND entity='AutomationRun' AND json_extract(data,'$.reason')='manual'${runScope} ORDER BY created DESC,id DESC LIMIT 1`).bind(...runScopeValues).first();
 const manualSuccess=await db.prepare(`SELECT data FROM records WHERE owner=? AND entity='AutomationRun' AND json_extract(data,'$.reason')='manual' AND json_extract(data,'$.status')='completed'${runScope} ORDER BY created DESC,id DESC LIMIT 1`).bind(...runScopeValues).first();
 const unattendedSuccess=supplierId?null:await db.prepare("SELECT data FROM records WHERE owner=? AND entity='AutomationRun' AND json_extract(data,'$.reason')='scheduled' AND json_extract(data,'$.status')='completed' ORDER BY created DESC,id DESC LIMIT 1").bind(owner).first();
 const totals=(await db.prepare(`SELECT i.currency,i.invoice_total FROM invoices i ${supplierId?"JOIN records r ON r.owner=i.owner AND r.id=i.source_document_id AND json_extract(r.data,'$.workflow')=?":""} WHERE i.owner=? AND i.invoice_total IS NOT NULL AND i.audit_status!='excluded'`).bind(...(supplierId?[supplierId,owner]:[owner])).all()).results||[];
 const totalGroups=invoiceTotals(totals);
 const scope=" AND json_extract(data,'$.workflow')=?";
 const docScope=supplierId?scope:'';
 const counts=await db.prepare(`SELECT COUNT(*) AS invoices_collected FROM records WHERE owner=? AND entity='Document' AND json_extract(data,'$.source_kind')='gmail'${docScope}`).bind(...(supplierId?[owner,supplierId]:[owner])).first();
 const analyzed=await db.prepare(`SELECT COUNT(*) AS invoices_analyzed FROM invoices i ${supplierId?"JOIN records r ON r.owner=i.owner AND r.id=i.source_document_id AND json_extract(r.data,'$.workflow')=?":""} WHERE i.owner=? AND i.capture_method IS NOT NULL`).bind(...(supplierId?[supplierId,owner]:[owner])).first();
 const reviews=await db.prepare(`SELECT COUNT(*) AS outstanding_reviews FROM invoices i ${supplierId?"JOIN records r ON r.owner=i.owner AND r.id=i.source_document_id AND json_extract(r.data,'$.workflow')=?":""} WHERE i.owner=? AND i.audit_status='needs_review'`).bind(...(supplierId?[supplierId,owner]:[owner])).first();
 const failed=await db.prepare(`SELECT COUNT(*) AS failed_jobs FROM records WHERE owner=? AND entity='Document' AND COALESCE(json_extract(data,'$.automation_review_reason'),'')!=''${docScope}`).bind(...(supplierId?[owner,supplierId]:[owner])).first();
 const sync=await db.prepare(`SELECT COUNT(*) AS failed_sheets FROM records WHERE owner=? AND entity='Document' AND json_extract(data,'$.automation_sheet_sync_status')='failed'${docScope}`).bind(...(supplierId?[owner,supplierId]:[owner])).first();
 const pending=await db.prepare(`SELECT COUNT(*) AS n FROM invoices i JOIN records r ON r.id=i.source_document_id AND r.owner=i.owner WHERE i.owner=? AND COALESCE(json_extract(r.data,'$.invoice_review_classification'),'')<>'not_invoice' AND analysis_status='awaiting_analysis'${supplierId?" AND json_extract(r.data,'$.workflow')=?":""}`).bind(...(supplierId?[owner,supplierId]:[owner])).first();
 const findings=(await db.prepare(`SELECT i.id,i.supplier_key,i.supplier_name,i.invoice_number,i.invoice_date,i.audit_flag,i.audit_reasons FROM invoices i ${supplierId?"JOIN records r ON r.owner=i.owner AND r.id=i.source_document_id AND json_extract(r.data,'$.workflow')=?":""} WHERE i.owner=? AND i.audit_status='needs_review' AND i.audit_flag IN ('RED','ORANGE','YELLOW') ORDER BY CASE i.audit_flag WHEN 'RED' THEN 0 WHEN 'ORANGE' THEN 1 ELSE 2 END,i.updated DESC LIMIT 50`).bind(...(supplierId?[supplierId,owner]:[owner])).all()).results||[];
 const priority=[];for(const invoice of findings){let reasons=[];try{reasons=JSON.parse(invoice.audit_reasons||'[]').filter(reason=>['RED','ORANGE','YELLOW'].includes(reason.color)).sort((a,b)=>['RED','ORANGE','YELLOW'].indexOf(a.color)-['RED','ORANGE','YELLOW'].indexOf(b.color));}catch{}for(const reason of reasons.slice(0,2)){let question='Can you confirm the printed quantities, price, supporting delivery and project records?';if(reason.code==='missing_fields')question='Open the original PDF and confirm only the missing printed fields listed above. Save the corrected draft and rerun its audit.';else if(/price_change/i.test(reason.code||''))question='Can you confirm equivalent product specifications, pack size, discount and VAT basis for this price comparison?';else if(/duplicate/i.test(reason.code||''))question='Can you confirm whether the repeated invoice or charge was already billed or paid?';else if(/calculation|subtotal|total/i.test(reason.code||''))question='Can you confirm the source calculation, including quantity, unit price, discount and VAT?';priority.push({invoice_id:invoice.id,supplier:invoice.supplier_name||(invoice.supplier_key?invoice.supplier_key+' (classified; printed name unverified)':'Supplier needs review'),invoice_number:invoice.invoice_number||'Number not extracted',invoice_date:invoice.invoice_date||null,color:reason.color,reason:reason.reason,question});}}
 const recentRuns=await Promise.all(rows.slice(0,10).map(async row=>({...await enrichRun(row),created:row.created})));
 return {scope_supplier_id:supplierId,checked_at:now(),last_all_vendor_run:allRunStatus,last_selected_workspace_run:selectedRunStatus,last_successful_run:lastSuccess,last_manual_run:lastManual?{id:lastManual.id,...readData(lastManual)}:null,last_successful_manual_run:readData(manualSuccess)?.last_successful_run||null,last_successful_unattended_run:readData(unattendedSuccess)?.last_successful_run||null,invoices_collected:Number(counts?.invoices_collected||0),invoices_analyzed:Number(analyzed?.invoices_analyzed||0),total_invoiced_by_currency:totalGroups,outstanding_reviews:Number(reviews?.outstanding_reviews||0),waiting_processing:Number(pending?.n||0),failed_sheets:Number(sync?.failed_sheets||0),failed_jobs:Number(failed?.failed_jobs||0),priority_findings:priority.slice(0,5),last_run:latest[0]||null,runs:recentRuns};
}

export async function automationRoute(req,{owner,db,bucket,key}){
 if(req.method==='GET'){
  const supplierId=new URL(req.url).searchParams.get('supplier_id');
  const status=await automationStatus({owner,db,supplierId:supplierId||null});
  const lock=await db.prepare("SELECT data FROM records WHERE id=? AND owner=? AND entity='AutomationLock'").bind('automation:lock:'+owner,owner).first();
  status.lock_expires=lock?JSON.parse(lock.data).expires:null;
  status.running=Number(status.lock_expires||0)>Date.now();
  return json(status);
 }
 if(req.method==='POST'){
  let body;try{body=await req.json();if(!body||typeof body!=='object'||Array.isArray(body)||body.run_id!==undefined&&(typeof body.run_id!=='string'||body.run_id.length>200)||body.supplier_id!==undefined&&(typeof body.supplier_id!=='string'||body.supplier_id.length>100)||body.audit_mode!==undefined&&!['incremental','date_range','full'].includes(body.audit_mode)||body.date_from!==undefined&&(typeof body.date_from!=='string'||body.date_from.length!==10)||body.date_to!==undefined&&(typeof body.date_to!=='string'||body.date_to.length!==10)||body.audit_mode==='date_range'&&(!body.date_from||!body.date_to||body.date_from>body.date_to||!/^\d{4}-\d{2}-\d{2}$/.test(body.date_from)||!/^\d{4}-\d{2}-\d{2}$/.test(body.date_to)))throw Error();}catch{return json({error:'Invalid audit run request. Choose a valid scope and date range.'},400);}
  const {manualAutomationStep}=await import('./manual-automation.mjs');
  return json(await manualAutomationStep({owner,db,bucket,key,runId:body.run_id,supplierId:body.supplier_id||null,auditMode:body.audit_mode||'incremental',dateFrom:body.date_from||null,dateTo:body.date_to||null}));
 }
 return json({error:'Method not allowed'},405);
}
