// Preserve the displayed sequence; never substitute the global review queue.
export function reviewQueue(invoices, returnTo = '/invoices') {
 return {ids:[...new Set(invoices.map(i=>i.id||i.invoice_id).filter(id=>typeof id==='string'&&id))],returnTo};
}
export function followingInvoiceIds(queue, currentId) {
 if(!Array.isArray(queue?.ids))return [];
 const ids=[...new Set(queue.ids.filter(id=>typeof id==='string'&&id))];
 const index=ids.indexOf(currentId);
 return index<0?[]:ids.slice(index+1);
}
export async function nextInReviewOrder(queue,currentId,readInvoice) {
 for(const id of followingInvoiceIds(queue,currentId)) {
  const result=await readInvoice(id);
  if(!['approved','excluded'].includes(result.invoice.audit_status))return result.invoice;
 }
 return null;
}
