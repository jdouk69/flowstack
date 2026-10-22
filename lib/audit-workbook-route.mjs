import {sheetsQuotaGate} from './sheets-quota.mjs';
import {managedFolder} from './drive-folders.mjs';
import {productHistory} from './product-history.mjs';
import {googleAccess} from './google-connection.mjs';
import {googleProvider} from './google-provider.mjs';
import {auditSheetProvider} from './audit-sheet-provider.mjs';
import {buildAuditWorkbook,workbookRequests,workbookRanges,workbookMatches,workbookLayoutMatches} from './audit-workbook.mjs';
const mime='application/vnd.google-apps.spreadsheet';
// Evidence is repeated in the master and review tabs. Bound the complete atomic
// request rather than rejecting ordinary multi-hundred-line audit snapshots.
const MAX_WORKBOOK_REQUEST_BYTES=12_000_000;
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const now=()=>new Date().toISOString();
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');
const safe=job=>({id:job.id,name:job.name,status:job.status,created:job.created,completed:job.completed||null,url:job.url||null,line_count:job.line_count,invoice_count:job.invoice_count,filters:job.filters,invoice_status:job.invoice_status,error:job.error||null});
const read=async(db,owner,id)=>{const row=await db.prepare("SELECT data FROM records WHERE owner=? AND id=? AND entity='AuditWorkbook'").bind(owner,id).first();return row?JSON.parse(row.data):null;};
const put=(db,owner,job)=>db.prepare("INSERT INTO records(id,owner,entity,data,created,updated) VALUES(?,?,'AuditWorkbook',?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated WHERE records.owner=excluded.owner AND records.entity='AuditWorkbook'").bind(job.id,owner,JSON.stringify(job),job.created,now()).run();
const validFile=(file,job)=>file?.id===job.drive_id&&!file.trashed&&file.mimeType===mime&&file.appProperties?.flowstack_audit===job.marker;
const privateFile=permissions=>Array.isArray(permissions)&&permissions.length>0&&permissions.every(permission=>permission.type==='user'&&permission.role==='owner');
export async function auditWorkbooks(req,{db,bucket,owner,key,fetcher=fetch,provider:injected,sheets:injectedSheets}){
 if(req.method==='GET'){const rows=(await db.prepare("SELECT data FROM records WHERE owner=? AND entity='AuditWorkbook' ORDER BY created DESC,id DESC LIMIT 101").bind(owner).all()).results;return json({workbooks:rows.slice(0,100).map(row=>safe(JSON.parse(row.data))),has_more:rows.length>100});}
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 let input;try{const raw=await req.text();if(raw.length>4000)throw Error();input=JSON.parse(raw);if(!input||Array.isArray(input)||typeof input!=='object')throw Error();}catch{return json({error:'Invalid export request'},400);}
 if(input.id!==undefined&&(typeof input.id!=='string'||!/^audit-workbook:[a-f0-9]{64}$/.test(input.id)))return json({error:'Invalid workbook identifier'},400);
 if(input.id&&!(await read(db,owner,input.id)))return json({error:'Workbook not found'},404);
 if(input.id&&input.action!=='retry'&&input.action!=='check')return json({error:'Unknown workbook action'},400);
 const lease=crypto.randomUUID(),lock='audit-workbook-lock:'+owner;const locked=await db.prepare("INSERT INTO records(id,owner,entity,data,created,updated) VALUES(?,?,'AuditWorkbookLock',?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated WHERE records.owner=excluded.owner AND CAST(json_extract(records.data,'$.expires') AS INTEGER)<? RETURNING id").bind(lock,owner,JSON.stringify({lease,expires:Date.now()+300000}),now(),now(),Date.now()).first();
 if(!locked)return json({error:'Another workbook export is running. Retry shortly.'},409);
 let job;try{
  if(input.id)job=await read(db,owner,input.id);
  else{
   if(typeof input.name!=='string'||!input.name.trim()||input.name.length>150||/[\x00-\x1f]/.test(input.name)||typeof input.query!=='string'||input.query.length>2500)throw Object.assign(Error('Enter a workbook name and valid report filters.'),{status:400});
   const query=new URLSearchParams(input.query),allowed=new Set(['supplier','account','from','to','flag','status','item','number','receiver','category','kind','classification','view','batches']);for(const [key] of query)if(!allowed.has(key)||query.getAll(key).length!==1)throw Object.assign(Error('Invalid workbook filter'),{status:400});query.sort();
   const response=await productHistory(new Request(new URL(req.url).origin+'/api/flow/purchases?'+query),{db,owner});if(!response.ok)return response;const data=await response.json();if(!data.line_count)throw Object.assign(Error('No captured lines match. Capture/review invoices or explicitly include drafts first.'),{status:409});if(data.line_count>1000)throw Object.assign(Error('This export supports up to 1,000 lines. Narrow the supplier or date range; no partial workbook was created.'),{status:413});
   if(data.status!=='approved'&&input.include_drafts!==true)throw Object.assign(Error('Confirm that this snapshot includes unapproved or excluded records.'),{status:400});
   const workbook=buildAuditWorkbook(data,{origin:new URL(req.url).origin,filters:query.toString(),name:input.name.trim()}),requests=workbookRequests(workbook);if(new TextEncoder().encode(JSON.stringify({requests})).length>MAX_WORKBOOK_REQUEST_BYTES)throw Object.assign(Error('This workbook exceeds the 12 MB export limit. Narrow the supplier or date range; no partial workbook was created.'),{status:413});
   const marker=await hash(JSON.stringify({owner,workbook})),id='audit-workbook:'+marker;job=await read(db,owner,id);if(!job){const snapshot_key=owner+'/audit-workbooks/'+marker+'.json';await bucket.put(snapshot_key,JSON.stringify(workbook),{httpMetadata:{contentType:'application/json'}});job={id,marker,name:workbook.name,snapshot_key,status:'pending',created:now(),line_count:workbook.line_count,invoice_count:workbook.invoice_count,filters:workbook.filters,invoice_status:workbook.status};await put(db,owner,job);}
  }
  const object=await bucket.get(job.snapshot_key);if(!object)throw Error('Saved workbook snapshot is unavailable. No workbook was changed.');const workbook=JSON.parse(await object.text());
  const token=injected&&injectedSheets?null:(await googleAccess({owner,db,key,fetcher})).access_token,provider=injected||googleProvider(token,fetcher),sheets=injectedSheets||auditSheetProvider(token,fetcher,{beforeRequest:sheetsQuotaGate(db,owner)});job.error=null;
  if(!job.drive_id){
   const candidates=await provider.auditFiles(job.marker);if(candidates.length>1)throw Error('Multiple Drive files match this export marker. No workbook was changed; review the files in Drive.');
   if(candidates.length===1){job.drive_id=candidates[0].id;await put(db,owner,job);}
   else{
    if(job.create_started)throw Error('Google creation outcome is uncertain. Retry later to check for the original workbook; FlowStack will not create another copy blindly.');
    const destination=await managedFolder({db,owner,provider},'audit');job.folder_id=destination.id;job.create_started=now();await put(db,owner,job);
    try{const file=await provider.createAudit({name:job.name,mimeType:mime,parents:[job.folder_id],appProperties:{flowstack_audit:job.marker}});if(!file?.id)throw Error('Google returned no workbook identifier.');job.drive_id=file.id;await put(db,owner,job);}
    catch(error){if([400,401,403,404,429].includes(error.providerStatus)){job.create_started=null;await put(db,owner,job);}throw error;}
   }
  }
  const file=await provider.file(job.drive_id);if(!validFile(file,job))throw Error('The saved Drive workbook was removed or its app marker/type changed. No replacement or overwrite was made.');
  if(!privateFile(await provider.permissions(job.drive_id)))throw Error('This workbook has additional sharing permissions. FlowStack will not write private audit data into it. Keep this app-owned export private before retrying.');
  let metadata=await sheets.metadata(job.drive_id);if(metadata.spreadsheetId!==job.drive_id)throw Error('Google returned a different workbook.');const existing=metadata.sheets||[],found=workbook.tabs.map(tab=>existing.find(sheet=>sheet.properties?.title===tab.title));
  if(found.some(Boolean)){
   if(!found.every(Boolean))throw Error('Workbook tabs have changed or an unexpected partial layout exists. No existing cells were overwritten.');
   const values=await sheets.read(job.drive_id,workbookRanges(workbook));if(!workbookMatches(workbook,values)){job.status='changed';throw Error('Workbook cells differ from the saved snapshot. Your spreadsheet changes were preserved; no cells were overwritten.');}
  }else{
   if(input.action==='check'||job.status==='completed'||job.status==='changed')throw Error('Expected workbook tabs are missing. No cells were overwritten.');
   if(existing.some(sheet=>Number(sheet.properties?.sheetId)>=100&&Number(sheet.properties?.sheetId)<100+workbook.tabs.length))throw Error('Workbook sheet identifiers conflict. No cells were overwritten.');
   job.status='writing';await put(db,owner,job);await sheets.write(job.drive_id,workbookRequests(workbook));metadata=await sheets.metadata(job.drive_id);
   if(!workbook.tabs.every(tab=>metadata.sheets?.some(sheet=>sheet.properties?.title===tab.title)))throw Error('Google workbook tabs could not be verified. Retry this saved export.');
   if(!workbookMatches(workbook,await sheets.read(job.drive_id,workbookRanges(workbook))))throw Error('Google workbook rows could not be verified. Retry this saved export.');
  }
  if(!workbookLayoutMatches(workbook,metadata)){job.status='changed';throw Error('Workbook color rules or frozen headers differ from the saved layout. Existing spreadsheet formatting was preserved; no overwrite was made.');}
  const url=metadata.spreadsheetUrl;let observed;try{observed=new URL(url);}catch{throw Error('Google returned no workbook link.');}if(observed.origin!=='https://docs.google.com'||observed.pathname!=='/spreadsheets/d/'+job.drive_id+'/edit')throw Error('Google returned an unexpected workbook link.');
  job.url=url;job.status='completed';job.completed=job.completed||now();await put(db,owner,job);return json({workbook:safe(job)});
 }catch(error){if(job){if(job.status!=='changed')job.status='failed';job.error=error.message;await put(db,owner,job);}return json({error:error.message,workbook:job?safe(job):null},error.status||502);}
 finally{await db.prepare("DELETE FROM records WHERE id=? AND owner=? AND entity='AuditWorkbookLock' AND json_extract(data,'$.lease')=?").bind(lock,owner,lease).run();}
}
