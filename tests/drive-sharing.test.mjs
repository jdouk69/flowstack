import {withManagedFolders} from './helpers/managed-folders.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {driveSharing} from '../lib/drive-sharing.mjs';
import {googleProvider} from '../lib/google-provider.mjs';
import {computeMd5} from '../lib/content-metadata.mjs';
const require=createRequire(resolve('package.json'));const {Miniflare}=require(require.resolve('miniflare',{paths:[require.resolve('wrangler')]}));
async function setup(){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-05-15',d1Databases:['DB'],r2Buckets:['BUCKET']});const db=await mf.getD1Database('DB'),bucket=await mf.getR2Bucket('BUCKET');
 await db.prepare('CREATE TABLE records(id TEXT PRIMARY KEY,owner TEXT,entity TEXT,data TEXT,created TEXT,updated TEXT)').run();
 const bytes=new TextEncoder().encode('%PDF-1.7\noriginal'),source={key:'jim/source',name:'merged.pdf',size:bytes.length,mime_type:'application/pdf',workflow:'akron',source_ids:['invoice-a'],review_note:'Retained correction',drive_file_id:'private-original'};
 await bucket.put(source.key,bytes);await db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)').bind('doc','jim','Document',JSON.stringify(source),'now','now').run();
 let generated=0,uploadCount=0,shareCount=0,lostUpload=false,lostPermission=false,deny=false;const files=new Map(),permissions=new Map();
 const missing=()=>Object.assign(Error('Not found'),{providerStatus:404});
 const provider={generateId:async()=> 'customer'+(++generated),file:async id=>{if(!files.has(id))throw missing();return files.get(id);},upload:async(metadata,data)=>{uploadCount++;assert.deepEqual(metadata.parents,['managed-shared']);assert.equal(metadata.appProperties.flowstack_customer_copy,'true');const file={...metadata,md5Checksum:computeMd5(data),webViewLink:'https://drive.google.com/file/d/'+metadata.id+'/view',webContentLink:'https://drive.google.com/download/'+metadata.id};files.set(metadata.id,file);permissions.set(metadata.id,[]);if(lostUpload){lostUpload=false;throw Error('Upload response lost');}return file;},permissions:async id=>{if(!files.has(id))throw missing();return permissions.get(id).slice();},share:async id=>{if(deny)throw Object.assign(Error('Sharing denied'),{providerStatus:403});shareCount++;permissions.get(id).push({id:'public',type:'anyone',role:'reader',allowFileDiscovery:false});if(lostPermission){lostPermission=false;throw Error('Permission response lost');}},revoke:async(id,p)=>{permissions.set(id,permissions.get(id).filter(x=>x.id!==p));}};
 withManagedFolders(provider);
 const context={owner:'jim',db,bucket,provider};const send=(action='create',more={},ctx=context,origin='https://test.local')=>driveSharing(new Request('https://test.local/api/flow/functions/shareDocument',{method:'POST',headers:{origin},body:JSON.stringify({document_id:'doc',action,confirmed:true,...more})}),ctx);
 return {mf,db,bucket,bytes,source,send,context,permissions,files,counts:()=>({generated,uploadCount,shareCount}),loseUpload:()=>{lostUpload=true;},losePermission:()=>{lostPermission=true;},deny:()=>{deny=true;}};
}
test('Customer link uses a separate verified copy, repeated create reuses it and revoke removes only its public access',async()=>{
 const f=await setup();try{
  assert.equal((await f.send('create',{confirmed:false})).status,400);assert.equal((await f.send('create',{}, {...f.context,owner:'other'})).status,404);assert.equal((await f.send('create',{},f.context,'https://evil.example')).status,403);
  const created=await f.send();assert.equal(created.status,200,await created.clone().text());const s=(await created.json()).share;assert.equal(s.status,'active');assert.equal(s.automatic_expiry,false);assert.match(s.download_link,/customer1/);assert.equal(f.files.has('private-original'),false);
  assert.equal((await f.send()).status,200);assert.deepEqual(f.counts(),{generated:1,uploadCount:1,shareCount:1});
  const stored=await f.db.prepare("SELECT data FROM records WHERE entity='Document' AND id='doc'").first();assert.deepEqual(JSON.parse(stored.data),f.source);assert.deepEqual(new Uint8Array(await (await f.bucket.get(f.source.key)).arrayBuffer()),f.bytes);
  const revoked=await (await f.send('revoke')).json();assert.equal(revoked.share.status,'revoked');assert.equal(revoked.share.download_link,null);assert.equal(f.permissions.get('customer1').length,0);
  assert.equal((await f.send()).status,200);assert.deepEqual(f.counts(),{generated:1,uploadCount:1,shareCount:2});
 }finally{await f.mf.dispose();}
});
test('Lost upload and permission responses remain retry-safe; denied sharing never returns a successful public link',async()=>{
 const f=await setup();try{
  f.loseUpload();assert.equal((await f.send()).status,422);f.losePermission();assert.equal((await f.send()).status,422);assert.equal((await f.send()).status,200);assert.deepEqual(f.counts(),{generated:1,uploadCount:1,shareCount:1});
  await f.send('revoke');f.deny();const failed=await f.send();assert.equal(failed.status,403);assert.equal((await failed.json()).share.download_link,null);
 }finally{await f.mf.dispose();}
});
test('Drive permission adapter uses read-only unlisted access and handles 204 revocation',async()=>{
 const calls=[];const p=googleProvider('fixture',async(url,options)=>{calls.push({url,options});if(options.method==='DELETE')return new Response(null,{status:204});if(options.method==='POST')return Response.json({id:'public'});return Response.json({permissions:[]});});
 await p.share('file');assert.deepEqual(JSON.parse(calls[0].options.body),{type:'anyone',role:'reader',allowFileDiscovery:false});await p.revoke('file','public');assert.match(calls[1].url,/files\/file\/permissions\/public/);assert.equal(calls[1].options.method,'DELETE');assert.equal(calls[1].options.headers.Authorization,'Bearer fixture');
});
test('70 MB Drive reference sharing uses server-side copy only, retries lost responses, and rejects changed sources',async()=>{
 const f=await setup();try{
  const source={name:'large.pdf',size:70*1024*1024,mime_type:'application/pdf',storage_kind:'drive_reference',source_drive_file_id:'original',md5:'verified-md5'};
  await f.db.prepare("UPDATE records SET data=? WHERE id='doc'").bind(JSON.stringify(source)).run();
  f.files.set('original',{id:'original',mimeType:'application/pdf',size:source.size,md5Checksum:source.md5,parents:['supplier']});
  let copies=0,lost=true;
  const provider={...f.context.provider,root:async()=>({id:'root',mimeType:'application/vnd.google-apps.folder'}),upload:async()=>{throw Error('No binary upload allowed');},copy:async(id,metadata)=>{assert.equal(id,'original');assert.deepEqual(metadata.parents,['managed-shared']);copies++;const result={...metadata,size:source.size,md5Checksum:source.md5,webViewLink:'https://drive.google.com/file/d/'+metadata.id+'/view'};f.files.set(metadata.id,result);f.permissions.set(metadata.id,[]);if(lost){lost=false;throw Error('Response lost');}return result;}};
  const ctx={...f.context,provider,bucket:{get:async()=>{throw Error('No R2 reads allowed');}}};
  assert.equal((await f.send('create',{},ctx)).status,422);
  const response=await f.send('create',{},ctx);assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).share.status,'active');
  assert.equal((await f.send('create',{},ctx)).status,200);assert.equal(copies,1);assert.equal(f.permissions.get('original'),undefined);
  assert.equal((await f.send('revoke',{},ctx)).status,200);assert.equal(f.permissions.get('customer1').length,0);
  f.files.get('original').md5Checksum='changed';assert.equal((await f.send('create',{},ctx)).status,422);
 }finally{await f.mf.dispose();}
});
test('Drive copy adapter preserves generated ID and private root destination',async()=>{
 const calls=[];const p=googleProvider('fixture',async(url,options)=>{calls.push({url,options});return Response.json({id:'root'});});
 await p.root();await p.copy('original',{id:'generated',parents:['root'],name:'large.pdf'});
 assert.match(calls[0].url,/files\/root/);assert.match(calls[1].url,/files\/original\/copy/);assert.match(calls[1].url,/ignoreDefaultVisibility=true/);assert.deepEqual(JSON.parse(calls[1].options.body),{id:'generated',parents:['root'],name:'large.pdf'});
});
test('Fresh link checks detect externally removed permissions, restricted downloads and changed/deleted copies',async()=>{
 const f=await setup();try{
  assert.equal((await f.send()).status,200);let response=await f.send('check');assert.equal(response.status,200);let s=(await response.json()).share;assert.equal(s.status,'active');assert.ok(s.checked_at);
  f.permissions.set('customer1',[]);s=(await (await f.send('check')).json()).share;assert.equal(s.status,'revoked');assert.equal(s.download_link,null);assert.match(s.verification_reason,/no longer enabled/);
  assert.equal((await f.send()).status,200);f.files.get('customer1').copyRequiresWriterPermission=true;s=(await (await f.send('check')).json()).share;assert.equal(s.status,'blocked');assert.equal(s.view_link,null);assert.match(s.verification_reason,/restricts/);
  assert.equal((await f.send()).status,422);f.files.get('customer1').copyRequiresWriterPermission=false;f.files.get('customer1').downloadRestrictions={effectiveDownloadRestrictionWithContext:{restrictedForReaders:true}};s=(await (await f.send('check')).json()).share;assert.equal(s.status,'blocked');
  delete f.files.get('customer1').downloadRestrictions;assert.equal((await f.send('check')).status,200);f.files.get('customer1').md5Checksum='edited';s=(await (await f.send('check')).json()).share;assert.equal(s.status,'blocked');assert.match(s.verification_reason,/changed/);
  f.files.delete('customer1');s=(await (await f.send('check')).json()).share;assert.equal(s.status,'unavailable');assert.equal(s.download_link,null);assert.equal((await f.send('revoke')).status,200);
 }finally{await f.mf.dispose();}
});
test('Fresh check never converts a provider failure into a confirmed revoked or active result',async()=>{
 const f=await setup();try{
  await f.send();const ctx={...f.context,provider:{...f.context.provider,file:async()=>{throw Object.assign(Error('Google rate limit'),{providerStatus:429});}}};const response=await f.send('check',{},ctx);assert.equal(response.status,422);assert.match((await response.json()).error,/rate limit/);
  assert.equal((await f.send('check',{}, {...f.context,owner:'other'})).status,404);
  assert.equal((await f.send('check',{},f.context,'https://evil.example')).status,403);
 }finally{await f.mf.dispose();}
});
