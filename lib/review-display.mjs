import {invoiceMissingFields} from './invoice-missing-fields.mjs';
import {sameInvoice} from './invoice-audit.mjs';
export function reviewIssues(capture,results=[],documentId){
 if(!capture)return [];
 const issues=invoiceMissingFields(capture,capture.line_items||[]).map(field=>field.label+' — missing or unverified');
 if(results.some(r=>r.document_id!==documentId&&r.capture&&sameInvoice(capture,r.capture)))issues.push('Possible duplicate in this batch — compare originals');
 return issues;
}
export function reviewDisplay(result){
 const status=result.status||result.outcome;
 if(status==='failed')return {label:'Could not save — retry',className:'border-red-400 bg-red-50 text-red-950',needsReview:true};
 if(result.master_sync?.status==='failed')return {label:'Draft saved — master sync failed; retry',className:'border-red-400 bg-red-50 text-red-950',needsReview:true};
 if(result.master_sync?.status==='pending')return {label:'Draft saved — master sync not verified',className:'border-amber-400 bg-amber-50 text-amber-950',needsReview:true};
 if(status==='skipped')return {label:({quote:'Quote — kept for reference',statement:'Account statement — kept for reference',other:'Supporting document — kept for reference'})[result.document_kind]||'Not an invoice — kept for reference',className:'border-slate-300 bg-slate-50 text-slate-900',needsReview:false};
 if(result.audit_status==='approved')return {label:'Approved',className:'border-green-400 bg-green-50 text-green-950',needsReview:false};
 if(result.audit_status==='excluded')return {label:'Duplicate excluded',className:'border-slate-300 bg-slate-50 text-slate-900',needsReview:false};
 if(result.audit_status==='reviewed')return {label:'Reviewed — awaiting approval',className:'border-blue-300 bg-blue-50 text-blue-950',needsReview:false};
 return {label:status==='saved_checks_failed'?'Draft saved — checks need retry':status==='needs_attention'?'Needs review — more information required':status==='complete'?'Invoice draft — needs review':'Saved draft — needs review',className:'border-amber-400 bg-amber-50 text-amber-950',needsReview:true};
}
export function reviewSummary(results){
 const drafts=results.filter(r=>['complete','saved','saved_checks_failed'].includes(r.status||r.outcome)).length;
 const skipped=results.filter(r=>(r.status||r.outcome)==='skipped').length;
 const review=results.filter(r=>reviewDisplay(r).needsReview).length;
 const failed=results.filter(r=>r.status==='failed').length;
 return `${drafts} invoice drafts · ${skipped} reference documents · ${review} need review${failed?` · ${failed} could not be saved`:''}`;
}
