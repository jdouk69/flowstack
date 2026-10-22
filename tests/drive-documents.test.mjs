import {withManagedFolders} from './helpers/managed-folders.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {PDFDocument} from 'pdf-lib';
import {workflowFiles} from '../lib/workflow-collection.mjs';
import {driveDocuments} from '../lib/drive-documents.mjs';
import {googleProvider} from '../lib/google-provider.mjs';
import {computeMd5} from '../lib/content-metadata.mjs';
const require=createRequire(resolve('package.json'));const {Miniflare}=require(require.resolve('miniflare',{paths:[require.resolve('wrangler')]}));
async function setup(){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-05-15',d1Databases:['DB'],r2Buckets:['BUCKET']});const db=await mf.getD1Database('DB'),bucket=await mf.getR2Bucket('BUCKET');
 await db.prepare('CREATE TABLE records(id TEXT PRIMARY KEY,owner TEXT,entity TEXT,data TEXT,created TEXT,updated TEXT)').run();await db.prepare('CREATE TABLE document_content(owner TEXT,workflow TEXT,hash TEXT,document_id TEXT,PRIMARY KEY(owner,workflow,hash))').run();
 await db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)').bind('akron','jim','Supplier',JSON.stringify({name:'AkronGpt',drive_folder_name:'Invoices',drive_folder_id:'folder'}),'2026-10-06','2026-10-06').run();
 const files=[],content=new Map();for(let i=0;i<2;i++){const pdf=await PDFDocument.create();pdf.addPage([200+i*10,300]).drawText('Original '+i);const bytes=await pdf.save(),id='original'+i;content.set(id,bytes);files.push({id,name:'invoice'+i+'.pdf',size:bytes.length,mimeType:'application/pdf',md5Checksum:computeMd5(bytes),parents:['folder'],appProperties:{}});}
 let generated=0,lost=false;const uploads=[];
 const provider={folder:async id=>({id,name:'Invoices',mimeType:'application/vnd.google-apps.folder'}),files:async folder=>files.filter(f=>f.parents.includes(folder)),download:async id=>content.get(id),generateId:async()=> 'generated'+(++generated),file:async id=>{const f=files.find(f=>f.id===id);if(!f)throw Object.assign(Error('Not found'),{providerStatus:404});return f;},upload:async(m,bytes)=>{const f={...m,size:bytes.length,md5Checksum:computeMd5(bytes)};files.push(f);content.set(m.id,bytes);uploads.push(f);if(lost){lost=false;throw Error('Upload response lost');}return f;}};
 withManagedFolders(provider);
 const context={owner:'jim',db,bucket,provider};
 const send=(action,input={},ctx=context,origin='https://test.local')=>driveDocuments(new Request('https://test.local/api/flow/functions/'+action,{method:'POST',headers:{origin},body:JSON.stringify({supplier_id:'akron',...input})}),ctx);
 return {mf,db,bucket,files,content,uploads,provider,context,send,setLost:()=>{lost=true;}};
}
test('Drive imports preserve exact originals and merge creates one retry-safe Drive output with separate source links',async()=>{
 const f=await setup();try{
  const first=await (await f.send('importDriveFiles')).json();assert.equal(first.files_saved,2);assert.equal(first.documents.length,2);assert.ok(first.documents.every(d=>!('key' in d)&&d.source_drive_link));
  const repeat=await (await f.send('importDriveFiles')).json();assert.equal(repeat.files_saved,0);assert.equal(repeat.duplicates_skipped,2);
  const response=await f.send('mergePdfs',{ids:['original1','original0']});assert.equal(response.status,200,await response.clone().text());const merged=await response.json();assert.equal(merged.pdf_count,2);assert.equal(merged.document.source_ids.length,2);assert.equal(f.uploads.length,1);assert.equal(f.files.length,3);assert.deepEqual(merged.document.drive_folder_id,'managed-merged');const listing=await workflowFiles(new Request('https://test.local/api/flow/functions/listWorkflowFiles',{method:'POST',body:JSON.stringify({supplier_id:'akron'})}),f.context);assert.equal(listing.status,200);assert.equal((await listing.json()).files.length,3);
  const data=(await f.db.prepare("SELECT data FROM records WHERE entity='Document' AND id=?").bind(merged.document.id).first()).data;const stored=JSON.parse(data),pdf=await PDFDocument.load(await (await f.bucket.get(stored.key)).arrayBuffer());assert.equal(pdf.getPageCount(),2);assert.equal(pdf.getPage(0).getWidth(),210);assert.equal(pdf.getPage(1).getWidth(),200);
  const again=await (await f.send('mergePdfs',{ids:['original1','original0']})).json();assert.equal(again.document.id,merged.document.id);assert.equal(again.already_merged,true);assert.equal(f.uploads.length,1);assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM records WHERE entity='Document'").first()).n,3);
  const originals=(await f.db.prepare("SELECT data FROM records WHERE entity='Document' AND json_extract(data,'$.merged')=0").all()).results;for(const row of originals){const d=JSON.parse(row.data);assert.deepEqual(new Uint8Array(await (await f.bucket.get(d.key)).arrayBuffer()),f.content.get(d.source_drive_file_id));}
 }finally{await f.mf.dispose();}
});
test('lost Drive merge response retains local output and retries the same ID without another upload',async()=>{
 const f=await setup();try{
  f.setLost();const failed=await f.send('mergePdfs');assert.equal(failed.status,422);const data=await failed.json();assert.equal(data.document.drive_sync_status,'failed');assert.equal(f.uploads.length,1);assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM records WHERE entity='Document'").first()).n,3);
  const next=await f.send('mergePdfs');assert.equal(next.status,200,await next.clone().text());const recovered=await next.json();assert.equal(recovered.document.id,data.document.id);assert.equal(recovered.document.drive_sync_status,'saved');assert.equal(f.uploads.length,1);assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM records WHERE entity='RunHistory'").first()).n,1);
 }finally{await f.mf.dispose();}
});
test('Drive owner/folder guards, unreadable originals and changed bytes do not create silent partial merges',async()=>{
 const f=await setup();try{
  assert.equal((await f.send('mergePdfs',{}, {...f.context,owner:'other'})).status,404);assert.equal((await f.send('mergePdfs',{},f.context,'https://evil.example')).status,403);assert.equal((await f.send('mergePdfs',{ids:['original0','foreign']})).status,404);
  const bad=new TextEncoder().encode('%PDF-1.7\nnot parseable');f.content.set('original1',bad);f.files[1].size=bad.length;f.files[1].md5Checksum=computeMd5(bad);
  const failed=await f.send('mergePdfs');assert.equal(failed.status,422);assert.match((await failed.json()).error,/encrypted or unreadable/);assert.equal(f.uploads.length,0);assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM records WHERE entity='Document'").first()).n,2);
  const changed={...f.provider,download:async()=>new TextEncoder().encode('%PDF-changed')};const r=await f.send('importDriveFiles',{}, {...f.context,provider:changed});assert.equal(r.status,200);const result=await r.json();assert.equal(result.errors,2);assert.equal(result.status,'failed');assert.equal(result.files_saved,0);
 }finally{await f.mf.dispose();}
});
test('Drive provider reads binary bytes and refuses oversized streamed responses',async()=>{
 const bytes=new TextEncoder().encode('%PDF-1.7\nsource');const provider=googleProvider('fixture',async(url,options)=>{assert.match(url,/alt=media/);assert.equal(options.headers.Authorization,'Bearer fixture');return new Response(bytes);});assert.deepEqual(await provider.download('id'),bytes);
 const oversized=googleProvider('fixture',async()=>new Response('x',{headers:{'content-length':String(11*1024*1024)}}));await assert.rejects(()=>oversized.download('id'),/10 MB/);
});
test('Explicit Drive exports preserve workflow/source/review data and safely retry lost responses',async()=>{
 const f=await setup();try{
  const bytes=f.content.get('original0'),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  const source={key:'jim/manual.pdf',name:'manual.pdf',original_name:'manual.pdf',hash:digest,size:bytes.length,mime_type:'application/pdf',workflow:'',merged:true,source_ids:['retained-original'],review_note:'Keep correction'};
  await f.bucket.put(source.key,bytes);await f.db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)').bind('manual','jim','Document',JSON.stringify(source),'now','now').run();
  assert.equal((await f.send('exportDriveDocument')).status,400);assert.equal((await f.send('exportDriveDocument',{document_id:'missing'})).status,404);assert.equal((await f.send('exportDriveDocument',{document_id:'manual'},f.context,'https://evil.example')).status,403);
  // Remove identical external fixtures to exercise a new upload and lost response.
  f.files.splice(0);f.setLost();assert.equal((await f.send('exportDriveDocument',{document_id:'manual'})).status,422);assert.equal(f.uploads.length,1);
  const retry=await f.send('exportDriveDocument',{document_id:'manual'});assert.equal(retry.status,200,await retry.clone().text());const result=await retry.json();assert.equal(result.already_saved,true);assert.equal(f.uploads.length,1);assert.equal(result.document.workflow,'');assert.equal(result.document.review_note,'Keep correction');assert.deepEqual(result.document.source_ids,['retained-original']);assert.equal(result.document.drive_file_id,undefined);assert.equal(result.document.drive_exports.length,1);assert.equal(f.uploads[0].appProperties.flowstack_merged,'true');
  const again=await (await f.send('exportDriveDocument',{document_id:'manual'})).json();assert.equal(again.document.drive_exports.length,1);assert.equal(f.uploads.length,1);assert.deepEqual(new Uint8Array(await (await f.bucket.get(source.key)).arrayBuffer()),bytes);
  // Another destination gets its own copy without reassigning the original.
  await f.db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)').bind('other-folder','jim','Supplier',JSON.stringify({name:'Other',drive_folder_id:'folder2'}),'now','now').run();
  const moved=await f.send('exportDriveDocument',{document_id:'manual',supplier_id:'other-folder'});assert.equal(moved.status,200,await moved.clone().text());assert.equal((await moved.json()).document.drive_exports.length,2);assert.equal(f.uploads.length,2);assert.deepEqual(f.uploads[1].parents,['folder2']);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM records WHERE entity='Document'").first()).n,1);
 }finally{await f.mf.dispose();}
});
test('Large Drive references persist without downloads and repeated linking adds no duplicate document',async()=>{
 const f=await setup();try{
  const file={id:'large',name:'customer_merged_large.pdf',mimeType:'application/pdf',size:70*1024*1024,md5Checksum:'large-md5',parents:['folder'],appProperties:{flowstack_merged:'true'}};f.files.push(file);
  const ctx={...f.context,bucket:{put:async()=>{throw Error('No R2 write allowed');}},provider:{...f.provider,download:async()=>{throw Error('No binary download allowed');}}};
  const response=await f.send('linkDrivePdf',{file_id:'large'},ctx);assert.equal(response.status,200,await response.clone().text());const first=await response.json();assert.equal(first.document.storage_kind,'drive_reference');assert.equal(first.document.size,file.size);assert.equal(first.files_saved,0);
  const again=await (await f.send('linkDrivePdf',{file_id:'large'},ctx)).json();assert.equal(again.document.id,first.document.id);assert.equal(again.already_linked,true);assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM records WHERE entity='Document'").first()).n,1);
  file.parents=['foreign'];assert.equal((await f.send('linkDrivePdf',{file_id:'large'},ctx)).status,404);assert.equal((await f.send('linkDrivePdf',{file_id:'large'},{...ctx,owner:'other'})).status,404);
  assert.equal((await f.send('exportDriveDocument',{document_id:first.document.id},ctx)).status,409);
 }finally{await f.mf.dispose();}
});
test('Planned part snapshots reject changed or reordered files before saving any original',async()=>{
 const f=await setup();try{
  const expected=f.files.map(file=>({id:file.id,size:Number(file.size),md5:file.md5Checksum}));
  const changed=expected.map(file=>({...file}));changed[0].md5='changed';assert.equal((await f.send('mergePdfs',{ids:expected.map(f=>f.id),expected_files:changed})).status,409);assert.equal(f.uploads.length,0);assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM records WHERE entity='Document'").first()).n,0);
  assert.equal((await f.send('mergePdfs',{ids:expected.map(f=>f.id),expected_files:[...expected].reverse()})).status,409);
  const merged=await f.send('mergePdfs',{ids:expected.map(f=>f.id),expected_files:expected,part_number:2});assert.equal(merged.status,200,await merged.clone().text());assert.match((await merged.json()).document.name,/ Part 02\.pdf$/);assert.equal((await (await f.send('mergePdfs',{ids:expected.map(f=>f.id),expected_files:expected})).json()).already_merged,true);
  const link=await f.send('linkDrivePdf',{file_id:expected[0].id,expected_files:[{...expected[0],size:1}]});assert.equal(link.status,409);
 }finally{await f.mf.dispose();}
});
