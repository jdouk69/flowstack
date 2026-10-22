import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {verifyDocument} from '../lib/document-verification.mjs';
import {computeMd5} from '../lib/content-metadata.mjs';
const require=createRequire(resolve('package.json'));const {Miniflare}=require(require.resolve('miniflare',{paths:[require.resolve('wrangler')]}));
async function setup(){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-05-15',d1Databases:['DB'],r2Buckets:['BUCKET']}),db=await mf.getD1Database('DB'),bucket=await mf.getR2Bucket('BUCKET');await db.prepare('CREATE TABLE records(id TEXT PRIMARY KEY,owner TEXT,entity TEXT,data TEXT,created TEXT,updated TEXT)').run();
 const bytes=new TextEncoder().encode('original file'),source={key:'private-source',name:'invoice.pdf',size:bytes.length,mime_type:'application/pdf',md5:computeMd5(bytes),drive_file_id:'original',drive_folder_id:'folder',drive_exports:[{file_id:'second',folder_id:'other-folder',workflow_name:'Other workflow'}]},files=new Map([['original',{id:'original',size:bytes.length,mimeType:source.mime_type,md5Checksum:source.md5,parents:['folder']}],['second',{id:'second',size:bytes.length,mimeType:source.mime_type,md5Checksum:source.md5,parents:['other-folder']}] ]);
 await bucket.put(source.key,bytes);const save=()=>db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated').bind('doc','jim','Document',JSON.stringify(source),'now','now').run();await save();
 const ctx={owner:'jim',db,bucket,provider:{file:async id=>{if(!files.has(id))throw Object.assign(Error('Missing'),{providerStatus:404});return files.get(id);}}};
 const send=(input={},context=ctx,origin='https://test.local')=>verifyDocument(new Request('https://test.local/api/flow/functions/verifyDocument',{method:'POST',headers:{origin},body:JSON.stringify({document_id:'doc',...input})}),context);
 return {mf,db,bucket,source,bytes,files,ctx,send,save};
}
test('Storage verification checks exact local bytes, recorded Drive checksum and parent without modifying records',async()=>{
 const f=await setup();try{
  const before=(await f.db.prepare('SELECT data FROM records').first()).data;const result=await (await f.send()).json();assert.equal(result.local.status,'verified');assert.equal(result.drive.status,'verified');assert.equal(result.verified,true);assert.equal(result.copies.length,2);assert.ok(!JSON.stringify(result).includes(f.source.key));
  assert.equal((await (await f.send({drive_file_id:'second'})).json()).drive.status,'verified');assert.equal((await f.send({drive_file_id:'foreign'})).status,400);
  assert.equal((await f.db.prepare('SELECT data FROM records').first()).data,before);assert.deepEqual(new Uint8Array(await (await f.bucket.get(f.source.key)).arrayBuffer()),f.bytes);
  f.files.get('original').parents=['wrong'];assert.equal((await (await f.send()).json()).drive.status,'wrong_folder');f.files.get('original').parents=['folder'];f.files.get('original').md5Checksum='changed';assert.equal((await (await f.send()).json()).drive.status,'changed');
  await f.bucket.put(f.source.key,new TextEncoder().encode('altered bytes'));assert.equal((await (await f.send()).json()).local.status,'changed');await f.bucket.delete(f.source.key);assert.equal((await (await f.send()).json()).local.status,'missing');
 }finally{await f.mf.dispose();}
});
test('Drive reference verification reads no local bytes; provider errors remain unverified and owner/origin guards apply',async()=>{
 const f=await setup();try{
  f.source.storage_kind='drive_reference';f.source.size=70*1024*1024;await f.save();f.files.get('original').size=f.source.size;
  const ctx={...f.ctx,bucket:{get:async()=>{throw Error('No byte reads');}}};let result=await (await f.send({},ctx)).json();assert.equal(result.local.status,'reference_only');assert.equal(result.drive.status,'verified');assert.equal(result.verified,true);
  f.files.delete('original');result=await (await f.send({},ctx)).json();assert.equal(result.drive.status,'unavailable');assert.equal(result.verified,false);
  const failing={...ctx,provider:{file:async()=>{throw Object.assign(Error('Authorization expired'),{providerStatus:401});}}};result=await (await f.send({},failing)).json();assert.equal(result.drive.status,'not_checked');assert.equal(result.verified,false);assert.match(result.drive.reason,/expired/);
  assert.equal((await f.send({}, {...ctx,owner:'other'})).status,404);assert.equal((await f.send({},ctx,'https://evil.example')).status,403);
 }finally{await f.mf.dispose();}
});
test('Size-only matches cannot pass full verification; unassigned local-only uploads need no Google access',async()=>{
 const f=await setup();try{
  delete f.source.md5;await f.save();let result=await (await f.send()).json();assert.equal(result.local.status,'size_only');assert.equal(result.drive.status,'size_only');assert.equal(result.verified,false);
  delete f.source.drive_file_id;f.source.drive_exports=[];f.source.md5=computeMd5(f.bytes);await f.save();result=await (await f.send({}, {...f.ctx,provider:{file:async()=>{throw Error('Must not call Google');}}})).json();assert.equal(result.local.status,'verified');assert.equal(result.drive.status,'not_saved');
 }finally{await f.mf.dispose();}
});
test('SHA-only sources verify copied bytes; concurrent source changes and oversized local files cannot pass',async()=>{
 const f=await setup();try{
  delete f.source.md5;f.source.hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',f.bytes)),b=>b.toString(16).padStart(2,'0')).join('');await f.save();let result=await (await f.send()).json();assert.equal(result.local.status,'verified');assert.equal(result.drive.status,'verified');
  const ctx={...f.ctx,provider:{file:async id=>{await f.db.prepare("UPDATE records SET updated='new-version' WHERE id='doc'").run();return f.files.get(id);}}};result=await (await f.send({},ctx)).json();assert.equal(result.stale,true);assert.equal(result.verified,false);
  f.source.size=25*1024*1024;await f.save();const tooLarge={...f.ctx,bucket:{get:async()=>({size:f.source.size,arrayBuffer:async()=>{throw Error('Must not read oversized bytes');}})}};result=await (await f.send({},tooLarge)).json();assert.equal(result.local.status,'not_checked');assert.match(result.local.reason,/24 MB/);assert.equal(result.verified,false);
 }finally{await f.mf.dispose();}
});
