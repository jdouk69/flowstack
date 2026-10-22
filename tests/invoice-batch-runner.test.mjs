import test from 'node:test';
import assert from 'node:assert/strict';
import {INVOICE_BATCH_LIMIT,selectAwaitingInvoices,runInvoiceBatch} from '../lib/invoice-batch-runner.mjs';
const batch={id:'batch',items:Array.from({length:100},(_,index)=>({invoice_id:'i'+index,source_document_id:'pdf'+index,name:'Invoice '+index,status:'pending'}))};
test('100-item runner processes one PDF at a time, retains unreadable failures and preserves captured data',async()=>{
 let active=0,max=0,reads=0,saves=0;const persisted=new Map(),progress=[];
 const request=async(path,options)=>{if(path.startsWith('/invoices/'))return {invoice:{capture_method:path==='/invoices/i40'?'manual':null}};const body=JSON.parse(options.body);saves++;const item={...batch.items.find(i=>i.invoice_id===body.invoice_id),status:body.action==='read_failed'?'failed':body.invoice_id==='i40'?'preserved':'saved',reason:body.reason};persisted.set(body.invoice_id,item);return {item};};
 const result=await runInvoiceBatch({batch,request,readPdf:async id=>{active++;max=Math.max(max,active);reads++;try{await Promise.resolve();if(id==='pdf22')throw Error('Unreadable source');return [{page:1,text:id}];}finally{active--;}},onProgress:p=>progress.push(p),onSaved:()=>assert.equal(active,0)});
 assert.equal(result.stopped,false);assert.equal(max,1);assert.equal(reads,99);assert.equal(saves,100);assert.equal(persisted.size,100);assert.equal(result.items[22].status,'failed');assert.equal(result.items[40].status,'preserved');assert.equal(result.items[99].status,'saved');assert.equal(progress.at(-1).index,100);assert.ok(result.items.every(i=>i.status!=='approved'));
});
test('stop during a read performs no save and no later read; retry skips saved/preserved results',async()=>{
 const controller=new AbortController();let writes=0,reads=0;
 const result=await runInvoiceBatch({batch,signal:controller.signal,request:async(path)=>{if(path.startsWith('/invoices/'))return {invoice:{}};writes++;return {};},readPdf:async()=>{reads++;controller.abort();return [];} });assert.equal(result.stopped,true);assert.equal(writes,0);assert.equal(reads,1);
 const retry=await runInvoiceBatch({batch:{...batch,items:[{...batch.items[0],status:'saved'},{...batch.items[1],status:'preserved'},batch.items[2]]},request:async(path,options)=>path.startsWith('/invoices/')?{invoice:{capture_method:'extraction'}}:{item:{...batch.items[2],status:'preserved'}},readPdf:()=>{throw Error('No repeat read');}});assert.deepEqual(retry.items.map(i=>i.status),['saved','preserved','preserved']);
});
test('network errors never skip ahead without a durable failure result',async()=>{
 let reads=0;await assert.rejects(runInvoiceBatch({batch,request:async()=>{throw Error('Offline');},readPdf:async()=>{reads++;return [];}}),/Connection interrupted/);assert.equal(reads,0);
});
test('selection includes only uncaptured awaiting originals and limits a loaded page to 100',()=>{
 const invoices=Array.from({length:125},(_,i)=>({id:String(i),analysis_status:'awaiting_analysis',audit_status:'not_started'}));invoices[0].capture_method='manual';invoices[1].audit_status='approved';invoices[2].analysis_status='analyzed';const selected=selectAwaitingInvoices(invoices);assert.equal(INVOICE_BATCH_LIMIT,100);assert.equal(selected.length,100);assert.equal(selected[0],'3');assert.equal(selected.at(-1),'102');
});
