import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewDisplay,reviewSummary,reviewIssues} from '../lib/review-display.mjs';
test('saved drafts need review even when checks completed; final decisions clear that state',()=>{
 const results=[...Array.from({length:8},()=>({status:'saved'})),...Array.from({length:17},()=>({status:'skipped',document_kind:'statement'}))];
 assert.equal(reviewSummary(results),'8 invoice drafts · 17 reference documents · 8 need review');
 assert.match(reviewDisplay(results[0]).className,/amber/);
 for(const audit_status of ['approved','excluded','reviewed'])assert.equal(reviewDisplay({status:'saved',audit_status}).needsReview,false);
 assert.match(reviewDisplay({status:'failed'}).className,/red/);
 assert.match(reviewDisplay({status:'skipped',document_kind:'quote'}).label,/Quote/);
});
test('missing printed values and matching invoices remain visible without declaring duplication',()=>{
 const capture={supplier_key:'ergobeton',invoice_number:'539',document_type:'invoice',currency:null,line_items:[{line_amount:null}]};
 const results=[{document_id:'one',capture},{document_id:'two',capture:{...capture}}];
 assert.ok(reviewIssues(capture,results,'one').some(issue=>issue.startsWith('Currency')));assert.ok(reviewIssues(capture,results,'one').some(issue=>issue.startsWith('Item 1 — printed line amount')));
 assert.match(reviewIssues(capture,results,'one').at(-1),/Possible duplicate/);
 assert.ok(!reviewIssues({...capture,currency:'EUR',line_items:[{line_amount:'1.00'}]},[], 'one').some(issue=>issue.startsWith('Currency')||issue.startsWith('Item 1 — printed line amount')));
});
