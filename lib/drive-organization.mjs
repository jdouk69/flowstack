import {googleAccess} from './google-connection.mjs';
import {googleProvider} from './google-provider.mjs';
import {folderNames,managedFolder,moveVerified} from './drive-folders.mjs';
const now=()=>new Date().toISOString(),json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const entities="'Supplier','Document','DriveExport','DriveShare','CustomerPackage','AuditWorkbook'";
const save=(db,owner,row,data)=>db.prepare('UPDATE records SET data=?,updated=? WHERE id=? AND owner=? AND entity=?').bind(JSON.stringify(data),now(),row.id,owner,row.entity).run();
export async function driveOrganization(req,{db,owner,key,provider:injected,fetcher=fetch}){
 if(req.method==='GET'){const rows=(await db.prepare("SELECT data FROM records WHERE owner=? AND entity='DriveFolder'").bind(owner).all()).results;return json({folders:rows.map(row=>{const f=JSON.parse(row.data);return {role:f.role,name:folderNames[f.role],url:'https://drive.google.com/drive/folders/'+encodeURIComponent(f.id)};})});}
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 if(req.headers.get('origin')!==new URL(req.url).origin)return json({error:'Invalid request origin'},403);
 let input;try{const raw=await req.text();if(raw.length>1000)throw Error();input=JSON.parse(raw);if(!['setup','organize'].includes(input.action)||input.cursor!==undefined&&(typeof input.cursor!=='string'||input.cursor.length>300))throw Error();}catch{return json({error:'Invalid folder request'},400);}
 const lease=crypto.randomUUID(),locks=['collection:lock:'+owner,'audit-workbook-lock:'+owner];const held=[];
 try{
  for(const lock of locks){const row=await db.prepare("INSERT INTO records(id,owner,entity,data,created,updated) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated WHERE records.owner=excluded.owner AND CAST(json_extract(records.data,'$.expires') AS INTEGER)<? RETURNING id").bind(lock,owner,lock.startsWith('collection:')?'CollectionLock':'AuditWorkbookLock',JSON.stringify({lease,expires:Date.now()+300000}),now(),now(),Date.now()).first();if(!row)return json({error:'A Drive operation is running. Wait for it to finish, then organize.'},409);held.push(lock);}
  const provider=injected||googleProvider((await googleAccess({owner,db,key,fetcher})).access_token,fetcher),folders={};for(const role of Object.keys(folderNames))folders[role]=await managedFolder({db,owner,provider},role);
  if(input.action==='setup')return json({folders:Object.entries(folders).map(([role,f])=>({role,name:f.name,url:f.link}))});
  const root=await provider.root(),rows=(await db.prepare('SELECT id,entity,data FROM records WHERE owner=? AND entity IN ('+entities+') AND id>? ORDER BY id LIMIT 4').bind(owner,input.cursor||'').all()).results;
  const results=[];
  for(const row of rows.slice(0,3)){
   const data=JSON.parse(row.data);let id,role,expected,marker;
   if(row.entity==='Supplier'){id=data.drive_folder_id;role='suppliers';}
   else if(row.entity==='AuditWorkbook'){id=data.drive_id;role='audit';marker=['flowstack_audit',data.marker];}
   else if(row.entity==='CustomerPackage'){if(!['ready','unavailable','blocked'].includes(data.status))continue;id=data.drive_id;role='shared';expected=data.md5;marker=['flowstack_package',data.id||row.id];}
   else if(row.entity==='DriveShare'){id=data.file_id;role='shared';expected=data.md5;marker=['flowstack_source_document',data.source_document_id];}
   else if(row.entity==='Document'){if(!data.merged||data.storage_kind==='drive_reference'||data.drive_sync_status!=='saved')continue;id=data.drive_file_id;role='merged';expected=data.md5;marker=['flowstack_document',row.id];}
   else if(row.entity==='DriveExport'){const source=await db.prepare("SELECT data FROM records WHERE owner=? AND id=? AND entity='Document'").bind(owner,data.document_id).first();if(!source||!JSON.parse(source.data).merged||data.drive_sync_status!=='saved')continue;id=data.drive_file_id;role='merged';expected=JSON.parse(source.data).md5;marker=['flowstack_document',data.document_id];}
   if(!id)continue;
   try{
    const file=await provider.file(id);if(file.trashed)throw Error('File is deleted or unavailable.');
    if(row.entity==='Supplier'){
     if(file.mimeType!=='application/vnd.google-apps.folder')throw Error('Saved destination is not a folder.');
     if(!file.parents?.includes(folders.suppliers.id)){
      if(file.parents?.length!==1||file.parents[0]!==root.id)throw Error('Existing custom folder location preserved.');
      const permissions=await provider.permissions(id);if(!permissions.length||permissions.some(p=>p.type!=='user'||p.role!=='owner'))throw Error('Shared workflow folder preserved.');
      const contents=await provider.files(id);if(!contents.length&&file.appProperties?.flowstack_workflow_folder!==row.id)throw Error('Empty unmarked folder preserved.');
      for(const child of contents){const docId=child.appProperties?.flowstack_document;if(!docId)throw Error('Folder contains files not identified as FlowStack-created; its location was preserved.');const source=await db.prepare("SELECT id FROM records WHERE owner=? AND id=? AND entity='Document'").bind(owner,docId).first();if(!source)throw Error('Folder contains files outside this app account; its location was preserved.');}
     }
    }else{
     if(!marker[1]||file.appProperties?.[marker[0]]!==marker[1]||expected&&file.md5Checksum!==expected)throw Error('App ownership marker or checksum differs; original preserved.');
     if(row.entity==='DriveShare'&&file.appProperties?.flowstack_customer_copy!=='true')throw Error('This is not a dedicated customer copy.');
     if(row.entity==='Document'||row.entity==='DriveExport'){const workflow=data.workflow||JSON.parse((await db.prepare("SELECT data FROM records WHERE owner=? AND id=? AND entity='Document'").bind(owner,data.document_id).first()).data).workflow;if(workflow){await provider.markWorkflow(id,{...file.appProperties,flowstack_workflow:workflow});}}
    }
    const moved=await moveVerified(provider,file,folders[role]);
    if(row.entity==='CustomerPackage'){data.root_id=folders.shared.id;await save(db,owner,row,data);}
    if(row.entity==='AuditWorkbook'){data.folder_id=folders.audit.id;await save(db,owner,row,data);}
    if(row.entity==='DriveShare'){data.folder_id=folders.shared.id;await save(db,owner,row,data);}
    if(row.entity==='Document'){data.drive_folder_id=folders.merged.id;await save(db,owner,row,data);}
    if(row.entity==='DriveExport'){data.drive_folder_id=folders.merged.id;await save(db,owner,row,data);const source=await db.prepare("SELECT id,entity,data FROM records WHERE owner=? AND id=? AND entity='Document'").bind(owner,data.document_id).first();if(source){const doc=JSON.parse(source.data);doc.drive_exports=(doc.drive_exports||[]).map(e=>e.file_id===id?{...e,folder_id:folders.merged.id}:e);await save(db,owner,source,doc);}}
    results.push({name:file.name||data.name||data.filename,status:moved?'moved':'already organized',folder:folderNames[role]});
   }catch(error){results.push({name:data.name||data.filename||row.id,status:'needs attention',reason:error.message});}
  }
  return json({folders:Object.entries(folders).map(([role,f])=>({role,name:f.name,url:f.link})),results,next_cursor:rows.length>3?rows[2].id:null});
 }catch(error){return json({error:error.message},502);}
 finally{for(const lock of held)await db.prepare("DELETE FROM records WHERE id=? AND owner=? AND json_extract(data,'$.lease')=?").bind(lock,owner,lease).run();}
}
