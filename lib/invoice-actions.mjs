// Combine user actions without combining extraction, persistence or approval states.
export async function openExtractedInvoice(request,documentId,signal){
 const check=()=>{if(signal?.aborted)throw new DOMException('Cancelled','AbortError');};
 check();await request('/document-analysis/'+documentId+'?capture=1',{signal});check();
 const result=await request('/invoices',{method:'POST',signal,body:JSON.stringify({document_id:documentId})});check();
 return result.invoice.id;
}
export async function saveAndCheckInvoice(request,invoiceId,payload){
 const saved=await request('/invoices/'+invoiceId,{method:'PATCH',body:JSON.stringify(payload)});
 try{
  const checked=await request('/invoices/'+invoiceId+'/audit',{method:'POST',body:JSON.stringify({revision:saved.invoice.revision})});
  return {saved,checked,checkError:null};
 }catch(error){return {saved,checked:null,checkError:error.message||'Audit checks did not finish.'};}
}
