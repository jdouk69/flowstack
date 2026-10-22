import {INVOICE_BATCH_LIMIT,awaitingInvoice,runInvoiceBatch} from './invoice-batch-runner.mjs';
import {isPdfDocument} from './document-types.mjs';
export function analysisStage(document,invoice){
 if(!isPdfDocument(document)||document.merged)return 'excluded';
 if(document.invoice_review_classification==='not_invoice')return 'skipped';
 if(document.storage_kind==='drive_reference'||document.processing_status==='needs_review'||document.pages>1)return 'attention';
 if(invoice&&!awaitingInvoice(invoice))return invoice.capture_method?'analyzed':'attention';
 return 'ready';
}
// Only the user's fixed selection is processed. Queueing is idempotent server-side.
export async function analyzeDocuments({documents,template,request,readPdf,signal,onProgress=()=>{},onBatch=()=>{},onSaved=()=>{}}){
 if(!['tournas','akron','ergobeton'].includes(template)||!documents.length||documents.length>1000||new Set(documents.map(d=>d.id)).size!==documents.length||documents.some(d=>analysisStage(d,null)!=='ready'))throw Error('Select 1–1,000 stored original PDFs and a supported supplier.');
 const totals={saved:0,preserved:0,attention:0,batches:0,batch_ids:[]};
 for(let start=0;start<documents.length;start+=INVOICE_BATCH_LIMIT){
  if(signal?.aborted)break;
  const ids=[];
  for(const document of documents.slice(start,start+INVOICE_BATCH_LIMIT)){
   if(signal?.aborted)break;
   onProgress(`Preparing ${start+ids.length+1} of ${documents.length}: ${document.name}`);
   const result=await request('/invoices',{method:'POST',signal,body:JSON.stringify({document_id:document.id})});
   if(awaitingInvoice(result.invoice))ids.push(result.invoice.id);else totals.preserved++;
  }
  if(signal?.aborted)break;if(!ids.length)continue;
  const {batch}=await request('/invoice-batches',{method:'POST',signal,body:JSON.stringify({invoice_ids:ids,template,confirmed:true})});
  totals.batches++;totals.batch_ids.push(batch.id);await onBatch(batch);
  const result=await runInvoiceBatch({batch,request,readPdf,signal,onProgress:p=>onProgress(`Batch ${Math.floor(start/INVOICE_BATCH_LIMIT)+1} of ${Math.ceil(documents.length/INVOICE_BATCH_LIMIT)} · invoice ${p.index} of ${p.total}: ${p.item.name}${p.page?` · page ${p.page} of ${p.pages}`:''}`),onSaved});
  totals.saved+=result.items.filter(i=>i.status==='saved').length;
  totals.preserved+=result.items.filter(i=>i.status==='preserved').length;
  totals.attention+=result.items.filter(i=>!['saved','preserved'].includes(i.status)).length;
  if(result.stopped)break;
 }
 return {...totals,stopped:!!signal?.aborted};
}
