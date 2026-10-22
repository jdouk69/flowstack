import {googleAccess} from './google-connection.mjs';
import {googleProvider} from './google-provider.mjs';
import {computeMd5} from './content-metadata.mjs';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
export async function verifyDocument(req,{owner,db,bucket,key,provider:injected,fetcher=fetch}){
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 if(req.headers.get('origin')!==new URL(req.url).origin)return json({error:'Invalid request origin'},403);
 let input;try{const raw=await req.text();if(raw.length>2000)throw Error();input=JSON.parse(raw);if(typeof input.document_id!=='string'||!input.document_id||input.document_id.length>200||input.drive_file_id!==undefined&&(typeof input.drive_file_id!=='string'||input.drive_file_id.length>200))throw Error();}catch{return json({error:'Choose a saved document.'},400);}
 const row=await db.prepare("SELECT data,updated FROM records WHERE owner=? AND id=? AND entity='Document'").bind(owner,input.document_id).first();if(!row)return json({error:'Document not found'},404);
 const source=JSON.parse(row.data),copies=[];
 if(source.drive_file_id)copies.push({file_id:source.drive_file_id,folder_id:source.drive_folder_id,label:'Original workflow Drive file'});
 for(const copy of source.drive_exports||[])if(copy.file_id&&!copies.some(c=>c.file_id===copy.file_id))copies.push({file_id:copy.file_id,folder_id:copy.folder_id,label:copy.workflow_name||'Saved Drive copy'});
 const selected=input.drive_file_id?copies.find(c=>c.file_id===input.drive_file_id):copies[0];if(input.drive_file_id&&!selected)return json({error:'Choose a Drive copy belonging to this document.'},400);
 let local,actualMd5;
 if(source.storage_kind==='drive_reference')local={status:'reference_only',reason:'This is a Drive reference; no local original was imported.'};
 else try{
  const object=await bucket.get(source.key);
  if(!object)local={status:'missing',reason:'FlowStack original is unavailable.'};
  else if(object.size>24*1024*1024||source.size>24*1024*1024)local={status:'not_checked',reason:'Local verification is limited to 24 MB; no bytes were read.'};
  else{
   const bytes=new Uint8Array(await object.arrayBuffer());actualMd5=computeMd5(bytes);
   const matches=bytes.length===source.size&&(!source.md5||actualMd5===source.md5)&&(!source.hash||await digest(bytes)===source.hash);
   local=!matches?{status:'changed',reason:'Stored original differs from its recorded size or checksum.'}:!source.md5&&!source.hash?{status:'size_only',reason:'Size matches, but no original checksum was recorded.'}:{status:'verified',reason:'Original bytes match the recorded size and checksum.'};
  }
 }catch(e){local={status:'not_checked',reason:'Could not read the stored original: '+e.message};}
 let drive={status:'not_saved',reason:'No Drive copy is recorded. Use Copy to Drive to save one.'};
 if(selected){
  drive={file_id:selected.file_id,label:selected.label,view_link:'https://drive.google.com/file/d/'+encodeURIComponent(selected.file_id)+'/view'};
  try{
   const provider=injected||googleProvider((await googleAccess({owner,db,key,fetcher})).access_token,fetcher),file=await provider.file(selected.file_id),md5=source.md5||(local.status==='verified'?actualMd5:null);
   if(file.trashed)Object.assign(drive,{status:'missing',reason:'Drive file is in the trash.'});
   else if(Number(file.size)!==source.size||file.mimeType!==source.mime_type||md5&&file.md5Checksum!==md5)Object.assign(drive,{status:'changed',reason:'Drive copy differs from the recorded source size, type or checksum.'});
   else if(!selected.folder_id)Object.assign(drive,{status:'not_checked',reason:'Recorded destination folder is missing; its parent cannot be verified.'});
   else if(!file.parents?.includes(selected.folder_id))Object.assign(drive,{status:'wrong_folder',reason:'Drive file is outside its recorded destination folder.'});
   else if(!md5||!file.md5Checksum)Object.assign(drive,{status:'size_only',reason:'Size and destination match, but a source checksum is unavailable.'});
   else Object.assign(drive,{status:'verified',reason:'Drive size, type, checksum and destination folder match the source record.'});
  }catch(e){Object.assign(drive,{status:e.providerStatus===404?'unavailable':'not_checked',reason:e.providerStatus===404?'Drive file is unavailable to this Google connection.':e.message});}
 }
 const current=await db.prepare("SELECT data,updated FROM records WHERE owner=? AND id=? AND entity='Document'").bind(owner,input.document_id).first(),stale=!current||current.updated!==row.updated||current.data!==row.data;
 return json({document_id:input.document_id,name:source.name,checked_at:new Date().toISOString(),local,drive,copies,stale,verified:!stale&&drive.status==='verified'&&['verified','reference_only'].includes(local.status),scope:'Checks one selected Drive copy and the stored original. Does not re-read Gmail, check customer permissions or prove anonymous downloading.'});
}
