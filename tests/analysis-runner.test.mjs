import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisStage,analyzeDocuments} from '../lib/analysis-runner.mjs';
const document=i=>({id:'d'+i,name:'Invoice '+i+'.pdf',file_type:'pdf',pages:1});
test('analysis stages separate originals, captures and unsupported sources',()=>{
 assert.equal(analysisStage(document(1)), 'ready');
 assert.equal(analysisStage({...document(1),merged:true}), 'excluded');
 assert.equal(analysisStage({...document(1),pages:2}), 'attention');
 assert.equal(analysisStage({...document(1),storage_kind:'drive_reference'}), 'attention');
 assert.equal(analysisStage(document(1),{capture_method:'manual',audit_status:'approved'}), 'analyzed');
});
test('205 selections automatically create 100/100/5 durable batches and keep every source',async()=>{
 const sizes=[],sources=[],saved=[];let batch=0;
 const request=async(path,opts={})=>{
  const b=opts.body?JSON.parse(opts.body):null;
  if(path==='/invoices'){sources.push(b.document_id);return {invoice:{id:b.document_id,analysis_status:'awaiting_analysis',audit_status:'not_started'}};}
  if(path==='/invoice-batches'&&!b.id){sizes.push(b.invoice_ids.length);return {batch:{id:'b'+(++batch),items:b.invoice_ids.map(id=>({invoice_id:id,source_document_id:id,name:id,status:'pending'}))}};}
  if(path.startsWith('/invoices/'))return {invoice:{}};
  if(b.action==='process')return {item:{invoice_id:b.invoice_id,status:'saved'}};
  throw Error('Unexpected request');
 };
 const result=await analyzeDocuments({documents:Array.from({length:205},(_,i)=>document(i)),template:'tournas',request,readPdf:async()=>[{text:'source'}],onSaved:i=>saved.push(i.invoice_id)});
 assert.deepEqual(sizes,[100,100,5]);assert.equal(new Set(sources).size,205);assert.equal(saved.length,205);assert.equal(result.saved,205);assert.equal(result.batches,3);assert.deepEqual(result.batch_ids,['b1','b2','b3']);
});
test('already captured invoices are preserved; cancellation never starts another batch',async()=>{
 const controller=new AbortController();let requests=0;
 const result=await analyzeDocuments({documents:[document(1),document(2)],template:'akron',signal:controller.signal,request:async()=>{requests++;controller.abort();return {invoice:{id:'existing',capture_method:'manual',audit_status:'approved'}};},readPdf:async()=>{throw Error('Must not read');}});
 assert.equal(requests,1);assert.equal(result.preserved,1);assert.equal(result.stopped,true);assert.equal(result.batches,0);
});
test('queue connection failure stops before any PDF read; invalid selection has no writes',async()=>{
 let reads=0;await assert.rejects(analyzeDocuments({documents:[document(1)],template:'tournas',request:async()=>{throw Error('Connection lost');},readPdf:async()=>reads++}),/Connection lost/);assert.equal(reads,0);
 await assert.rejects(analyzeDocuments({documents:[document(1),document(1)],template:'tournas',request:async()=>{throw Error('No write');}}),/Select/);
});
