import {managedFolder} from './drive-folders.mjs';
import {googleAccess} from './google-connection.mjs';
import {googleProvider} from './google-provider.mjs';
import {computeMd5} from './content-metadata.mjs';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const now=()=>new Date().toISOString();
const get=async(db,owner,id,entity)=>{const r=await db.prepare('SELECT data FROM records WHERE owner=? AND id=? AND entity=?').bind(owner,id,entity).first();return r?JSON.parse(r.data):null;};
const put=(db,owner,id,entity,data)=>db.prepare('INSERT INTO records(id,owner,entity,data,created,updated) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated WHERE records.owner=excluded.owner AND records.entity=excluded.entity').bind(id,owner,entity,JSON.stringify(data),now(),now());
export const publicShare=s=>s?{status:s.status,view_link:s.status==='active'?s.view_link:null,download_link:s.status==='active'?s.download_link:null,filename:s.filename,shared_at:s.shared_at,revoked_at:s.revoked_at,automatic_expiry:false,checked_at:s.checked_at||null,verification_reason:s.verification_reason||null}:null;
export function downloadBlocked(file){return file.copyRequiresWriterPermission===true||file.capabilities?.canDownload===false||file.downloadRestrictions?.itemDownloadRestriction?.restrictedForReaders===true||file.downloadRestrictions?.effectiveDownloadRestrictionWithContext?.restrictedForReaders===true;}
// A dedicated Drive copy avoids granting public access to collection originals or folders.
export async function driveSharing(req,{owner,db,bucket,key,provider:injected,fetcher=fetch}){
 const url=new URL(req.url);if(req.method!=='POST')return json({error:'Method not allowed'},405);
 if(req.headers.get('origin')!==url.origin)return json({error:'Invalid request origin'},403);
 let input;try{const raw=await req.text();if(raw.length>2000)throw Error();input=JSON.parse(raw);if(typeof input.document_id!=='string'||!input.document_id||input.document_id.length>200||!['status','create','revoke','check'].includes(input.action))throw Error();}catch{return json({error:'Choose a PDF and sharing action.'},400);}
 const source=await get(db,owner,input.document_id,'Document');if(!source)return json({error:'Document not found'},404);
 const shareId='drive:share:'+owner+':'+input.document_id;
 let share=await get(db,owner,shareId,'DriveShare');
 if(input.action==='status')return json({share:publicShare(share)});
 if(input.action==='create'&&input.confirmed!==true)return json({error:'Confirm that anyone with the link may download this PDF.'},400);
 if(source.mime_type!=='application/pdf')return json({error:'Customer links currently support PDFs only.'},400);
 if(['revoke','check'].includes(input.action)&&!share)return json({share:null});
 let provider;try{provider=injected||googleProvider((await googleAccess({owner,db,key,fetcher})).access_token,fetcher);}catch(e){return json({error:e.message},e.status||502);}
 const lockId='collection:lock:'+owner,lease=crypto.randomUUID();
 const locked=await db.prepare("INSERT INTO records(id,owner,entity,data,created,updated) VALUES(?,?,'CollectionLock',?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated WHERE records.owner=excluded.owner AND CAST(json_extract(records.data,'$.expires') AS INTEGER)<? RETURNING id").bind(lockId,owner,JSON.stringify({lease,expires:Date.now()+180000}),now(),now(),Date.now()).first();
 if(!locked)return json({error:'A Drive operation is running. Wait, then retry.'},409);
 const save=()=>put(db,owner,shareId,'DriveShare',share).run();
 try{
  // Re-read after acquiring the owner lease: concurrent retries must use the same copy.
  share=await get(db,owner,shareId,'DriveShare');
  if(input.action==='check'){
   if(!share)return json({share:null});
   let file;try{file=await provider.file(share.file_id);}catch(e){if(e.providerStatus!==404)throw e;}
   let permissions=[];if(file&&!file.trashed)permissions=await provider.permissions(share.file_id);
   const publicPermission=permissions.find(p=>p.type==='anyone');
   share.checked_at=now();
   if(!file||file.trashed){share.status='unavailable';share.verification_reason='Customer copy is deleted or unavailable in Drive.';}
   else if(file.md5Checksum!==share.md5){share.status='blocked';share.verification_reason='Customer copy changed since it was verified. Review it in Drive.';}
   else if(!publicPermission){share.status='revoked';share.revoked_at=now();share.verification_reason='Anyone-with-link access is no longer enabled.';}
   else if(publicPermission.role!=='reader'||publicPermission.allowFileDiscovery===true){share.status='blocked';share.verification_reason='Customer copy has broader public permissions than the confirmed Viewer link.';}
   else if(downloadBlocked(file)){share.status='blocked';share.verification_reason='Google Drive restricts customer downloads for this copy.';}
   else{share.status='active';share.verification_reason=null;share.view_link=file.webViewLink||'https://drive.google.com/file/d/'+encodeURIComponent(share.file_id)+'/view';share.download_link=file.webContentLink||null;share.revoked_at=null;}
   await save();
  }else if(input.action==='revoke'){
   if(!share)return json({share:null});
   let permissions;try{permissions=await provider.permissions(share.file_id);}catch(e){if(e.providerStatus!==404)throw e;permissions=[];}
   const publicPermissions=permissions.filter(p=>p.type==='anyone');
   for(const p of publicPermissions){try{await provider.revoke(share.file_id,p.id);}catch(e){if(e.providerStatus!==404)throw e;}}
   let remaining;try{remaining=await provider.permissions(share.file_id);}catch(e){if(e.providerStatus!==404)throw e;remaining=[];}
   if(remaining.some(p=>p.type==='anyone'))throw Error('Public access could not be removed. Check the dedicated copy in Google Drive.');
   share.status='revoked';share.revoked_at=now();await save();
  }else{
   let bytes,md5,size=source.size,root;
   if(source.storage_kind==='drive_reference'){
    const original=await provider.file(source.source_drive_file_id);
    if(original.trashed||original.mimeType!=='application/pdf'||original.md5Checksum!==source.md5||Number(original.size)!==size)throw Error('The Drive original changed or is unavailable. Save a fresh reference before sharing.');
    md5=source.md5;
   }else{
    const object=await bucket.get(source.key);if(!object)throw Error('Stored PDF is unavailable.');
    if(size>20*1024*1024)throw Error('Local customer-copy limit is currently 20 MB. Use a Drive reference for an existing large PDF.');
    bytes=new Uint8Array(await object.arrayBuffer());md5=computeMd5(bytes);
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    if(bytes.length!==size||source.md5&&source.md5!==md5||source.hash&&source.hash!==digest)throw Error('Stored PDF verification failed.');
   }
   if(!share){root=await managedFolder({db,owner,provider},'shared');share={file_id:await provider.generateId(),filename:source.name,folder_id:root.id,status:'pending',source_document_id:input.document_id,md5};await save();}
   if(share.md5!==md5)throw Error('Stored PDF differs from its existing share copy. Review the source before sharing.');
   let file;try{file=await provider.file(share.file_id);}catch(e){if(e.providerStatus!==404)throw e;}
   if(!file){root=await managedFolder({db,owner,provider},'shared');share.folder_id=root.id;await save();
    const metadata={id:share.file_id,name:source.name,mimeType:'application/pdf',appProperties:{flowstack_customer_copy:'true',flowstack_source_document:input.document_id},description:'Dedicated customer copy created by FlowStack. Collection originals remain private.',...(root?{parents:[root.id]}:{})};
    try{file=source.storage_kind==='drive_reference'?await provider.copy(source.source_drive_file_id,metadata):await provider.upload(metadata,bytes,'application/pdf');}catch(e){if(e.providerStatus!==409)throw e;file=await provider.file(share.file_id);}
   }
   if(!file||file.trashed||file.md5Checksum!==md5||share.folder_id&&!file.parents?.includes(share.folder_id)||source.storage_kind==='drive_reference'&&Number(file.size)!==size)throw Error('Customer copy could not be verified. Retry safely.');
   file=await provider.file(share.file_id);
   if(file.capabilities?.canShare===false||downloadBlocked(file))throw Error('Google Drive does not allow sharing or downloading this copy.');
   let permissions=await provider.permissions(share.file_id);
   const broad=permissions.find(p=>p.type==='anyone');
   if(broad&&(broad.role!=='reader'||broad.allowFileDiscovery===true))throw Error('The dedicated copy has broader public access. Review its Google Drive permissions before continuing.');
   if(!broad){await provider.share(share.file_id);permissions=await provider.permissions(share.file_id);}
   const verified=permissions.find(p=>p.type==='anyone'&&p.role==='reader'&&p.allowFileDiscovery!==true);
   if(!verified)throw Error('Google Drive did not confirm public read-only access. Retry or check Drive.');
   file=await provider.file(share.file_id);
   if(file.trashed||file.md5Checksum!==md5||downloadBlocked(file))throw Error('Customer copy changed or downloading is restricted. Check Drive before sending the link.');
   share.checked_at=now();share.verification_reason=null;share.status='active';share.permission_id=verified.id;share.shared_at=now();share.revoked_at=null;share.view_link=file.webViewLink||'https://drive.google.com/file/d/'+encodeURIComponent(share.file_id)+'/view';share.download_link=file.webContentLink||null;await save();
  }
  const eventId=crypto.randomUUID();await put(db,owner,eventId,'ShareEvent',{source_document_id:input.document_id,action:input.action,status:share.status,time:now()}).run();
  return json({share:publicShare(share)});
 }catch(e){return json({error:e.message,share:publicShare(share)},e.providerStatus===403?403:422);}
 finally{await db.prepare("DELETE FROM records WHERE id=? AND owner=? AND json_extract(data,'$.lease')=?").bind(lockId,owner,lease).run();}
}
