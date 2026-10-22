// Older restorations removed the skipped fields before a restore timestamp existed.
// Recover those pending restorations from their saved review result and source status.
export function restoredReviewAt(document,invoice,batches=[]){
 if(document.invoice_review_classification==='not_invoice'||invoice?.capture_method||document.merged||document.storage_kind==='drive_reference')return null;
 const latest=[...batches].sort((a,b)=>String(b.created).localeCompare(String(a.created))).map(b=>b.results?.find(r=>r.document_id===document.id)).find(Boolean);
 if(latest&&latest.status!=='skipped')return null;
 return document.invoice_review_restored_at||(latest?.status==='skipped'&&document.processing_status==='awaiting_analysis'?document.updated_date:null)||null;
}
export function needsFreshReview(document,batches,restoredAt){
 const exports=batches.filter(b=>b.sources.some(s=>s.document_id===document.id));
 return !exports.length||!!restoredAt&&exports.every(b=>Date.parse(b.created)<Date.parse(restoredAt));
}
