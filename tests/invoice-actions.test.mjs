import test from 'node:test';
import assert from 'node:assert/strict';
import {openExtractedInvoice,saveAndCheckInvoice} from '../lib/invoice-actions.mjs';

test('unsupported previews and cancelled reads never continue into invoice creation',async()=>{
 const paths=[];
 await assert.rejects(()=>openExtractedInvoice(async path=>{paths.push(path);throw Error('Unsupported source');},'pdf'),/Unsupported/);
 assert.deepEqual(paths,['/document-analysis/pdf?capture=1']);
 const controller=new AbortController();paths.length=0;
 await assert.rejects(()=>openExtractedInvoice(async path=>{paths.push(path);controller.abort();return {draft:{}};},'pdf',controller.signal),{name:'AbortError'});
 assert.deepEqual(paths,['/document-analysis/pdf?capture=1']);
});
test('handoff retains source identity and returns the reused invoice for unsaved review',async()=>{
 const calls=[];
 const id=await openExtractedInvoice(async(path,options)=>{calls.push({path,options});return path==='/invoices'?{invoice:{id:'existing-invoice'}}:{draft:{line_items:[{}]}};},'original');
 assert.equal(id,'existing-invoice');assert.deepEqual(JSON.parse(calls[1].options.body),{document_id:'original'});
 assert.ok(!calls.some(c=>/approve|review$|audit$/.test(c.path)));
});
test('save failure stops checks; check failure preserves successful save and fresh revision',async()=>{
 const calls=[];await assert.rejects(()=>saveAndCheckInvoice(async path=>{calls.push(path);throw Error('Save conflict');},'i',{revision:2}),/Save conflict/);
 assert.deepEqual(calls,['/invoices/i']);
 calls.length=0;const result=await saveAndCheckInvoice(async(path,options)=>{calls.push({path,options});if(path.endsWith('/audit'))throw Error('Check unavailable');return {invoice:{revision:3}};},'i',{revision:2});
 assert.equal(result.saved.invoice.revision,3);assert.equal(result.checked,null);assert.equal(result.checkError,'Check unavailable');assert.equal(JSON.parse(calls[1].options.body).revision,3);
 assert.ok(!calls.some(c=>c.path.endsWith('/approve')));
});
