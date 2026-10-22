import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planPdfParts,runMergeParts} from '../lib/merge-parts.mjs';
const MB=1024*1024,files=(n,size=MB)=>Array.from({length:n},(_,i)=>({id:'file'+i,name:'invoice'+i+'.pdf',size,md5_checksum:'checksum'+i}));
test('Part plans retain every original once, preserve order and split by bytes and count',()=>{
 const source=files(70),plan=planPdfParts(source);assert.equal(plan.parts.length,4);assert.deepEqual(plan.parts.flatMap(p=>p.items.map(f=>f.id)),source.map(f=>f.id));assert.ok(plan.parts.every(p=>p.size<=18*MB&&p.items.length<=20));
 const count=planPdfParts(files(21,100));assert.deepEqual(count.parts.map(p=>p.items.length),[19,2]);assert.ok(count.parts.every(p=>p.kind==='merge'));
 const single=planPdfParts(files(3,10*MB));assert.equal(single.parts.length,3);assert.ok(single.parts.every(p=>p.kind==='original'));assert.throws(()=>planPdfParts(files(1,11*MB)),/10 MB/);assert.throws(()=>planPdfParts([{id:'unknown',name:'Unknown',size:0}]),/unavailable/);assert.throws(()=>planPdfParts([source[0],source[0]]),/duplicate/);
});
test('Serial part runner stops after current result, resumes remaining parts and keeps failures explicit',async()=>{
 const parts=planPdfParts(files(70)).parts,completed=[];let stop=false;
 const first=await runMergeParts({parts,execute:async part=>part.number,onResult:(result,index)=>{completed.push(result);stop=true;},shouldStop:()=>stop});assert.equal(first.stopped,true);assert.equal(first.next_index,1);assert.deepEqual(completed,[1]);
 const rest=await runMergeParts({parts,start:first.next_index,execute:async part=>part.number,onResult:r=>completed.push(r)});assert.equal(rest.complete,true);assert.deepEqual(completed,[1,2,3,4]);
 let attempts=0;await assert.rejects(()=>runMergeParts({parts,execute:async()=>{attempts++;throw Error('Provider denied');}}),error=>error.part_index===0&&/denied/.test(error.message));assert.equal(attempts,1);
});
