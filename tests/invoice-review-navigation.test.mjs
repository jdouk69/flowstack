import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewQueue,followingInvoiceIds,nextInReviewOrder} from '../lib/invoice-review-navigation.mjs';
test('batch order omits reference documents and retains displayed order',()=>{
 const q=reviewQueue([{invoice_id:'b'},{document_id:'reference'},{invoice_id:'a'},{invoice_id:'c'},{invoice_id:'a'}],'/analysis');
 assert.deepEqual(q,{ids:['b','a','c'],returnTo:'/analysis'});
 assert.deepEqual(followingInvoiceIds(q,'b'),['a','c']);
 assert.deepEqual(followingInvoiceIds(q,'c'),[]);
 assert.deepEqual(followingInvoiceIds(q,'unknown'),[]);
});
test('next checks current statuses and skips approved/excluded without wrapping',async()=>{
 const seen=[];const q=reviewQueue([{id:'current'},{id:'approved'},{id:'excluded'},{id:'draft'},{id:'later'}]);
 const result=await nextInReviewOrder(q,'current',async id=>{seen.push(id);return {invoice:{id,audit_status:id==='draft'?'not_started':id}};});
 assert.equal(result.id,'draft');assert.deepEqual(seen,['approved','excluded','draft']);
});
test('missing context never fetches an unrelated global queue',async()=>{
 assert.equal(await nextInReviewOrder(null,'current',()=>{throw Error('Unexpected fetch');}),null);
});
test('failed candidate fetch does not silently jump to another invoice',async()=>{
 await assert.rejects(nextInReviewOrder({ids:['current','next','other']},'current',async()=>{throw Error('Unavailable');}),/Unavailable/);
});
