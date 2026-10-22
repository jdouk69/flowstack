export const INVOICE_BATCH_LIMIT=100;
export const awaitingInvoice=i=>!i.capture_method&&i.analysis_status==='awaiting_analysis'&&i.audit_status==='not_started';
export const selectAwaitingInvoices=invoices=>invoices.filter(awaitingInvoice).slice(0,INVOICE_BATCH_LIMIT).map(i=>i.id);
// Work one original at a time. A saved server result is the only completion evidence.
export async function runInvoiceBatch({batch,request,readPdf,signal,onProgress=()=>{},onSaved=()=>{}}){
 const items=batch.items.map(item=>({...item}));
 for(let index=0;index<items.length;index++){
  const item=items[index];if(['saved','preserved'].includes(item.status))continue;
  if(signal?.aborted)break;onProgress({item,index:index+1,total:items.length});let timer;
  try{
   const current=await request('/invoices/'+item.invoice_id,{signal});if(signal?.aborted)break;
   let pages;if(!current.invoice.capture_method){const reading=new AbortController();timer=setTimeout(()=>reading.abort(),60000);pages=await readPdf(item.source_document_id,{template:batch.template,signal:signal?AbortSignal.any([signal,reading.signal]):reading.signal,onProgress:(page,total)=>onProgress({item,index:index+1,total:items.length,page,pages:total})});clearTimeout(timer);}
   if(signal?.aborted)break;
   const result=await request('/invoice-batches',{method:'POST',signal,body:JSON.stringify({id:batch.id,invoice_id:item.invoice_id,action:'process',pages})});
   items[index]=result.item;
  }catch(error){
   if(signal?.aborted)break;
   try{const result=await request('/invoice-batches',{method:'POST',signal,body:JSON.stringify({id:batch.id,invoice_id:item.invoice_id,action:'read_failed',reason:error.name==='AbortError'?'PDF reading timed out. The original remains available for manual review.':String(error.message||'Reading failed').slice(0,1000)})});items[index]=result.item;}
   catch{throw Error('Connection interrupted. Reopen the saved batch to continue; already saved invoices remain protected.');}
  }finally{clearTimeout(timer);}
  await onSaved(items[index]);
 }
 return {items,stopped:!!signal?.aborted};
}
