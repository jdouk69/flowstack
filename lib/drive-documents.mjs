import {managedFolder} from './drive-folders.mjs';
import {mergedFilename} from './merged-filename.mjs';
import {PDFDocument} from 'pdf-lib';
import {googleAccess} from './google-connection.mjs';
import {googleProvider,driveLink} from './google-provider.mjs';
import {resolveFolder,synchronize} from './workflow-collection.mjs';
import {computeMd5} from './content-metadata.mjs';
import {alternateDocumentName} from './document-types.mjs';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const now=()=>new Date().toISOString();
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const safe=d=>{const {key,...rest}=d;return rest;};
const get=async(db,owner,id,entity)=>{const r=await db.prepare('SELECT data FROM records WHERE owner=? AND id=? AND entity=?').bind(owner,id,entity).first();return r?{...JSON.parse(r.data),id}:null;};
const put=(db,owner,id,entity,data)=>db.prepare('INSERT INTO records(id,owner,entity,data,created,updated) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated WHERE records.owner=excluded.owner AND records.entity=excluded.entity').bind(id,owner,entity,JSON.stringify(data),now(),now());
const history=(supplier,counts)=>({supplier_id:supplier.id,supplier_name:supplier.name,run_date:now(),emails_found:0,files_saved:0,pdfs_saved:0,drive_saved:0,duplicates_skipped:0,identical_content_skipped:0,name_collision_saved:0,errors:0,...counts});
async function importFile({db,bucket,owner,supplier,folder,provider,file}){
 if(file.mimeType!=='application/pdf')throw Error('Only original PDFs can be imported with this action.');
 if(!file.md5Checksum||!Number.isFinite(Number(file.size)))throw Error('Drive returned incomplete PDF metadata. Retry the folder listing.');
 if(Number(file.size)>10*1024*1024)throw Error('This PDF exceeds the 10 MB import limit. Original remains in Drive.');
 const bytes=await provider.download(file.id);
 if(bytes.length!==Number(file.size)||computeMd5(bytes)!==file.md5Checksum)throw Error('Drive file changed or its download is incomplete. Refresh and retry; no partial original was saved.');
 if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('This Drive file is labeled PDF but has no PDF header.');
 const digest=await hash(bytes),claim=await db.prepare('SELECT document_id FROM document_content WHERE owner=? AND workflow=? AND hash=?').bind(owner,supplier.id,digest).first();
 if(claim){const d=await get(db,owner,claim.document_id,'Document');if(!d)throw Error('Saved document reference is missing.');return {document:d,duplicate:true};}
 const originalName=file.name.replace(/[\x00-\x1f/\\]/g,'_').slice(0,220)||'Drive PDF.pdf';
 const collision=await db.prepare("SELECT id FROM records WHERE owner=? AND entity='Document' AND json_extract(data,'$.workflow')=? AND json_extract(data,'$.name')=? LIMIT 1").bind(owner,supplier.id,originalName).first();
 let pages=null,status='ready';try{pages=(await PDFDocument.load(bytes)).getPageCount();}catch{status='needs_review';}
 const id=crypto.randomUUID(),key=owner+'/'+id+'.pdf';
 const document={id,key,hash:digest,md5:file.md5Checksum,workflow:supplier.id,name:collision?alternateDocumentName(originalName,digest):originalName,original_name:originalName,mime_type:'application/pdf',file_type:'pdf',size:bytes.length,pages,processing_status:status,merged:false,source_kind:'drive',source_drive_file_id:file.id,source_drive_link:'https://drive.google.com/file/d/'+encodeURIComponent(file.id)+'/view',source_drive_modified:file.modifiedTime||null,drive_file_id:file.id,drive_folder_id:folder.id,drive_file_link:'https://drive.google.com/file/d/'+encodeURIComponent(file.id)+'/view',drive_sync_status:'saved',source_email_received:file.appProperties?.source_email_received||null,source_pdf_creation:file.appProperties?.source_pdf_creation||null};
 await bucket.put(key,bytes,{httpMetadata:{contentType:'application/pdf'}});
 try{await db.batch([db.prepare('INSERT INTO document_content(owner,workflow,hash,document_id) VALUES(?,?,?,?)').bind(owner,supplier.id,digest,id),put(db,owner,id,'Document',document)]);}
 catch(e){await bucket.delete(key);const other=await db.prepare('SELECT document_id FROM document_content WHERE owner=? AND workflow=? AND hash=?').bind(owner,supplier.id,digest).first();if(other)return {document:await get(db,owner,other.document_id,'Document'),duplicate:true};throw e;}
 return {document,duplicate:false,collision:!!collision};
}
export async function driveDocuments(req,{owner,db,bucket,key,fetcher=fetch,provider:injected}){
 const url=new URL(req.url),action=url.pathname.split('/').at(-1);
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 if(req.headers.get('origin')!==url.origin)return json({error:'Invalid request origin'},403);
 let input;try{const raw=await req.text();if(raw.length>5000)throw Error();input=JSON.parse(raw);if(typeof input.supplier_id!=='string'||!['importDriveFiles','mergePdfs','exportDriveDocument','linkDrivePdf'].includes(action))throw Error();if(action==='linkDrivePdf'&&(typeof input.file_id!=='string'||!input.file_id||input.file_id.length>200))throw Error();if(action==='exportDriveDocument'&&(typeof input.document_id!=='string'||!input.document_id||input.document_id.length>200))throw Error();if(input.part_number!==undefined&&(!Number.isInteger(input.part_number)||input.part_number<1||input.part_number>2000||action!=='mergePdfs'))throw Error();if(input.expected_files!==undefined&&(!Array.isArray(input.expected_files)||!input.expected_files.length||input.expected_files.length>20||input.expected_files.some(f=>!f||typeof f.id!=='string'||typeof f.md5!=='string'||f.md5.length>128||!Number.isSafeInteger(f.size)||f.size<=0)||new Set(input.expected_files.map(f=>f.id)).size!==input.expected_files.length))throw Error();if(input.ids&&(!Array.isArray(input.ids)||!input.ids.length||input.ids.length>20||input.ids.some(id=>typeof id!=='string')||new Set(input.ids).size!==input.ids.length))throw Error();}catch{return json({error:'Choose a saved workflow and up to 20 distinct Drive PDFs.'},400);}
 const supplier=await get(db,owner,input.supplier_id,'Supplier');if(!supplier)return json({error:'Workflow not found'},404);
 const source=action==='exportDriveDocument'?await get(db,owner,input.document_id,'Document'):null;if(source?.storage_kind==='drive_reference')return json({error:'This PDF is already stored in Drive. Use its source link or customer sharing; local exporting is unavailable.'},409);if(action==='exportDriveDocument'&&!source)return json({error:'Document not found'},404);
 let provider;try{provider=injected||googleProvider((await googleAccess({owner,db,key,fetcher})).access_token,fetcher);}catch(e){return json({error:e.message},e.status||502);}
 const lockId='collection:lock:'+owner,lease=crypto.randomUUID();
 const touch=async()=>{const held=await db.prepare("UPDATE records SET data=?,updated=? WHERE id=? AND owner=? AND json_extract(data,'$.lease')=? RETURNING id").bind(JSON.stringify({lease,expires:Date.now()+180000}),now(),lockId,owner,lease).first();if(!held)throw Error('Run lease expired. Retry safely.');};
 const locked=await db.prepare("INSERT INTO records(id,owner,entity,data,created,updated) VALUES(?,?,'CollectionLock',?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated WHERE records.owner=excluded.owner AND CAST(json_extract(records.data,'$.expires') AS INTEGER)<? RETURNING id").bind(lockId,owner,JSON.stringify({lease,expires:Date.now()+180000}),now(),now(),Date.now()).first();
 if(!locked)return json({error:'A workflow operation is running. Wait for it to finish, then retry.'},409);
 let historyId=crypto.randomUUID(),stats=history(supplier,{operation:action==='linkDrivePdf'?'Link Drive PDF':action==='exportDriveDocument'?'Copy document to Drive':action==='mergePdfs'?'Drive PDF merge':'Drive PDF import',status:'running',error_details:[]}),jobId,mergeDoc;
 try{
  let folder=await resolveFolder({db,owner,supplier,provider,create:action==='exportDriveDocument'});if(!folder)return json({error:'Drive folder not found. Run this workflow first or use an existing uniquely named destination.'},404);
  if(action==='exportDriveDocument'&&source.merged){const prior=source.drive_exports?.find(e=>e.workflow_id===supplier.id),managed=await managedFolder({db,owner,provider},'merged');if(prior)folder=prior.folder_id===managed.id?managed:await provider.folder(prior.folder_id);else if(!source.drive_exports?.length)folder=managed;}
  stats.drive_folder_id=folder.id;stats.drive_folder_link=driveLink(folder.id);
  if(action==='linkDrivePdf'){
   const file=await provider.file(input.file_id);
   if(file.trashed||file.mimeType!=='application/pdf'||!file.parents?.includes(folder.id))return json({error:'Choose a PDF in this saved workflow folder.'},404);
   if(input.expected_files&&(input.expected_files.length!==1||input.expected_files[0].id!==file.id||input.expected_files[0].md5!==file.md5Checksum||input.expected_files[0].size!==Number(file.size)))return json({error:'A planned source changed. Refresh and plan again; no part was created.'},409);
   const size=Number(file.size);if(!Number.isSafeInteger(size)||size<=0||!file.md5Checksum)throw Error('Drive returned incomplete PDF metadata. No reference was saved.');
   const id='drivepdf-'+await hash(new TextEncoder().encode(JSON.stringify([owner,supplier.id,file.id,file.md5Checksum,size])));
   const existing=await get(db,owner,id,'Document');
   const document=existing||{id,workflow:supplier.id,name:file.name,original_name:file.name,mime_type:'application/pdf',file_type:'pdf',size,md5:file.md5Checksum,pages:null,merged:file.appProperties?.flowstack_merged==='true'||file.name.includes('_merged_'),processing_status:'drive_only',storage_kind:'drive_reference',source_kind:'drive',source_drive_file_id:file.id,source_drive_link:'https://drive.google.com/file/d/'+encodeURIComponent(file.id)+'/view',source_drive_modified:file.modifiedTime||null,drive_file_id:file.id,drive_folder_id:folder.id,drive_file_link:'https://drive.google.com/file/d/'+encodeURIComponent(file.id)+'/view',drive_sync_status:'saved'};
   stats.status='completed';stats.references_linked=existing?0:1;stats.duplicates_skipped=existing?1:0;
   await db.batch([put(db,owner,id,'Document',document),put(db,owner,historyId,'RunHistory',stats)]);
   return json({document:safe(document),already_linked:!!existing,...stats});
  }
  const files=await provider.files(folder.id);
  if(action==='exportDriveDocument'){
   await touch();const obj=await bucket.get(source.key);if(!obj)throw Error('Stored original is unavailable.');
   const bytes=new Uint8Array(await obj.arrayBuffer()),digest=await hash(bytes);if(bytes.length!==source.size||source.hash&&digest!==source.hash)throw Error('Stored original verification failed. No Drive copy created.');
   const exportId='drive:export:'+owner+':'+await hash(new TextEncoder().encode(JSON.stringify([source.id,folder.id,digest])));
   const previous=await get(db,owner,exportId,'DriveExport');
   const copy={...source,workflow:supplier.id,hash:digest,original_name:source.original_name||source.name,drive_file_id:previous?.drive_file_id||null,drive_sync_status:'pending'};
   historyId=previous?.history_id||historyId;
   const persist=()=>put(db,owner,exportId,'DriveExport',{document_id:source.id,history_id:historyId,drive_file_id:copy.drive_file_id,drive_folder_id:folder.id,drive_sync_status:copy.drive_sync_status}).run();
   await persist();await put(db,owner,historyId,'RunHistory',stats).run();
   const synced=await synchronize({db,owner,document:copy,bytes,folder,provider,files,persist});
   const latest=await get(db,owner,source.id,'Document');if(!latest)throw Error('Original was removed during copying. The Drive copy is preserved.');
   const reference={folder_id:folder.id,workflow_id:supplier.id,workflow_name:supplier.name,file_id:copy.drive_file_id,file_link:copy.drive_file_link};
   latest.drive_exports=[...(latest.drive_exports||[]).filter(e=>e.folder_id!==folder.id),reference];
   await put(db,owner,source.id,'Document',latest).run();
   stats.drive_saved=Number(synced.created);stats.duplicates_skipped=Number(!synced.created);stats.status='completed';
   await put(db,owner,historyId,'RunHistory',stats).run();
   return json({document:safe(latest),drive_file_link:copy.drive_file_link,drive_folder_link:driveLink(folder.id),already_saved:!synced.created,...stats});
  }

  let selected=input.ids?input.ids.map(id=>files.find(f=>f.id===id)):files.filter(f=>f.mimeType==='application/pdf'&&!f.name.includes('_merged_')&&f.appProperties?.flowstack_merged!=='true');
  if(selected.some(f=>!f))return json({error:'A selected PDF is no longer in this workflow’s folder. Refresh and try again.'},404);
  if(input.expected_files&&(input.expected_files.length!==selected.length||selected.some((f,i)=>input.expected_files[i].id!==f.id||input.expected_files[i].md5!==f.md5Checksum||input.expected_files[i].size!==Number(f.size))))return json({error:'A planned source changed or was reordered. Refresh and plan again; no part was created.'},409);
  if(selected.length>20||!selected.length||action==='mergePdfs'&&selected.length<2)return json({error:action==='mergePdfs'?'Choose 2–20 original PDFs. Large folders require selecting a smaller batch.':'Choose 1–20 original PDFs.'},400);
  if(selected.some(f=>f.mimeType!=='application/pdf'||f.appProperties?.flowstack_merged==='true'))return json({error:'Select original PDFs; previous FlowStack merges are excluded.'},400);
  if(selected.some(f=>Number(f.size)>10*1024*1024))return json({error:'A selected PDF exceeds the current 10 MB import limit. Originals remain in Drive.'},413);
  if(action==='mergePdfs'&&selected.reduce((n,f)=>n+Number(f.size||0),0)>20*1024*1024)return json({error:'Selected PDFs exceed the 20 MB merge limit. Select a smaller batch.'},413);
  if(!input.ids)selected=selected.sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
  if(action==='mergePdfs'){
   jobId='drive:merge:'+owner+':'+await hash(new TextEncoder().encode(JSON.stringify([supplier.id,folder.id,selected.map(f=>[f.id,f.md5Checksum,f.size])])));
   const job=await get(db,owner,jobId,'DriveMergeJob');
   if(job){mergeDoc=await get(db,owner,job.document_id,'Document');if(!mergeDoc)throw Error('Saved merge output is unavailable.');historyId=job.history_id;stats=job.history;}
  }
  const originals=[];
  if(!mergeDoc){
   await put(db,owner,historyId,'RunHistory',stats).run();
   for(const file of selected){await touch();try{const result=await importFile({db,bucket,owner,supplier,folder,provider,file});originals.push(result.document);if(result.duplicate){stats.duplicates_skipped++;stats.identical_content_skipped++;}else{stats.files_saved++;stats.pdfs_saved++;if(result.collision)stats.name_collision_saved++;}}catch(e){stats.errors++;stats.error_details.push({filename:file.name,reason:e.message});}await put(db,owner,historyId,'RunHistory',stats).run();}
   if(action==='importDriveFiles'){stats.status=stats.errors?(stats.files_saved?'partial':'failed'):'completed';await put(db,owner,historyId,'RunHistory',stats).run();return json({documents:originals.map(safe),...stats});}
   if(stats.errors)throw Error('Some source PDFs could not be preserved. No merged output was created. Review the errors and retry.');
   if(new Set(originals.map(d=>d.id)).size!==originals.length)throw Error('The selected files contain identical PDF content. Select one copy of each original before merging.');
   const merged=await PDFDocument.create();
   for(const d of originals){await touch();const obj=await bucket.get(d.key);if(!obj)throw Error('A preserved original is unavailable.');let pdf,pageCount;try{pdf=await PDFDocument.load(await obj.arrayBuffer());pageCount=pdf.getPageCount();}catch{throw Error('Cannot merge '+d.name+': encrypted or unreadable. Every imported original remains stored.');}if(merged.getPageCount()+pageCount>1000)throw Error('The selection exceeds the 1,000-page merge limit. Originals are preserved.');try{for(const page of await merged.copyPages(pdf,pdf.getPageIndices()))merged.addPage(page);}catch{throw Error('Cannot merge '+d.name+': encrypted or unreadable. Originals are preserved.');}}
   const bytes=await merged.save();if(bytes.length>20*1024*1024)throw Error('Merged PDF exceeds the 20 MB output limit. Select fewer originals.');
   const id=crypto.randomUUID(),digest=await hash(bytes),name=mergedFilename(supplier.name,{part:input.part_number});
   mergeDoc={id,key:owner+'/'+id+'.pdf',name,original_name:name,workflow:supplier.id,mime_type:'application/pdf',file_type:'pdf',size:bytes.length,pages:merged.getPageCount(),processing_status:'ready',merged:true,hash:digest,md5:computeMd5(bytes),source_ids:originals.map(d=>d.id),source_drive_ids:selected.map(f=>f.id),source_kind:'drive_merge',drive_sync_status:'pending'};
   stats.files_saved++;stats.pdfs_saved++;await bucket.put(mergeDoc.key,bytes,{httpMetadata:{contentType:'application/pdf'}});
   try{await db.batch([put(db,owner,id,'Document',mergeDoc),put(db,owner,jobId,'DriveMergeJob',{document_id:id,history_id:historyId,history:stats})]);}catch(e){await bucket.delete(mergeDoc.key);throw e;}
  }
  await touch();const obj=await bucket.get(mergeDoc.key);if(!obj)throw Error('Merged original is unavailable.');
  const managed=await managedFolder({db,owner,provider},'merged');const outputFolder=mergeDoc.drive_folder_id&&mergeDoc.drive_folder_id!==managed.id?await provider.folder(mergeDoc.drive_folder_id):managed;
  const outputFiles=outputFolder.id===folder.id?files:await provider.files(outputFolder.id);stats.drive_folder_id=outputFolder.id;stats.drive_folder_link=driveLink(outputFolder.id);
  const synced=await synchronize({db,owner,document:mergeDoc,bytes:new Uint8Array(await obj.arrayBuffer()),folder:outputFolder,provider,files:outputFiles});stats.drive_saved=Math.max(stats.drive_saved,Number(synced.created));stats.status='completed';stats.processing_error=null;
  await db.batch([put(db,owner,jobId,'DriveMergeJob',{document_id:mergeDoc.id,history_id:historyId,history:stats}),put(db,owner,historyId,'RunHistory',stats)]);
  return json({document:safe(mergeDoc),pdf_count:mergeDoc.source_ids.length,merged_filename:mergeDoc.name,drive_folder_link:driveLink(outputFolder.id),drive_file_link:mergeDoc.drive_file_link,already_merged:!synced.created,...stats});
 }catch(e){stats.status=stats.files_saved?'partial':'failed';if(!stats.errors)stats.errors=1;stats.processing_error=e.message;if(mergeDoc){mergeDoc.drive_sync_status='failed';await put(db,owner,mergeDoc.id,'Document',mergeDoc).run();}await put(db,owner,historyId,'RunHistory',stats).run();return json({error:e.message,error_details:stats.error_details,document:mergeDoc?safe(mergeDoc):null},e.providerStatus===403?403:422);}
 finally{await db.prepare("DELETE FROM records WHERE id=? AND owner=? AND json_extract(data,'$.lease')=?").bind(lockId,owner,lease).run();}
}
