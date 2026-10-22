import {withManagedFolders} from './helpers/managed-folders.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {collectWorkflow,workflowFiles} from '../lib/workflow-collection.mjs';
import {computeMd5} from '../lib/content-metadata.mjs';
import {googleProvider,attachments} from '../lib/google-provider.mjs';
const require=createRequire(resolve('package.json'));const {Miniflare}=require(require.resolve('miniflare',{paths:[require.resolve('wrangler')]}));
const req=(data,origin='https://test.local')=>new Request('https://test.local/api/flow/functions/downloadPdfs',{method:'POST',headers:{origin},body:JSON.stringify(data)});
async function setup(){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-05-15',d1Databases:['DB'],r2Buckets:['BUCKET']});
 const db=await mf.getD1Database('DB'),bucket=await mf.getR2Bucket('BUCKET');
 await db.prepare('CREATE TABLE records(id TEXT PRIMARY KEY,owner TEXT,entity TEXT,data TEXT,created TEXT,updated TEXT)').run();await db.prepare('CREATE TABLE document_content(owner TEXT,workflow TEXT,hash TEXT,document_id TEXT,PRIMARY KEY(owner,workflow,hash))').run();
 const put=async(id,entity,data,owner='jim')=>db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)').bind(id,owner,entity,JSON.stringify(data),'2026-10-06','2026-10-06').run();
 await put('akron','Supplier',{name:'AkronGpt',search_type:'sender_email',email:'vendor@example.com',file_types:['pdf'],drive_folder_name:'Gmail Files'});
 const files=[],folders=[],uploads=[],messages=new Map(),content=new Map();let ids=0,searches=0,failUpload=false,loseUpload=false;
 for(let i=0;i<7;i++){const messageId='m'+i;const bytes=new TextEncoder().encode('%PDF-1.7\n'+(i===6?'same-as-first':'item-'+i));if(i===6)bytes.set(new TextEncoder().encode('%PDF-1.7\nitem-0'));content.set(messageId,bytes);messages.set(messageId,{internalDate:'1791310000000',payload:{parts:[{partId:'1',filename:'invoice.pdf',body:{attachmentId:'a'+i,size:bytes.length}}]}});}
 // Last message is a byte-identical file under another filename.
 content.set('m6',content.get('m0'));messages.get('m6').payload.parts[0].filename='different.pdf';
 const provider={
  generateId:async()=> 'drive'+(++ids),
  folders:async name=>folders.filter(f=>f.name===name),folder:async id=>{const f=folders.find(f=>f.id===id);if(!f)throw Object.assign(Error('Not found'),{providerStatus:404});return f;},
  createFolder:async m=>{folders.push(m);return m;},files:async id=>files.filter(f=>f.parents.includes(id)),file:async id=>{const f=files.find(f=>f.id===id);if(!f)throw Object.assign(Error('Not found'),{providerStatus:404});return f;},
  upload:async(m,b)=>{if(failUpload){failUpload=false;throw Error('Drive temporarily unavailable');}const file={...m,md5Checksum:computeMd5(b),size:b.length};files.push(file);uploads.push(m);if(loseUpload&&m.appProperties.source_email_id==='m1'){loseUpload=false;throw Error('Upload response lost');}return file;},
  search:async(q,page)=>{assert.equal(q,'from:vendor@example.com has:attachment');searches++;return page?{messages:[...messages.keys()].slice(4).map(id=>({id}))}:{messages:[...messages.keys()].slice(0,4).map(id=>({id})),nextPageToken:'second'};},
  read:async id=>messages.get(id),bytes:async id=>content.get(id),
 };
 withManagedFolders(provider);
 const context={db,bucket,owner:'jim',provider};
 const run=async()=>{let result,job_id;for(let n=0;n<20;n++){const response=await collectWorkflow(req({supplier_id:'akron',...(job_id?{job_id}:{})}),context);assert.equal(response.status,200,await response.clone().text());result=await response.json();job_id=result.job_id;if(!result.needs_continue)return result;}throw Error('Did not finish');};
 return {mf,db,bucket,put,provider,context,run,files,folders,uploads,messages,content,setFail:()=>{failUpload=true;},setLost:()=>{loseUpload=true;},searches:()=>searches};
}
test('collection persists originals, follows all Gmail pages, separates Drive counts, retains same-name content and skips reruns',async()=>{
 const f=await setup();try{
  const first=await f.run();assert.equal(first.totals.emails_found,7);assert.equal(first.totals.files_saved,6);assert.equal(first.totals.drive_saved,6);assert.equal(first.totals.duplicates_skipped,1);assert.equal(first.totals.errors,0);assert.equal(f.folders.length,1);assert.equal(f.files.length,6);assert.ok(f.files.some(file=>file.name.includes('[alt-')));assert.equal(f.searches(),2);
  const docs=(await f.db.prepare("SELECT data FROM records WHERE entity='Document'").all()).results.map(r=>JSON.parse(r.data));assert.equal(docs.length,6);for(const d of docs){assert.equal(d.drive_sync_status,'saved');assert.equal(d.source_kind,'gmail');assert.deepEqual(new Uint8Array(await (await f.bucket.get(d.key)).arrayBuffer()),f.content.get(d.source_email_id));}assert.ok(f.uploads.every(m=>m.parents[0]===f.folders[0].id));assert.ok(f.uploads.every(m=>!m.createdTime));
  const again=await f.run();assert.equal(again.totals.files_saved,0);assert.equal(again.totals.drive_saved,0);assert.equal(again.totals.duplicates_skipped,7);assert.equal(f.files.length,6);assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM records WHERE entity='RunHistory'").first()).n,2);
  const listing=await workflowFiles(req({supplier_id:'akron'}),f.context);const data=await listing.json();assert.equal(data.files.length,6);assert.equal(data.pdf_count,6);assert.ok(data.files.every(x=>x.web_view_link));
 }finally{await f.mf.dispose();}
});
test('Drive errors preserve originals, report partial history and retry safely after a lost upload response',async()=>{
 const f=await setup();try{
  f.setLost();const first=await f.run();assert.equal(first.totals.errors,1);assert.equal(first.totals.status,'partial');assert.equal(first.totals.files_saved,6);assert.equal(f.files.length,6);
  const docs=(await f.db.prepare("SELECT data FROM records WHERE entity='Document'").all()).results.map(r=>JSON.parse(r.data));assert.ok(docs.some(d=>d.drive_sync_status==='failed'));
  const next=await f.run();assert.equal(next.totals.errors,0);assert.equal(f.files.length,6);assert.equal(f.uploads.length,6);assert.equal(next.totals.files_saved,0);assert.ok((await f.db.prepare("SELECT data FROM records WHERE entity='RunHistory' ORDER BY created").all()).results.some(r=>JSON.parse(r.data).error_details[0]?.reason==='Upload response lost'));
 }finally{await f.mf.dispose();}
});
test('resuming a durable job, retrying its final response, owner isolation, ambiguous folders and denied access',async()=>{
 const f=await setup();try{
  assert.equal((await collectWorkflow(req({supplier_id:'akron'}),{...f.context,owner:'other'})).status,404);
  assert.equal((await collectWorkflow(req({supplier_id:'akron'},'https://evil.example'),f.context)).status,403);
  assert.equal((await collectWorkflow(req({supplier_id:'akron'}),{...f.context,provider:null})).status,503);
  const first=await (await collectWorkflow(req({supplier_id:'akron'}),f.context)).json();assert.equal(first.needs_continue,true);const resumed=await f.run();assert.equal(resumed.job_id,first.job_id);const finished=await (await collectWorkflow(req({supplier_id:'akron',job_id:first.job_id}),f.context)).json();assert.equal(finished.needs_continue,false);assert.equal(f.files.length,6);
  await f.put('ambiguous','Supplier',{name:'Ambiguous',search_type:'sender_email',email:'vendor@example.com',drive_folder_name:'Same'});f.folders.push({id:'x',name:'Same'},{id:'y',name:'Same'});assert.equal((await collectWorkflow(req({supplier_id:'ambiguous'}),f.context)).status,502);assert.equal(f.folders.length,3);
  const deny={...f.provider,folder:async()=>{throw Object.assign(Error('Denied'),{providerStatus:403});}};const before=f.files.length;assert.equal((await collectWorkflow(req({supplier_id:'akron'}),{...f.context,provider:deny})).status,502);assert.equal(f.files.length,before);
 }finally{await f.mf.dispose();}
});
test('provider normalizes empty listings, decodes base64url attachments and fixed Drive retry contract',async()=>{
 const seen=[];const provider=googleProvider('fixture',async(url,options)=>{seen.push({url,options});if(url.includes('/attachments/'))return Response.json({data:Buffer.from('%PDF-1.7\nexample').toString('base64url')});return Response.json({});});
 assert.deepEqual((await provider.search('test')).messages,[]);assert.deepEqual(await provider.files('folder'),[]);assert.match(new TextDecoder().decode(await provider.bytes('message',{attachment_id:'a'})),/^%PDF/);
 assert.equal(attachments({parts:[{filename:'x.pdf',partId:'a',body:{data:'eA=='}},{filename:'x.zip',body:{attachmentId:'z'}}]},new Set(['pdf'])).length,1);assert.ok(seen.every(r=>r.options.headers.Authorization==='Bearer fixture'));
 const errorProvider=googleProvider('fixture',async()=>new Response('',{status:403}));await assert.rejects(()=>errorProvider.files('folder'),/Drive denied/);
});
test('successful checkpoint advances only on complete error-free collection; targeted retry preserves originals and prior history',async()=>{
 const f=await setup();try{
  f.setLost();const failed=await f.run();
  const workflow=async()=>JSON.parse((await f.db.prepare("SELECT data FROM records WHERE id='akron'").first()).data);
  assert.equal((await workflow()).collection_checkpoint,undefined);
  const reads=[],provider={...f.provider,read:async id=>{reads.push(id);return f.provider.read(id);},bytes:async()=>{throw Error('A saved original must be reused, not downloaded again.');}};
  const r=await collectWorkflow(req({supplier_id:'akron',retry_failed:true}),{...f.context,provider});assert.equal(r.status,200);
  const retried=await r.json();assert.equal(retried.needs_continue,false);assert.equal(retried.totals.errors,0);assert.equal(retried.totals.retry_of,failed.job_id);assert.deepEqual(reads,['m1']);
  assert.equal(f.files.length,6);assert.equal(f.uploads.length,6);
  const saved=await workflow();assert.ok(saved.last_successful_check);assert.equal(saved.collection_checkpoint.through,failed.totals.run_date);
  const original=JSON.parse((await f.db.prepare('SELECT data FROM records WHERE id=?').bind(failed.job_id).first()).data);assert.equal(original.errors,1);assert.equal(original.status,'partial');
  assert.equal((await collectWorkflow(req({supplier_id:'akron',retry_failed:true}),f.context)).status,409);
 }finally{await f.mf.dispose();}
});
test('incremental checks use the successful overlap window; no matches complete honestly and changed criteria require full search',async()=>{
 const f=await setup();try{
  const first=await f.run();const workflow=JSON.parse((await f.db.prepare("SELECT data FROM records WHERE id='akron'").first()).data);
  assert.equal(workflow.last_successful_check,first.totals.run_date);
  const queries=[],provider={...f.provider,search:async query=>{queries.push(query);return {messages:[]};}};
  const r=await collectWorkflow(req({supplier_id:'akron',mode:'incremental'}),{...f.context,provider});assert.equal(r.status,200);const result=await r.json();
  assert.equal(result.needs_continue,false);assert.equal(result.totals.errors,0);assert.equal(result.totals.files_saved,0);assert.equal(result.totals.collection_mode,'incremental');
  assert.ok(queries[0].includes('after:'+Math.floor((Date.parse(workflow.last_successful_check)-48*3600000)/1000)));assert.match(queries[0],/ before:\d+$/);
  await f.db.prepare("UPDATE records SET data=json_set(data,'$.email','changed@example.com') WHERE id='akron'").run();
  const full=await (await collectWorkflow(req({supplier_id:'akron',mode:'incremental'}),{...f.context,provider})).json();assert.equal(full.totals.collection_mode,'full');assert.equal(queries[1],'from:changed@example.com has:attachment');
  assert.equal(f.files.length,6);
 }finally{await f.mf.dispose();}
});
test('an interrupted or failed check leaves a prior successful checkpoint unchanged, including a missing retry attachment',async()=>{
 const f=await setup();try{
  await f.run();const before=JSON.parse((await f.db.prepare("SELECT data FROM records WHERE id='akron'").first()).data).collection_checkpoint;
  const failed=await collectWorkflow(req({supplier_id:'akron'}),{...f.context,provider:{...f.provider,search:async()=>{throw Error('Gmail unavailable');}}});assert.equal(failed.status,502);
  assert.deepEqual(JSON.parse((await f.db.prepare("SELECT data FROM records WHERE id='akron'").first()).data).collection_checkpoint,before);
  // Resume the interrupted job rather than changing its saved query or checkpoint.
  const resumed=await f.run();assert.equal(resumed.totals.errors,0);
  const successful=JSON.parse((await f.db.prepare("SELECT data FROM records WHERE id='akron'").first()).data).collection_checkpoint;
  f.provider.bytes=async()=>{throw Error('Attachment temporarily unavailable');};await f.run();
  f.messages.get('m0').payload.parts=[];
  assert.equal((await collectWorkflow(req({supplier_id:'akron',retry_failed:true}),f.context)).status,502);
  assert.deepEqual(JSON.parse((await f.db.prepare("SELECT data FROM records WHERE id='akron'").first()).data).collection_checkpoint,successful);
 }finally{await f.mf.dispose();}
});
test('a corrupt saved original blocks retry and leaves the successful checkpoint unset instead of redownloading or overwriting it',async()=>{
 const f=await setup();try{
  f.setLost();await f.run();
  const record=(await f.db.prepare("SELECT data FROM records WHERE entity='Document' AND json_extract(data,'$.drive_sync_status')='failed'").first());
  const source=JSON.parse(record.data),changed=new TextEncoder().encode('%PDF-1.7\nTEST CORRUPTION');await f.bucket.put(source.key,changed);
  const result=await (await collectWorkflow(req({supplier_id:'akron',retry_failed:true}),f.context)).json();
  assert.equal(result.totals.errors,1);assert.match(result.totals.error_details[0].reason,/integrity check/);
  assert.equal(JSON.parse((await f.db.prepare("SELECT data FROM records WHERE id='akron'").first()).data).collection_checkpoint,undefined);
  assert.deepEqual(new Uint8Array(await (await f.bucket.get(source.key)).arrayBuffer()),changed);
 }finally{await f.mf.dispose();}
});
test('existing Drive originals are reused, upload failures keep local bytes, and concurrent runs cannot duplicate saves',async()=>{
 const f=await setup();try{
  f.folders.push({id:'existing',name:'Gmail Files',mimeType:'application/vnd.google-apps.folder'});f.files.push({id:'old-file',name:'original.pdf',md5Checksum:computeMd5(f.content.get('m0')),parents:['existing']});
  f.setFail();const first=await f.run();assert.equal(first.totals.errors,1);assert.equal(first.totals.files_saved,6);assert.equal(f.files.length,5);assert.ok(first.totals.error_details.some(e=>e.reason==='Drive temporarily unavailable'));
  await f.run();assert.equal(f.files.length,6);assert.equal(f.files.filter(x=>x.md5Checksum===computeMd5(f.content.get('m0'))).length,1);
  let release,entered;const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});let once=true;
  const paused={...f.provider,read:async id=>{if(once){once=false;entered();await gate;}return f.provider.read(id);}};
  const running=collectWorkflow(req({supplier_id:'akron'}),{...f.context,provider:paused});await started;
  assert.equal((await collectWorkflow(req({supplier_id:'akron'}),f.context)).status,409);release();assert.equal((await running).status,200);await f.run();assert.equal(f.files.length,6);
 }finally{await f.mf.dispose();}
});
