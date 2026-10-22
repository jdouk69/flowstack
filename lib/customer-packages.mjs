import {managedFolder} from './drive-folders.mjs';
import {googleAccess,seal,unseal} from './google-connection.mjs';
import {googleProvider} from './google-provider.mjs';
import {resumableDrive} from './package-upload.mjs';
import {resolveFolder} from './workflow-collection.mjs';
import {computeMd5} from './content-metadata.mjs';
import {downloadBlocked} from './drive-sharing.mjs';
import {CHUNK,packageManifest,zipEntry,zipEnd,joinBytes,md5Start,md5Update,md5Finish} from './package-zip.mjs';
const now=()=>new Date().toISOString();
const reply=(d,s=200)=>Response.json(d,{status:s,headers:{'Cache-Control':'private, no-store'}});
const read=async(db,owner,id,entity)=>{const r=await db.prepare('SELECT data FROM records WHERE owner=? AND id=? AND entity=?').bind(owner,id,entity).first();return r?{...JSON.parse(r.data),id}:null;};
const put=(db,owner,id,data)=>db.prepare("INSERT INTO records(id,owner,entity,data,created,updated) VALUES(?,?,'CustomerPackage',?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated WHERE records.owner=excluded.owner AND records.entity=excluded.entity").bind(id,owner,JSON.stringify(data),data.created,now()).run();
const safe=j=>({id:j.id,name:j.name,filename:j.filename,created:j.created,count:j.manifest.length,total_bytes:j.total,index:j.index,status:j.status,uploaded_bytes:j.uploaded||0,error:j.error||null,drive_link:j.status==='ready'?'https://drive.google.com/file/d/'+encodeURIComponent(j.drive_id)+'/view':null,share_status:j.share_status||'private',download_link:j.share_status==='active'?j.download_link:null,view_link:j.share_status==='active'?j.view_link:null,checked_at:j.checked_at||null,files:j.manifest.map(f=>({name:f.name,zip_name:f.zip_name,size:f.size}))});
async function sources(db,owner,workflow,provider){
 if(workflow){const supplier=await read(db,owner,workflow,'Supplier');if(!supplier)throw Error('Workflow not found.');const folder=await resolveFolder({db,owner,supplier,provider,create:false});if(!folder)throw Error('Collect this workflow first to create its saved folder.');const all=(await provider.files(folder.id)).filter(f=>f.mimeType==='application/pdf'&&!f.trashed&&f.appProperties?.flowstack_merged!=='true'&&!/^merged[ _-]/i.test(f.name));if(all.length>1000)throw Error('This folder has over 1,000 originals. Use a smaller workflow folder.');return all.sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id)).map(f=>({id:f.id,name:f.name,size:Number(f.size),md5:f.md5Checksum,kind:'drive',folder:folder.id}));}
 const rows=(await db.prepare("SELECT id,data FROM records WHERE owner=? AND entity='Document' AND json_extract(data,'$.mime_type')='application/pdf' AND COALESCE(json_extract(data,'$.merged'),0)=0 ORDER BY created DESC,id DESC LIMIT 1001").bind(owner).all()).results;
 if(rows.length>1000)throw Error('Over 1,000 saved PDFs. Choose a Drive workflow folder instead.');return rows.map(r=>{const d=JSON.parse(r.data);return {id:r.id,name:d.name,size:Number(d.size),md5:d.md5,hash:d.key?d.hash:undefined,kind:d.key?'local':'drive',key:d.key,drive_id:d.source_drive_file_id||d.drive_file_id,folder:d.drive_folder_id};});
}
async function sourceBytes(f,{db,bucket,owner,provider}){
 let bytes;if(f.kind==='local'){const d=await read(db,owner,f.id,'Document');if(!d||d.key!==f.key)throw Error('Source PDF was removed or changed: '+f.name);const object=await bucket.get(f.key);if(!object||object.size!==f.size)throw Error('Saved PDF size changed: '+f.name);bytes=new Uint8Array(await object.arrayBuffer());}
 else {const id=f.drive_id||f.id;if(f.drive_id){const d=await read(db,owner,f.id,'Document');if(!d||(d.source_drive_file_id||d.drive_file_id)!==id)throw Error('Source reference changed.');}const file=await provider.file(id);if(file.trashed||file.mimeType!=='application/pdf'||Number(file.size)!==f.size||file.md5Checksum!==f.md5||f.folder&&!file.parents?.includes(f.folder))throw Error('Drive source changed: '+f.name);bytes=await provider.download(id);}
 const sha=f.hash?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join(''):null;
 if(bytes.length!==f.size||f.md5&&computeMd5(bytes)!==f.md5||f.hash&&sha!==f.hash)throw Error('Source PDF checksum changed: '+f.name);return bytes;
}
async function stage(job,bytes,bucket,final=false){
 const previous=job.tail;let tail=new Uint8Array();if(previous){const o=await bucket.get(previous);if(!o||o.size>=CHUNK)throw Error('Package checkpoint unavailable.');tail=new Uint8Array(await o.arrayBuffer());}
 const data=joinBytes(tail,bytes),chunks=[...job.chunks];let at=0,newTail=null;const prefix=job.storage+'/'+crypto.randomUUID();
 while(at+CHUNK<=data.length){const key=prefix+'-'+at;await bucket.put(key,data.subarray(at,at+CHUNK));chunks.push({key,size:CHUNK});at+=CHUNK;}
 if(at<data.length){const key=prefix+'-tail';await bucket.put(key,data.subarray(at));if(final)chunks.push({key,size:data.length-at});else newTail=key;}
 job.chunks=chunks;job.tail=newTail;return previous;
}
async function finish(job,{db,owner,bucket}){job.status='ready';job.uploaded=job.total;job.session=null;await put(db,owner,job.id,job);const removed=await Promise.allSettled(job.chunks.map(c=>bucket.delete(c.key)));if(removed.every(r=>r.status==='fulfilled')){job.chunks=[];job.hash=null;await put(db,owner,job.id,job);}}
async function verify(job,provider,sharing=false){const f=await provider.file(job.drive_id);if(f.trashed||f.id!==job.drive_id||f.mimeType!=='application/zip'||Number(f.size)!==job.total||f.md5Checksum!==job.md5||!f.parents?.includes(job.root_id)||f.appProperties?.flowstack_package!==job.id)throw Error('Saved ZIP could not be verified. Resume or check the package again.');const permissions=await provider.permissions(job.drive_id);if(downloadBlocked(f)||permissions.some(p=>p.type!=='user'&&p.type!=='anyone'||p.type==='user'&&p.role!=='owner'||p.type==='anyone'&&(p.role!=='reader'||p.allowFileDiscovery===true)))throw Error('Package permissions or download restrictions require review in Drive.');if(sharing&&!permissions.some(p=>p.type==='anyone'&&p.role==='reader'))throw Error('Customer access is no longer enabled.');return f;}
export async function customerPackages(req,{owner,db,bucket,key,provider:injected,uploader:injectedUpload,fetcher=fetch}){
 const url=new URL(req.url),segments=url.pathname.split('/packages')[1].split('/').filter(Boolean).map(decodeURIComponent),[id,action]=segments;
 if(req.method==='GET'&&!id){const rows=(await db.prepare("SELECT id,data FROM records WHERE owner=? AND entity='CustomerPackage' ORDER BY created DESC,id DESC LIMIT 201").bind(owner).all()).results;return reply({packages:rows.slice(0,200).map(r=>safe({...JSON.parse(r.data),id:r.id})),has_older:rows.length>200});}
 if(req.method==='GET'&&id&&id!=='sources'){const j=await read(db,owner,id,'CustomerPackage');return j?reply({package:safe(j)}):reply({error:'Package not found'},404);}
 if(!['GET','POST'].includes(req.method))return reply({error:'Method not allowed'},405);
 if(req.method==='POST'&&req.headers.get('origin')!==url.origin)return reply({error:'Invalid request origin'},403);
 let input={};if(req.method==='POST')try{const raw=await req.text();if(raw.length>150000)throw Error();input=JSON.parse(raw);}catch{return reply({error:'Invalid package request'},400);}
 if(id==='sources'&&req.method==='GET'){try{const provider=injected||googleProvider((await googleAccess({owner,db,key,fetcher})).access_token,fetcher);return reply({files:(await sources(db,owner,url.searchParams.get('workflow'),provider)).map(({key,...f})=>f)});}catch(e){return reply({error:e.message},502);}}
 // Read owner-scoped package before accessing Google, including wrong-owner requests.
 if(id&&!(await read(db,owner,id,'CustomerPackage')))return reply({error:'Package not found'},404);
 if(id&&!['step','share','check','revoke','restart-upload'].includes(action))return reply({error:'Unknown package action'},404);
 if(action==='share'&&input.confirmed!==true)return reply({error:'Confirm anyone with this link may download the ZIP.'},400);
 const lockId='collection:lock:'+owner,lease=crypto.randomUUID(),locked=await db.prepare("INSERT INTO records(id,owner,entity,data,created,updated) VALUES(?,?,'CollectionLock',?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated WHERE records.owner=excluded.owner AND CAST(json_extract(records.data,'$.expires') AS INTEGER)<? RETURNING id").bind(lockId,owner,JSON.stringify({lease,expires:Date.now()+180000}),now(),now(),Date.now()).first();
 if(!locked)return reply({error:'Another document operation is running. Retry shortly.'},409);
 let job;try{
 const token=injected?null:(await googleAccess({owner,db,key,fetcher})).access_token,provider=injected||googleProvider(token,fetcher),uploader=injectedUpload||resumableDrive(token,fetcher);
 if(!id){if(typeof input.name!=='string'||!input.name.trim()||input.name.length>150||/[\x00-\x1f/\\]/.test(input.name)||!Array.isArray(input.ids)||!input.ids.length||input.ids.length>1000||new Set(input.ids).size!==input.ids.length)throw Error('Enter a package name and select 1–1,000 PDFs.');const all=await sources(db,owner,input.workflow||null,provider),map=new Map(all.map(f=>[f.id,f]));const chosen=input.ids.map(id=>{if(!map.has(id))throw Error('A selected PDF is unavailable. Reload files.');return map.get(id);}).sort((a,b)=>a.id.localeCompare(b.id));const {manifest,total}=packageManifest(chosen);const name=input.name.trim().replace(/\.zip$/i,'');if(!name)throw Error('Enter a package name.');const signature=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({owner,name,manifest})))),b=>b.toString(16).padStart(2,'0')).join('');const packageId='package:'+signature;job=await read(db,owner,packageId,'CustomerPackage');if(!job){job={id:packageId,name,filename:name+'.zip',created:now(),manifest,total,status:'building',index:0,entries:[],offset:0,chunks:[],tail:null,hash:md5Start(),uploaded:0,storage:owner+'/packages/'+signature};await put(db,owner,job.id,job);}return reply({package:safe(job)});}
 job=await read(db,owner,id,'CustomerPackage');job.error=null;const save=()=>put(db,owner,job.id,job);
 if(action==='step'){
  if(job.status==='building'){
   let bytes;if(job.index<job.manifest.length){const f=job.manifest[job.index],source=await sourceBytes(f,{db,bucket,owner,provider}),entry=zipEntry(f,source,job.offset);bytes=entry.bytes;job.entries.push(entry.entry);job.index++;job.offset+=bytes.length;}
   else{bytes=zipEnd(job.entries,job.offset);job.status='uploading';}
   job.hash=md5Update(job.hash,bytes);const final=job.status==='uploading',oldTail=await stage(job,bytes,bucket,final);if(final){job.md5=md5Finish(job.hash);if(job.hash.length!==job.total)throw Error('ZIP length verification failed.');}await save();if(oldTail)await bucket.delete(oldTail).catch(()=>{});return reply({package:safe(job)});
  }
  if(job.status==='uploading'){
   // Validate private managed parents again when resuming a persisted upload.
   await managedFolder({db,owner,provider},'shared');
   if(!job.drive_id){const root=await managedFolder({db,owner,provider},'shared');job.root_id=root.id;job.drive_id=await provider.generateId();await save();}
   // A lost final upload response can be recovered by exact ID and checksum.
   let existing;try{existing=await provider.file(job.drive_id);}catch(e){if(e.providerStatus!==404)throw e;}
   if(existing){await verify(job,provider);await finish(job,{db,owner,bucket});return reply({package:safe(job)});}
   const aad=owner+':package:'+job.id;
   if(!job.session){const session=await uploader.start({id:job.drive_id,name:job.filename,mimeType:'application/zip',parents:[job.root_id],appProperties:{flowstack_package:job.id}},job.total);job.session=await seal(session,key,aad);await save();}
   const session=await unseal(job.session,key,aad),progress=await uploader.status(session,job.total);
   if(progress.complete){await verify(job,provider);await finish(job,{db,owner,bucket});return reply({package:safe(job)});}
   const start=progress.offset;if(!Number.isSafeInteger(start)||start<0||start>=job.total)throw Error('Invalid upload offset.');
   // Google may acknowledge only part of a request. Rebuild the next bounded
   // upload slice from durable chunks, independent of their original boundaries.
   const length=Math.min(CHUNK,job.total-start),parts=[];let cursor=0,remaining=length;
   for(const c of job.chunks){const end=cursor+c.size;if(end>start&&remaining>0){const object=await bucket.get(c.key);if(!object||object.size!==c.size)throw Error('Saved package chunk unavailable.');const b=new Uint8Array(await object.arrayBuffer()),local=Math.max(0,start-cursor),take=Math.min(c.size-local,remaining);parts.push(b.subarray(local,local+take));remaining-=take;}cursor=end;if(!remaining)break;}
   if(remaining)throw Error('Saved package chunk missing.');const bytes=joinBytes(...parts),result=await uploader.chunk(session,bytes,start,job.total);job.uploaded=result.complete?job.total:result.offset;if(job.uploaded<=start||job.uploaded>start+bytes.length)throw Error('Invalid Google progress response.');if(result.complete){await verify(job,provider);await finish(job,{db,owner,bucket});}else await save();return reply({package:safe(job)});
  }
 }else if(action==='restart-upload'){
  if(job.status!=='uploading')throw Error('Only an unfinished upload can be restarted.');let f;try{f=await provider.file(job.drive_id);}catch(e){if(e.providerStatus!==404)throw e;}if(f){await verify(job,provider);await finish(job,{db,owner,bucket});}else{job.session=null;job.uploaded=0;}await save();
 }else{
  if(job.status!=='ready')throw Error('Finish creating the ZIP first.');
  if(action==='revoke'){const permissions=await provider.permissions(job.drive_id);for(const p of permissions.filter(p=>p.type==='anyone'))await provider.revoke(job.drive_id,p.id);if((await provider.permissions(job.drive_id)).some(p=>p.type==='anyone'))throw Error('Could not verify removal of public access.');job.share_status='revoked';job.download_link=null;job.view_link=null;job.checked_at=now();await save();}
  else{try{const file=await verify(job,provider,action==='check');if(action==='share'){const permissions=await provider.permissions(job.drive_id);if(!permissions.some(p=>p.type==='anyone'))await provider.share(job.drive_id);await verify(job,provider,true);}job.share_status='active';job.download_link=file.webContentLink||null;job.view_link=file.webViewLink||'https://drive.google.com/file/d/'+encodeURIComponent(job.drive_id)+'/view';job.checked_at=now();await save();}catch(e){job.share_status='unverified';job.download_link=null;job.view_link=null;await save();throw e;}}
 }
 return reply({package:safe(job)});
 }catch(e){if(job&&id){job=await read(db,owner,id,'CustomerPackage');job.error=e.message;await put(db,owner,job.id,job);}return reply({error:e.message,package:job?safe(job):null},502);}
 finally{await db.prepare("DELETE FROM records WHERE id=? AND owner=? AND json_extract(data,'$.lease')=?").bind(lockId,owner,lease).run();}
}
