import {INVOICE_BATCH_LIMIT} from './invoice-batch-runner.mjs';
import {documentAnalysis} from './extraction/route.mjs';
import {saveInvoiceDraft} from './invoice-save.mjs';
import {invoiceReview} from './invoice-review.mjs';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const internal=(body,method='POST')=>new Request('https://internal.local/',{method,body:JSON.stringify(body)});
async function checked(response){const data=await response.json();if(!response.ok)throw Error(data.error||'Processing failed.');return data;}
const publicJob=record=>({id:record.id,...JSON.parse(record.data),created:record.created});
export async function invoiceBatches(req,{db,bucket,owner,review=invoiceReview}){
 if(req.method==='GET'){
  const rows=(await db.prepare("SELECT * FROM records WHERE owner=? AND entity='InvoiceBatch' ORDER BY created DESC,id DESC LIMIT 11").bind(owner).all()).results;
  return json({batches:rows.slice(0,10).map(publicJob),has_more:rows.length>10});
 }
 if(req.method!=='POST')return json({error:'Unsupported operation'},405);
 let body;try{const raw=await req.text();if(raw.length>4*1024*1024)throw Error();body=JSON.parse(raw);if(!body||typeof body!=='object'||Array.isArray(body))throw Error();}catch{return json({error:'Invalid batch request'},400);}
 if(!body.id){
  if(body.confirmed!==true||!['tournas','akron','ergobeton'].includes(body.template)||!Array.isArray(body.invoice_ids)||!body.invoice_ids.length||body.invoice_ids.length>INVOICE_BATCH_LIMIT||body.invoice_ids.some(id=>typeof id!=='string'||id.length>100)||new Set(body.invoice_ids).size!==body.invoice_ids.length)return json({error:'Select 1–100 invoices, choose their supplier template and confirm unapproved draft processing.'},400);
  const items=[];
  for(const id of body.invoice_ids){
   const row=await db.prepare("SELECT i.*,r.data AS source FROM invoices i JOIN records r ON r.id=i.source_document_id AND r.owner=i.owner AND r.entity='Document' WHERE i.owner=? AND i.id=?").bind(owner,id).first();
   if(!row)return json({error:'A selected invoice or original PDF was not found.'},404);
   const source=JSON.parse(row.source);
   if(source.invoice_review_classification==='not_invoice')return json({error:'This original is skipped — not an invoice. Restore it from the Skipped tab first.'},409);
   items.push({invoice_id:id,source_document_id:row.source_document_id,name:source.name,status:'pending'});
  }
  const id=crypto.randomUUID(),time=new Date().toISOString(),data={template:body.template,items};
  await db.prepare("INSERT INTO records(id,owner,entity,data,created,updated) VALUES(?,?,'InvoiceBatch',?,?,?)").bind(id,owner,JSON.stringify(data),time,time).run();
  return json({batch:{id,...data,created:time}});
 }
 if(typeof body.id!=='string'||body.id.length>100||typeof body.invoice_id!=='string')return json({error:'Invalid batch or invoice identifier'},400);
 const job=await db.prepare("SELECT * FROM records WHERE id=? AND owner=? AND entity='InvoiceBatch'").bind(body.id,owner).first();if(!job)return json({error:'Batch not found'},404);
 const batch=JSON.parse(job.data),index=batch.items.findIndex(item=>item.invoice_id===body.invoice_id);if(index<0)return json({error:'Invoice is not in this batch'},404);
 const item=batch.items[index],path='$.items['+index+']',now=new Date().toISOString();
 if(body.action==='read_failed'){
  if(typeof body.reason!=='string'||body.reason.length>1000)return json({error:'Invalid reading error'},400);
  if(['pending','failed'].includes(item.status))await db.prepare("UPDATE records SET data=json_set(data,?,json(?)),updated=? WHERE id=? AND owner=? AND entity='InvoiceBatch' AND json_extract(data,?) IN ('pending','failed')").bind(path,JSON.stringify({...item,status:'failed',reason:body.reason,updated:now}),now,job.id,owner,path+'.status').run();
  return json({item:(JSON.parse((await db.prepare('SELECT data FROM records WHERE id=? AND owner=?').bind(job.id,owner).first()).data)).items[index]});
 }
 if(body.action!=='process')return json({error:'Unknown batch action'},400);
 if(['saved','preserved'].includes(item.status))return json({item});
 const token=crypto.randomUUID(),expiry=new Date(Date.now()+180000).toISOString();
 const claim=await db.prepare("UPDATE records SET data=json_set(data,?,json(?)),updated=? WHERE id=? AND owner=? AND entity='InvoiceBatch' AND (json_extract(data,?) IN ('pending','failed','saved_checks_failed') OR (json_extract(data,?)='processing' AND json_extract(data,?)<?))").bind(path,JSON.stringify({...item,status:'processing',token,expires:expiry}),now,job.id,owner,path+'.status',path+'.status',path+'.expires',now).run();
 if(!claim.meta.changes)return json({error:'This invoice is being processed in another run. Refresh or wait for its lock to expire.'},409);
 let outcome, saved=null;
 try{
  const invoice=await db.prepare('SELECT * FROM invoices WHERE id=? AND owner=?').bind(item.invoice_id,owner).first();if(!invoice||invoice.source_document_id!==item.source_document_id)throw Error('The selected invoice changed or was removed.');
  const currentSource=await db.prepare("SELECT data FROM records WHERE owner=? AND id=? AND entity='Document'").bind(owner,item.source_document_id).first();
  if(currentSource&&JSON.parse(currentSource.data).invoice_review_classification==='not_invoice')outcome={status:'preserved',reason:'Skipped — not an invoice.'};
  else if(invoice.capture_method){
   // Retry only our own failed checks at the exact saved revision. Never replace any captured values.
   if(item.status==='saved_checks_failed'&&item.invoice_revision===invoice.revision){
    saved=invoice;const audit=await checked(await review(internal({revision:invoice.revision}),{db,owner,id:invoice.id,action:'audit'}));
    outcome={status:'saved',invoice_revision:audit.invoice.revision,flag:audit.invoice.audit_flag,reason:'Saved rows checked. Human review is still required.'};
   }else outcome={status:'preserved',reason:'Existing capture, corrections or review state preserved. Open the invoice to review it.'};
  }else{
   if(invoice.revision!==0||invoice.audit_status!=='not_started'||invoice.analysis_status!=='awaiting_analysis')throw Error('This invoice changed. Open it for review instead of replacing it.');
   const source=await db.prepare("SELECT data FROM records WHERE id=? AND owner=? AND entity='Document'").bind(item.source_document_id,owner).first();if(!source)throw Error('Original PDF not found.');
   const document=JSON.parse(source.data);if(document.merged||document.storage_kind==='drive_reference')throw Error('Choose an individual stored invoice PDF. Merged or Drive-only sources require separate processing.');
   const preview=await db.prepare('SELECT revision FROM document_analysis WHERE owner=? AND document_id=?').bind(owner,item.source_document_id).first();
   await checked(await documentAnalysis(internal({revision:preview?.revision??0,template:batch.template,pages:body.pages}),{db,bucket,owner,id:item.source_document_id}));
   const capture=await checked(await documentAnalysis(new Request('https://internal.local/?capture=1'),{db,bucket,owner,id:item.source_document_id}));
   const draft=capture.draft;
   const result=await checked(await saveInvoiceDraft(internal({revision:invoice.revision,...draft.fields,printed_names:draft.printed_names,line_items:draft.line_items}),{db,owner,id:invoice.id,captureMethod:'extraction'}));saved=result.invoice;
   const audit=await checked(await review(internal({revision:saved.revision}),{db,owner,id:invoice.id,action:'audit'}));
   outcome={status:'saved',line_count:draft.line_items.length,preview_revision:draft.preview_revision,invoice_revision:audit.invoice.revision,flag:audit.invoice.audit_flag,reason:'Extracted rows saved as an unapproved draft. Review the source and findings.'};
  }
 }catch(error){outcome={status:saved?'saved_checks_failed':'failed',reason:error.message,...(saved?{invoice_revision:saved.revision}:{})};}
 const result={...item,...outcome,updated:new Date().toISOString()};delete result.token;delete result.expires;
 const written=await db.prepare("UPDATE records SET data=json_set(data,?,json(?)),updated=? WHERE id=? AND owner=? AND entity='InvoiceBatch' AND json_extract(data,?)=?").bind(path,JSON.stringify(result),result.updated,job.id,owner,path+'.token',token).run();
 if(!written.meta.changes)return json({error:'Batch status changed. Refresh to see the saved invoice state.'},409);
 return json({item:result});
}
