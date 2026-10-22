import {loadAuditReport,buildAuditReport} from './audit-report.mjs';
import {buildWorkspace} from './findings-workspace.mjs';
import {auditReportPdf} from './audit-report-pdf.mjs';
import {googleAccess} from './google-connection.mjs';
import {googleProvider} from './google-provider.mjs';
import {managedFolder} from './drive-folders.mjs';
import {computeMd5} from './content-metadata.mjs';

const now=()=>new Date().toISOString();
async function saveDocument({owner,db,document}){
 const stamp=now();
 await db.prepare("UPDATE records SET data=?,updated=? WHERE owner=? AND id=? AND entity='Document'").bind(JSON.stringify(document),stamp,owner,document.id).run();
}
async function saveReportToDrive({owner,db,provider,folder,document,bytes}){
 const marker=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(owner+':'+document.id))),b=>b.toString(16).padStart(2,'0')).join('');
 if(!document.drive_file_id){document.drive_file_id=await provider.generateId();document.drive_folder_id=folder.id;document.drive_sync_status='pending';document.drive_report_marker=marker;await saveDocument({owner,db,document});}
 if(document.drive_report_marker!==marker||document.drive_folder_id!==folder.id)throw Error('The saved Drive report reference changed; no replacement was created.');
 let existing=null;try{existing=await provider.file(document.drive_file_id);}catch(error){if(error.providerStatus!==404)throw error;}
 if(!existing&&document.drive_sync_status==='saved')throw Error('The saved audit PDF is missing from Drive. Restore it before retrying; no duplicate was created.');
 if(!existing){
  const metadata={id:document.drive_file_id,name:document.name,mimeType:'application/pdf',parents:[folder.id],appProperties:{flowstack_vendor_report:marker}};
  try{await provider.upload(metadata,bytes,'application/pdf',{ignoreDefaultVisibility:true});}catch(error){
   try{existing=await provider.file(document.drive_file_id);}catch(lookupError){if(lookupError.providerStatus!==404)throw lookupError;throw error;}
  }
  if(!existing)existing=await provider.file(document.drive_file_id);
 }
 if(existing.trashed||existing.id!==document.drive_file_id||existing.name!==document.name||existing.mimeType!=='application/pdf'||Number(existing.size)!==bytes.length||existing.md5Checksum!==computeMd5(bytes)||!existing.parents?.includes(folder.id)||existing.appProperties?.flowstack_vendor_report!==marker)throw Error('The Drive audit PDF failed file, folder or content verification. No success was recorded.');
 const permissions=await provider.permissions(existing.id);
 if(!permissions.length||permissions.some(permission=>permission.type!=='user'||permission.role!=='owner'))throw Error('Keep the audit PDF private in Drive before retrying.');
 const link=existing.webViewLink||document.drive_file_link||'https://drive.google.com/file/d/'+encodeURIComponent(existing.id)+'/view';
 if(document.drive_sync_status!=='saved'||document.drive_file_link!==link){document.drive_sync_status='saved';document.drive_file_link=link;document.drive_saved_at=now();await saveDocument({owner,db,document});}
 return link;
}

export async function createVendorReport({owner,db,bucket,key,supplier,run,type,provider:injectedProvider,driveFolder:injectedFolder}){
 if(!['investigation','technical'].includes(type))throw Error('Unknown vendor audit report type.');
 const id=run.id+':report:'+supplier.id+':'+type;
 const prior=await db.prepare("SELECT data FROM records WHERE owner=? AND id=? AND entity='Document'").bind(owner,id).first();
 let document,bytes;
 if(prior){
  document={...JSON.parse(prior.data),id};const object=await bucket.get(document.key);if(!object)throw Error('The saved FlowStack audit PDF is unavailable; no replacement was created.');bytes=new Uint8Array(await object.arrayBuffer());
 }else{
  const origin='https://flowstack.jimdoukakis.chatgpt.site';
  const loaded=await loadAuditReport(new Request(origin+'/api/flow/findings-export?type='+type+'&status=all'),{owner,db});
  if(loaded.error)throw Error((await loaded.error.json()).error||'Report findings could not load.');
  const docs=(await db.prepare("SELECT id FROM records WHERE owner=? AND entity='Document' AND json_extract(data,'$.workflow')=? AND json_extract(data,'$.source_kind')!='audit_report'").bind(owner,supplier.id).all()).results;
  const sources=new Set(docs.map(d=>d.id));const rows=loaded.report.findings.filter(f=>sources.has(f.source_document_id));
  const params=new URLSearchParams({status:'all',...(type==='investigation'?{category:'purchase'}:{})});
  const workspace=buildWorkspace(rows.filter(f=>!f.source_changed),rows.filter(f=>f.source_changed),params,[]);workspace.snapshot=loaded.workspace.snapshot;
  const findingIds=new Set(workspace.findings.map(f=>f.id)),invoiceIds=new Set(workspace.findings.map(f=>f.invoice_id));
  const report=buildAuditReport(workspace,type,origin,'Vendor workflow: '+supplier.name,loaded.report.events.filter(e=>findingIds.has(e.finding_id)),loaded.report.invoiceEvents.filter(e=>invoiceIds.has(e.invoice_id)));
  report.title=supplier.name+' — '+report.title;report.notes+=' Run status: '+(run.errors.length?'incomplete; review run errors.':'review of supported captured invoices; unsupported originals still require review.');
  bytes=await auditReportPdf(report);
  const stamp=now(),safeName=(supplier.name+'-'+type+'-'+stamp.slice(0,10)+'.pdf').replace(/[\x00-\x1f/\\]/g,'_').slice(0,180),storageKey=owner+'/vendor-reports/'+id;
  await bucket.put(storageKey,bytes,{httpMetadata:{contentType:'application/pdf'}});
  document={id,name:safeName,workflow:supplier.id,key:storageKey,file_type:'pdf',mime_type:'application/pdf',source_kind:'audit_report',merged:false,size:bytes.length,processing_status:'generated',audit_run_id:run.id,report_type:type,report_counts:report.counts};
  const stamp2=now();await db.prepare("INSERT INTO records(id,owner,entity,data,created,updated) VALUES(?,?,'Document',?,?,?) ON CONFLICT(id) DO NOTHING").bind(id,owner,JSON.stringify(document),stamp2,stamp2).run();
  const saved=await db.prepare("SELECT data FROM records WHERE owner=? AND id=? AND entity='Document'").bind(owner,id).first();document={...JSON.parse(saved.data),id};
 }
 if(!key&&!injectedProvider)throw Error('Google Drive access is unavailable. Connect Google in Settings and retry the saved audit PDF.');
 const token=injectedProvider?null:(await googleAccess({owner,db,key})).access_token,provider=injectedProvider||googleProvider(token),folder=injectedFolder||await managedFolder({db,owner,provider},'audit');
 const drive_url=await saveReportToDrive({owner,db,provider,folder,document,bytes});
 return {...document,drive_url};
}
