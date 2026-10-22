import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runWorkflows} from '../lib/run-workflows.mjs';
test('Run all serializes complete jobs and sums snapshots without counting batches twice',async()=>{
 const calls=[],progress=[];
 const result=await runWorkflows({workflows:[{id:'a'},{id:'b'}],onProgress:d=>progress.push(d),invoke:async input=>{calls.push(input);const continued=!!input.job_id;return {data:{job_id:'job-'+input.supplier_id,needs_continue:input.supplier_id==='a'&&!continued,results:[{supplier_name:input.supplier_id,files_saved:continued?3:1,errors:input.supplier_id==='b'?1:0,error_details:input.supplier_id==='b'?[{reason:'Denied'}]:[]}]}};}});
 assert.deepEqual(calls,[{supplier_id:'a'},{supplier_id:'a',job_id:'job-a'},{supplier_id:'b'}]);assert.equal(result.totals.files_saved,4);assert.equal(result.totals.errors,1);assert.equal(result.results.length,2);assert.equal(progress[1].totals.files_saved,3);assert.equal(result.totals.error_details[0].reason,'Denied');
});
test('Cancellation stops future batches and a network failure stops later workflows',async()=>{
 let stop=false,calls=0;assert.equal(await runWorkflows({workflows:[{id:'a'},{id:'b'}],cancelled:()=>stop,invoke:async()=>{calls++;stop=true;return {data:{needs_continue:true,results:[]}};}}),null);assert.equal(calls,1);
 await assert.rejects(()=>runWorkflows({workflows:[{id:'a'},{id:'b'}],invoke:async()=>{throw Error('Connection lost');}}),/Connection lost/);
});
