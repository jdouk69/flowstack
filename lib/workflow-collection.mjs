import {managedFolder} from './drive-folders.mjs';
import {googleAccess} from './google-connection.mjs';
import {googleProvider,attachments,driveLink} from './google-provider.mjs';
import {previewCriteria} from './collection-preview.mjs';
import {computeMd5,buildSourceDateMetadata} from './content-metadata.mjs';
import {alternateDocumentName} from './document-types.mjs';
import {collectionWindow,successfulCheckpoint} from './collection-checkpoint.mjs';
const folderMime='application/vnd.google-apps.folder';
const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const now=()=>new Date().toISOString();
const read=async(db,owner,id,entity)=>{const r=await db.prepare('SELECT * FROM records WHERE owner=? AND id=? AND entity=?').bind(owner,id,entity).first();return r?{...JSON.parse(r.data),id:r.id,created_date:r.created}:null;};
const statement=(db,owner,id,entity,data)=>db.prepare('INSERT INTO records(id,owner,entity,data,created,updated) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated WHERE records.owner=excluded.owner AND records.entity=excluded.entity').bind(id,owner,entity,JSON.stringify(data),now(),now());
async function supplierPatch(db,owner,id,changes){const s=await read(db,owner,id,'Supplier');if(!s)throw Error('Workflow was removed.');const {id:_,created_date:__,...data}=s;await statement(db,owner,id,'Supplier',{...data,...changes}).run();}
// A validated saved ID always wins. Ambiguity and inaccessible saved folders stop the run.
export async function resolveFolder({db,owner,supplier,provider,create}){
 const validate=f=>{if(!f||typeof f.id!=='string'||!f.id||f.trashed||f.mimeType!==folderMime)throw Error('The saved Drive destination is not an accessible folder. No replacement folder was created.');return f;};
 if(supplier.drive_folder_id)return validate(await provider.folder(supplier.drive_folder_id));
 if(supplier.drive_folder_pending_id){
  let f;try{f=validate(await provider.folder(supplier.drive_folder_pending_id));}catch(e){if(e.providerStatus!==404)throw e;}
  if(!f&&create){const parent=await managedFolder({db,owner,provider},'suppliers');f=await provider.createFolder({id:supplier.drive_folder_pending_id,name:supplier.drive_folder_name,mimeType:folderMime,parents:[parent.id],appProperties:{flowstack_workflow_folder:supplier.id}});}
  if(!f)throw Error('Drive destination creation is pending. Run the workflow to finish setup.');
  await supplierPatch(db,owner,supplier.id,{drive_folder_id:f.id,drive_folder_pending_id:null});return validate(f);
 }
 const history=(await db.prepare("SELECT data FROM records WHERE owner=? AND entity='RunHistory' AND json_extract(data,'$.supplier_id')=?").bind(owner,supplier.id).all()).results;
 const prior=[...new Set(history.map(r=>{const d=JSON.parse(r.data);return d.drive_folder_id||d.drive_folder_link?.match(/\/folders\/([\w-]+)/)?.[1];}).filter(Boolean))];
 if(prior.length>1)throw Error('This workflow has more than one historical Drive destination. Choose the intended folder before running.');
 let folder;
 if(prior.length===1)folder=validate(await provider.folder(prior[0]));
 else {if(!supplier.drive_folder_name?.trim())throw Error('Edit this workflow and enter its Drive folder name.');const matches=await provider.folders(supplier.drive_folder_name);if(matches.length>1)throw Error('More than one Drive folder is named '+supplier.drive_folder_name+'. Rename the intended folder to a unique name and update the workflow. No folder was chosen automatically.');folder=matches[0];}
 if(!folder){if(!create)return null;const id=await provider.generateId();await supplierPatch(db,owner,supplier.id,{drive_folder_pending_id:id});const parent=await managedFolder({db,owner,provider},'suppliers');folder=await provider.createFolder({id,name:supplier.drive_folder_name,mimeType:folderMime,parents:[parent.id],appProperties:{flowstack_workflow_folder:supplier.id}});}
 validate(folder);await supplierPatch(db,owner,supplier.id,{drive_folder_id:folder.id,drive_folder_pending_id:null});return folder;
}
async function summary(db,owner,job){
 const totals=await db.prepare("SELECT COALESCE(SUM(json_extract(data,'$.files_saved')),0) AS files_saved,COALESCE(SUM(json_extract(data,'$.pdfs_saved')),0) AS pdfs_saved,COALESCE(SUM(json_extract(data,'$.drive_saved')),0) AS drive_saved,COALESCE(SUM(json_extract(data,'$.duplicates_skipped')),0) AS duplicates_skipped,COALESCE(SUM(json_extract(data,'$.name_collision_saved')),0) AS name_collision_saved,COALESCE(SUM(json_extract(data,'$.errors')),0) AS errors FROM records WHERE owner=? AND entity='CollectionOutcome' AND json_extract(data,'$.job_id')=?").bind(owner,job.id).first();
 const errors=(await db.prepare("SELECT data FROM records WHERE owner=? AND entity='CollectionOutcome' AND json_extract(data,'$.job_id')=? AND json_extract(data,'$.errors')>0 ORDER BY created LIMIT 100").bind(owner,job.id).all()).results.map(r=>JSON.parse(r.data).error_detail);
 return {...totals,emails_found:job.emails_found,identical_content_skipped:totals.duplicates_skipped,error_details:errors};
}
async function activity(db,owner,job,blocked=null){
 const counts=await summary(db,owner,job);
 const status=blocked?(counts.files_saved||counts.drive_saved?'partial':'failed'):job.done?(counts.errors?(counts.files_saved||counts.drive_saved?'partial':'failed'):'completed'):'running';
 const result={supplier_id:job.workflow,supplier_name:job.supplier_name,run_date:job.started,operation:'Gmail collection',collection_mode:job.mode||'full',retry_of:job.retry_of||null,collection_query:job.collection_query||null,checkpoint_through:job.checkpoint_through||null,drive_folder_id:job.folder?.id,drive_folder_link:job.folder?driveLink(job.folder.id):null,...counts,status,processing_error:blocked};
 await statement(db,owner,job.id,'RunHistory',result).run();return result;
}
async function preserve({db,bucket,owner,workflow,part,messageId,received,bytes,driveFiles,jobId}){
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 const claim=await db.prepare('SELECT document_id FROM document_content WHERE owner=? AND workflow=? AND hash=?').bind(owner,workflow,hash).first();
 if(claim){const document=await read(db,owner,claim.document_id,'Document');if(!document)throw Error('A saved document reference is missing. Report this storage error.');if(!document.source_email_id){document.source_kind='gmail';document.also_uploaded=true;document.source_email_id=messageId;document.source_attachment_id=part.attachment_id;document.source_part_id=part.part_id;document.source_email_received=received;document.source_email_link='https://mail.google.com/mail/u/0/#all/'+encodeURIComponent(messageId);await statement(db,owner,document.id,'Document',document).run();}return {document,newLocal:document.collection_run_id===jobId&&document.source_email_id===messageId&&document.source_part_id===part.part_id,collision:document.collection_collision||false};}
 const sameName=await db.prepare("SELECT id FROM records WHERE owner=? AND entity='Document' AND json_extract(data,'$.workflow')=? AND json_extract(data,'$.name')=? LIMIT 1").bind(owner,workflow,part.name).first();
 let name=sameName?alternateDocumentName(part.name,hash):part.name;
 const collision=!!sameName||driveFiles.some(f=>f.name===name&&f.md5Checksum!==computeMd5(bytes));
 if(collision&&!sameName)name=alternateDocumentName(part.name,hash);
 const id=crypto.randomUUID(),key=owner+'/'+id;
 const metadata=buildSourceDateMetadata({isPdf:part.file_type==='pdf',fileBytes:bytes,internalDateMs:received?String(Date.parse(received)):null});
 const document={name,original_name:part.name,workflow,hash,key,md5:computeMd5(bytes),mime_type:part.mime_type,file_type:part.file_type,size:bytes.length,processing_status:'awaiting_analysis',merged:false,source_kind:'gmail',collection_run_id:jobId,collection_collision:collision,source_email_id:messageId,source_attachment_id:part.attachment_id,source_part_id:part.part_id,source_email_received:received,source_pdf_creation:metadata.appProperties.source_pdf_creation||null,source_date_metadata:metadata,source_email_link:'https://mail.google.com/mail/u/0/#all/'+encodeURIComponent(messageId),drive_sync_status:'pending'};
 await bucket.put(key,bytes,{httpMetadata:{contentType:part.mime_type}});
 try{await db.batch([db.prepare('INSERT INTO document_content(owner,workflow,hash,document_id) VALUES(?,?,?,?)').bind(owner,workflow,hash,id),statement(db,owner,id,'Document',document)]);}
 catch(e){await bucket.delete(key);const other=await db.prepare('SELECT document_id FROM document_content WHERE owner=? AND workflow=? AND hash=?').bind(owner,workflow,hash).first();if(other)return {document:await read(db,owner,other.document_id,'Document'),newLocal:false,collision:false};throw e;}
 return {document:{...document,id},newLocal:true,collision};
}
export async function synchronize({db,owner,document,bytes,folder,provider,files,persist}){
 const save=persist||(()=>statement(db,owner,document.id,'Document',document).run());
 const md5=document.md5||computeMd5(bytes);
 let file=files.find(f=>f.md5Checksum===md5);
 let created=false;
 if(!file){
  if(!document.drive_file_id){document.drive_file_id=await provider.generateId();document.drive_sync_status='pending';await save();}
  // Reusing a pre-generated ID makes retry safe after an upload response is lost.
  try{file=await provider.file(document.drive_file_id);}catch(e){if(e.providerStatus!==404)throw e;}
  if(!file){
   let name=document.name;if(files.some(f=>f.name===name)){name=alternateDocumentName(document.original_name,document.hash);let n=2;while(files.some(f=>f.name===name))name=alternateDocumentName(document.original_name,document.hash).replace('].',`-${n++}].`);}
   const dates=document.source_date_metadata||{};
   const metadata={id:document.drive_file_id,name,mimeType:document.mime_type,parents:[folder.id],appProperties:{flowstack_document:document.id,source_email_id:document.source_email_id,...(document.merged?{flowstack_merged:'true',flowstack_workflow:document.workflow}:{}),...dates.appProperties},description:dates.description||(document.merged?'Merged by FlowStack. Individual original PDFs are preserved.':'Collected by FlowStack.'),...(dates.createdTime?{createdTime:dates.createdTime}:{})};
   try{file=await provider.upload(metadata,bytes,document.mime_type);created=true;}
   catch(e){if(e.providerStatus!==409)throw e;file=await provider.file(document.drive_file_id);}
  }
 }
 if(!file||file.trashed||file.md5Checksum!==md5||!file.parents?.includes(folder.id))throw Error('Drive copy could not be verified. The original is preserved in FlowStack; rerun to retry.');
 document.drive_file_id=file.id;document.drive_folder_id=folder.id;document.drive_file_link='https://drive.google.com/file/d/'+encodeURIComponent(file.id)+'/view';document.drive_sync_status='saved';
 await save();files.push(file);return {created,duplicate:!created};
}
export async function collectWorkflow(req,{owner,db,bucket,key,fetcher=fetch,provider:injected,maxAttachments=3,maxMessages=5}){
 const url=new URL(req.url);if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 if(req.headers.get('origin')!==url.origin)return reply({error:'Invalid request origin'},403);
 let input;try{const raw=await req.text();if(raw.length>2000)throw Error();input=JSON.parse(raw);if(typeof input.supplier_id!=='string'||input.supplier_id.length>150||input.mode!==undefined&&!['full','incremental'].includes(input.mode)||input.retry_failed!==undefined&&typeof input.retry_failed!=='boolean')throw Error();}catch{return reply({error:'Choose one saved workflow and a valid collection mode.'},400);}
 const supplier=await read(db,owner,input.supplier_id,'Supplier');if(!supplier)return reply({error:'Workflow not found'},404);
 let provider,criteria;try{criteria=previewCriteria(supplier);provider=injected||googleProvider((await googleAccess({owner,db,key,fetcher})).access_token,fetcher);}catch(e){return reply({error:e.message},e.status||502);}
 const lockId='collection:lock:'+owner,lease=crypto.randomUUID(),jobKey='collection:job:'+owner+':'+supplier.id;
 const locked=await db.prepare("INSERT INTO records(id,owner,entity,data,created,updated) VALUES(?,?,'CollectionLock',?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated WHERE records.owner=excluded.owner AND CAST(json_extract(records.data,'$.expires') AS INTEGER)<? RETURNING id").bind(lockId,owner,JSON.stringify({lease,expires:Date.now()+180000}),now(),now(),Date.now()).first();
 if(!locked)return reply({error:'A workflow is already running. Wait for it to finish; after an interrupted run, retry in three minutes.'},409);
 let job;
 const saveJob=()=>statement(db,owner,jobKey,'CollectionJob',job).run();
 const finish=async result=>{
  if(!job.done)return;
  const current=await read(db,owner,supplier.id,'Supplier');
  if(!current)throw Error('Workflow was removed.');
  const checkpoint=successfulCheckpoint(current,job,result);
  await supplierPatch(db,owner,supplier.id,{last_run:job.completed_at||now(),status:result.errors?'error':'active',...(checkpoint?{collection_checkpoint:checkpoint,last_successful_check:checkpoint.through}:{})});
 };
 try{
  job=await read(db,owner,jobKey,'CollectionJob');
  if(input.job_id&&job?.id!==input.job_id&&job?.run_id!==input.job_id)return reply({error:'This run is no longer current. Start or resume the workflow again.'},409);
  // Records have their own key; keep the run ID separate from the workflow job key.
  if(job)job.id=job.run_id;
  if(!job||job.done){
   if(input.job_id&&job?.done){const result=await activity(db,owner,job);await finish(result);return reply({job_id:job.id,needs_continue:false,totals:result,results:[result]});}
   const previous=job,started=now(),window=collectionWindow(supplier,input.mode||'full',started);
   let failed=[];
   if(input.retry_failed){
    if(!previous?.done)return reply({error:'Finish or resume collection before retrying failed items.'},409);
    failed=(await db.prepare("SELECT data FROM records WHERE owner=? AND entity='CollectionOutcome' AND json_extract(data,'$.job_id')=? AND json_extract(data,'$.errors')>0").bind(owner,previous.id).all()).results.map(r=>JSON.parse(r.data));
    if(!failed.length)return reply({error:'The latest completed collection has no failed items to retry.'},409);
   }
   job={id:crypto.randomUUID(),workflow:supplier.id,supplier_name:supplier.name,started,criteria:input.retry_failed?previous.criteria:supplier,queue:input.retry_failed?[...new Set(failed.map(r=>r.source_email_id))]:[],started_search:!!input.retry_failed,next_page:null,page_tokens:[],seen:[],current:null,emails_found:0,done:false,...window,collection_query:window.query};
   if(input.retry_failed){job.mode='retry';job.retry_of=previous.id;job.retry_sources=failed.map(r=>({message_id:r.source_email_id,part_id:r.source_part_id,attachment_id:r.source_attachment_id,document_id:r.document_id}));job.folder=previous.folder;job.criteria_signature=previous.criteria_signature;job.checkpoint_through=previous.checkpoint_through||previous.started;job.collection_query=previous.collection_query;}
   job.run_id=job.id;await saveJob();
  }
  criteria=previewCriteria(job.criteria);
  criteria.query=job.collection_query||criteria.query;
  if(!job.folder){job.folder=await resolveFolder({db,owner,supplier,provider,create:true});await saveJob();}
  const files=await provider.files(job.folder.id);
  let processed=0,readMessages=0;
  while(processed<maxAttachments&&readMessages<maxMessages&&!job.done){
   const held=await db.prepare("UPDATE records SET data=?,updated=? WHERE id=? AND owner=? AND json_extract(data,'$.lease')=? RETURNING id").bind(JSON.stringify({lease,expires:Date.now()+180000}),now(),lockId,owner,lease).first();if(!held)throw Error('Run lease expired. Resume the workflow to continue safely.');
   if(!job.current){
    if(!job.queue.length){
     if(job.started_search&&!job.next_page){job.done=true;break;}
     const page=await provider.search(criteria.query,job.next_page);
     if(!Array.isArray(page.messages))throw Error('Invalid Gmail search response.');
     if(page.messages.some(m=>typeof m?.id!=='string'||!m.id))throw Error('Gmail returned an invalid message identifier.');
     const next=page.nextPageToken||null;if(next&&job.page_tokens.includes(next))throw Error('Gmail pagination repeated. Resume after checking the workflow.');if(next)job.page_tokens.push(next);
     job.queue=page.messages.map(m=>m.id).filter(id=>typeof id==='string'&&!job.seen.includes(id));job.next_page=next;job.started_search=true;await saveJob();
     if(!job.queue.length){if(!next)job.done=true;break;}
    }
    const messageId=job.queue[0];const message=await provider.read(messageId);if(!message?.payload)throw Error('Gmail returned an unreadable message.');
    const millis=Number(message.internalDate),received=Number.isFinite(millis)&&millis>0?new Date(millis).toISOString():null;
    let parts=attachments(message.payload,criteria.allowedExtensions);
    if(job.mode==='retry'){
     const wanted=job.retry_sources.filter(s=>s.message_id===messageId);
     parts=parts.filter(p=>wanted.some(s=>s.part_id===p.part_id&&s.attachment_id===p.attachment_id));
     if(parts.length!==wanted.length)throw Error('A failed attachment changed or is unavailable in Gmail. Saved originals are preserved; the successful checkpoint was not advanced.');
    }
    job.current={messageId,received,parts:parts.map(({data,...p})=>({...p,inline:data!==undefined})),index:0};job.emails_found++;job.seen.push(messageId);job.queue.shift();readMessages++;await saveJob();
   }
   const cur=job.current;if(cur.index>=cur.parts.length){job.current=null;await saveJob();continue;}
   const part=cur.parts[cur.index],source=cur.messageId+':'+part.part_id+':'+(part.attachment_id||'inline');
   const outcomeId='collection:outcome:'+job.id+':'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source))),b=>b.toString(16).padStart(2,'0')).join('');
   if(!await read(db,owner,outcomeId,'CollectionOutcome')){
    const outcome={job_id:job.id,files_saved:0,pdfs_saved:0,drive_saved:0,duplicates_skipped:0,name_collision_saved:0,errors:0};let document;
    try{
     let downloadedPart=part;if(part.inline){const m=await provider.read(cur.messageId);downloadedPart=attachments(m.payload,criteria.allowedExtensions).find(p=>p.part_id===part.part_id);if(!downloadedPart)throw Error('Inline Gmail attachment could not be found.');}
     const retrySource=job.retry_sources?.find(s=>s.message_id===cur.messageId&&s.part_id===part.part_id&&s.attachment_id===part.attachment_id);
     let bytes;
     if(retrySource?.document_id){
      const original=await read(db,owner,retrySource.document_id,'Document');
      const object=original?.key?await bucket.get(original.key):null;
      if(!object)throw Error('The saved original is unavailable. No checkpoint was advanced; verify storage before retrying.');
      bytes=new Uint8Array(await object.arrayBuffer());
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
      if(original.workflow!==supplier.id||bytes.length!==original.size||hash!==original.hash||computeMd5(bytes)!==original.md5)throw Error('The saved original failed its integrity check. No original was overwritten and no checkpoint was advanced.');
     }else bytes=await provider.bytes(cur.messageId,downloadedPart);
     if(part.file_type==='pdf'&&new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('The attachment is labeled PDF but has no PDF header. Original remains in Gmail.');
     const saved=await preserve({db,bucket,owner,workflow:supplier.id,part,messageId:cur.messageId,received:cur.received,bytes,driveFiles:files,jobId:job.id});document=saved.document;
     outcome.files_saved=Number(saved.newLocal);outcome.pdfs_saved=Number(saved.newLocal&&part.file_type==='pdf');outcome.name_collision_saved=Number(saved.newLocal&&saved.collision);
     const synced=await synchronize({db,owner,document,bytes,folder:job.folder,provider,files});outcome.drive_saved=Number(synced.created);outcome.duplicates_skipped=Number(!saved.newLocal&&synced.duplicate);
    }catch(e){outcome.errors=1;outcome.error_detail={filename:part.name,message_id:cur.messageId,reason:e.name==='TimeoutError'?'Google request timed out. Rerun to retry; saved originals are preserved.':e.message};if(document){document.drive_sync_status='failed';await statement(db,owner,document.id,'Document',document).run();}}
    outcome.document_id=document?.id||null;outcome.source_email_id=cur.messageId;outcome.source_attachment_id=part.attachment_id;outcome.source_part_id=part.part_id;
    await statement(db,owner,outcomeId,'CollectionOutcome',outcome).run();
   }
   cur.index++;processed++;await saveJob();
  }
  if(job.current&&job.current.index>=job.current.parts.length)job.current=null;
  if(!job.current&&!job.queue.length&&job.started_search&&!job.next_page)job.done=true;
  if(job.done&&!job.completed_at)job.completed_at=now();
  await saveJob();const result=await activity(db,owner,job);await finish(result);
  return reply({job_id:job.id,needs_continue:!job.done,totals:result,results:[result]});
 }catch(e){if(job){await saveJob();await activity(db,owner,job,e.name==='TimeoutError'?'Google request timed out. Resume this workflow.':e.message);}return reply({error:e.name==='TimeoutError'?'Google request timed out. Resume the workflow; completed files are preserved.':e.message,resumable:true},502);}
 finally{await db.prepare("DELETE FROM records WHERE id=? AND owner=? AND json_extract(data,'$.lease')=?").bind(lockId,owner,lease).run();}
}
export async function workflowFiles(req,{owner,db,key,fetcher=fetch,provider:injected}){
 let input;try{const raw=await req.text();if(raw.length>2000)throw Error();input=JSON.parse(raw);}catch{return reply({error:'Invalid workflow'},400);}
 const supplier=await read(db,owner,String(input.supplier_id||''),'Supplier');if(!supplier)return reply({error:'Workflow not found'},404);
 try{const provider=injected||googleProvider((await googleAccess({owner,db,key,fetcher})).access_token,fetcher);const folder=await resolveFolder({db,owner,supplier,provider,create:false});if(!folder)return reply({files:[],supplier_name:supplier.name,total_files:0,pdf_count:0});const listed=await provider.files(folder.id);const merged=await provider.mergedFiles(supplier.id);const files=[...new Map([...listed,...merged].map(f=>[f.id,f])).values()].map(f=>({id:f.id,name:f.name,mime_type:f.mimeType,md5_checksum:f.md5Checksum||null,size:Number(f.size)||0,created_date:f.createdTime,modified_date:f.modifiedTime,web_view_link:'https://drive.google.com/file/d/'+encodeURIComponent(f.id)+'/view',is_pdf:f.mimeType==='application/pdf',merged:f.appProperties?.flowstack_merged==='true'||f.name.includes('_merged_'),source_dates:{email_received:f.appProperties?.source_email_received||null,pdf_creation_date:f.appProperties?.source_pdf_creation||null}}));return reply({files,workflow_name:supplier.name,supplier_name:supplier.name,folder_name:folder.name,folder_link:driveLink(folder.id),drive_folder_id:folder.id,drive_folder_link:driveLink(folder.id),total_files:files.length,total_pdfs:files.filter(f=>f.is_pdf).length,pdf_count:files.filter(f=>f.is_pdf).length});}catch(e){return reply({error:e.message},e.status||502);}
}
