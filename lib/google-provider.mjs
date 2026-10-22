import {documentType} from './document-types.mjs';
export const driveLink=id=>'https://drive.google.com/drive/folders/'+encodeURIComponent(id);
export function googleProvider(token,fetcher=fetch){
 const request=async(path,options={},upload=false)=>{
  const response=await fetcher((upload?'https://www.googleapis.com/upload/drive/v3/':'https://www.googleapis.com/drive/v3/')+path,{...options,headers:{...options.headers,Authorization:'Bearer '+token},signal:AbortSignal.timeout(upload?60000:15000)});
  if(!response.ok)throw Object.assign(Error(response.status===403?'Drive denied access to this folder. Select a folder available to this Google connection.':response.status===401?'Google authorization expired. Reconnect in Settings.':response.status===429?'Google rate limit reached. Retry this workflow later.':'Drive request failed ('+response.status+'). Retry the workflow.'),{providerStatus:response.status});
  return response.status===204?{}:response.json();
 };
 const gmail=async path=>{const r=await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/'+path,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Gmail request failed ('+r.status+'). Retry the workflow or check Google in Settings.');return r.json();};
 const list=async q=>{
  const files=[],seen=new Set(),deadline=Date.now()+45000;let pageToken;
  do{if(Date.now()>deadline)throw Error('Drive listing timed out. No partial folder listing was used; retry later.');const p=new URLSearchParams({q,pageSize:'1000',fields:'nextPageToken,incompleteSearch,files(id,name,mimeType,size,md5Checksum,parents,trashed,webViewLink,createdTime,modifiedTime,appProperties)',supportsAllDrives:'true',includeItemsFromAllDrives:'true'});if(pageToken)p.set('pageToken',pageToken);const r=await request('files?'+p);if(r.incompleteSearch)throw Error('Drive returned an incomplete folder search. No files were saved.');if(r.files!==undefined&&!Array.isArray(r.files))throw Error('Invalid Drive file listing.');files.push(...(r.files||[]));pageToken=r.nextPageToken;if(pageToken&&seen.has(pageToken))throw Error('Drive pagination could not be completed.');seen.add(pageToken);}while(pageToken);
  return files;
 };
 return {
  managedFolders:role=>list("trashed = false and mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='flowstack_folder' and value='"+role+"' }"),
  mergedFiles:workflow=>list("trashed = false and appProperties has { key='flowstack_merged' and value='true' } and appProperties has { key='flowstack_workflow' and value='"+workflow.replaceAll("'","\\'")+"' }"),
  markWorkflow:(id,appProperties)=>request('files/'+encodeURIComponent(id)+'?fields=id,appProperties&supportsAllDrives=true',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({appProperties})}),
  move:(id,parent,previous)=>request('files/'+encodeURIComponent(id)+'?'+new URLSearchParams({addParents:parent,removeParents:previous.join(','),fields:'id,parents',supportsAllDrives:'true'}),{method:'PATCH',headers:{'Content-Type':'application/json'},body:'{}'}),
  auditFiles:marker=>list("trashed = false and appProperties has { key='flowstack_audit' and value='"+marker.replaceAll("'","\\'")+"' }"),
  createAudit:metadata=>request('files?fields=id,name,mimeType,parents,trashed,webViewLink,appProperties&ignoreDefaultVisibility=true',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(metadata)}),
  folder:id=>request('files/'+encodeURIComponent(id)+'?fields=id,name,mimeType,trashed&supportsAllDrives=true'),
  folders:name=>list("trashed = false and mimeType = 'application/vnd.google-apps.folder' and name = '"+name.replaceAll('\\','\\\\').replaceAll("'","\\'")+"'"),
  files:id=>list("trashed = false and '"+id.replaceAll("'","\\'")+"' in parents"),
  generateId:async()=>{const r=await request('files/generateIds?count=1&space=drive&type=files');if(!r.ids?.[0])throw Error('Drive returned no file identifier.');return r.ids[0];},
  createFolder:metadata=>request('files?fields=id,name,mimeType,parents,appProperties,trashed&supportsAllDrives=true&ignoreDefaultVisibility=true',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(metadata)}),
  file:id=>request('files/'+encodeURIComponent(id)+'?fields=id,name,mimeType,size,parents,md5Checksum,trashed,webViewLink,webContentLink,capabilities(canShare,canDownload),copyRequiresWriterPermission,downloadRestrictions,appProperties,createdTime,modifiedTime&supportsAllDrives=true'),
  root:()=>request('files/root?fields=id,mimeType,trashed&supportsAllDrives=true'),
  copy:(sourceId,metadata)=>request('files/'+encodeURIComponent(sourceId)+'/copy?fields=id,name,size,mimeType,md5Checksum,parents,trashed,webViewLink&supportsAllDrives=true&ignoreDefaultVisibility=true',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(metadata)}),
  permissions:async id=>{
   const permissions=[],seen=new Set();let pageToken;
   do{const p=new URLSearchParams({fields:'nextPageToken,permissions(id,type,role,allowFileDiscovery,permissionDetails)',pageSize:'100',supportsAllDrives:'true'});if(pageToken)p.set('pageToken',pageToken);const r=await request('files/'+encodeURIComponent(id)+'/permissions?'+p);permissions.push(...(r.permissions||[]));pageToken=r.nextPageToken;if(pageToken&&seen.has(pageToken))throw Error('Permission listing could not be completed.');seen.add(pageToken);}while(pageToken);
   return permissions;
  },
  share:id=>request('files/'+encodeURIComponent(id)+'/permissions?fields=id,type,role,allowFileDiscovery&supportsAllDrives=true',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'anyone',role:'reader',allowFileDiscovery:false})}),
  revoke:(id,permissionId)=>request('files/'+encodeURIComponent(id)+'/permissions/'+encodeURIComponent(permissionId)+'?supportsAllDrives=true',{method:'DELETE'}),
  download:async id=>{
   const r=await fetcher('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id)+'?alt=media&supportsAllDrives=true',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
   if(!r.ok)throw Error('Drive download failed ('+r.status+'). The original remains in Drive.');
   if(Number(r.headers.get('content-length'))>10*1024*1024)throw Error('Drive file exceeds the 10 MB import limit.');
   const reader=r.body.getReader(),chunks=[];let size=0;try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>10*1024*1024)throw Error('Drive file exceeds the 10 MB import limit.');chunks.push(value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
  },
  upload:async(metadata,bytes,mime,{ignoreDefaultVisibility=false}={})=>{
   const boundary='flowstack_'+crypto.randomUUID();
   const body=new Blob(['--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n',JSON.stringify(metadata),'\r\n--'+boundary+'\r\nContent-Type: '+mime+'\r\n\r\n',bytes,'\r\n--'+boundary+'--\r\n']);
   const params=new URLSearchParams({uploadType:'multipart',fields:'id,name,mimeType,size,md5Checksum,parents,trashed,webViewLink,appProperties',supportsAllDrives:'true'});if(ignoreDefaultVisibility)params.set('ignoreDefaultVisibility','true');
   return request('files?'+params,{method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body},true);
  },
  search:async(query,pageToken)=>{const p=new URLSearchParams({q:query,maxResults:'100'});if(pageToken)p.set('pageToken',pageToken);const r=await gmail('messages?'+p);if(r.messages!==undefined&&!Array.isArray(r.messages))throw Error('Invalid Gmail message listing.');return {...r,messages:r.messages||[]};},
  read:id=>gmail('messages/'+encodeURIComponent(id)+'?format=full'),
  bytes:async(messageId,part)=>{
   if(part.size>10*1024*1024)throw Error('Attachment exceeds the current 10 MB limit. Original remains in Gmail.');
   const data=part.data??(await gmail('messages/'+encodeURIComponent(messageId)+'/attachments/'+encodeURIComponent(part.attachment_id))).data;
   if(typeof data!=='string'||data.length>14*1024*1024)throw Error('Invalid or oversized Gmail attachment.');
   let bytes;try{bytes=Uint8Array.from(atob(data.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));}catch{throw Error('Could not decode the Gmail attachment.');}
   if(!bytes.length||bytes.length>10*1024*1024)throw Error('Empty or oversized attachment. Original remains in Gmail.');return bytes;
  },
 };
}
export function attachments(payload,allowed){
 const items=[];let index=0;
 function walk(p){if(!p)return;const position=index++;const type=documentType(p.filename);if(type&&allowed.has(type.extension)){
  if(!p.body?.attachmentId&&typeof p.body?.data!=='string')throw Error('Gmail attachment has no downloadable content.');
  items.push({name:p.filename.replace(/[\x00-\x1f/\\]/g,'_').slice(0,220),attachment_id:p.body.attachmentId||null,data:p.body.data,size:p.body.size||0,part_id:String(p.partId??position),...type});
 }for(const child of p.parts||[])walk(child);}
 walk(payload);return items;
}
