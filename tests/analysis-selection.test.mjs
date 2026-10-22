import test from 'node:test';
import assert from 'node:assert/strict';
import {selectReadyDocuments} from '../lib/analysis-selection.mjs';
test('select all finds ready invoices beyond the first analyzed page and preserves workflow scope',async()=>{
 const original=Array.from({length:100},(_,n)=>({id:'old'+n,stage:'analyzed'}));const ready=Array.from({length:105},(_,n)=>({id:'new'+n,stage:'ready'})),calls=[];
 const selected=await selectReadyDocuments({documents:original,cursor:'p2',workflow:'supplier-folder',isReady:d=>d.stage==='ready',request:async(path,options)=>{assert.equal(options.signal,undefined);const params=new URLSearchParams(path.split('?')[1]);assert.equal(params.get('workflow'),'supplier-folder');calls.push(params.get('cursor'));return calls.length===1?{documents:ready.slice(0,100),next_cursor:'p3'}:{documents:[...ready.slice(100),ready[0],{id:'scan',stage:'attention'}],next_cursor:null};}});
 assert.deepEqual(calls,['p2','p3']);assert.equal(selected.selected.length,105);assert.equal(selected.documents.length,206);assert.deepEqual(original.map(d=>d.stage),Array(100).fill('analyzed'));
});
test('oversized and looping selections fail explicitly without truncating or changing the input',async()=>{
 const docs=Array.from({length:1001},(_,n)=>({id:String(n)}));await assert.rejects(selectReadyDocuments({documents:docs,cursor:null,isReady:()=>true}),/More than 1,000/);assert.equal(docs.length,1001);
 await assert.rejects(selectReadyDocuments({documents:[],cursor:'loop',isReady:()=>true,request:async()=>({documents:[],next_cursor:'loop'})}),/pagination repeated/);
});
