import {chatgptReview} from '@/lib/chatgpt-review-route.mjs';
import {findingsWorkspace} from '@/lib/findings-workspace-route.mjs';
import {findingsExport} from '@/lib/findings-export.mjs';
import {findingReview} from '@/lib/finding-review.mjs';
import {listInvoices} from '@/lib/invoice-list.mjs';
import {driveOrganization} from '@/lib/drive-organization.mjs';
import {statementReconciliation} from '@/lib/statement-reconciliation.mjs';
import {invoiceBatches} from '@/lib/invoice-batch.mjs';
import {auditWorkbooks} from '@/lib/audit-workbook-route.mjs';
import {productHistory} from '@/lib/product-history.mjs';
import {saveInvoiceDraft} from '@/lib/invoice-save.mjs';
import {AUDIT_RULE_VERSION,invoiceIdentity,matchingInvoices} from '@/lib/invoice-audit.mjs';
import {customerPackages} from '@/lib/customer-packages.mjs';
import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '../../../chatgpt-auth';
import {mergedFilename} from '@/lib/merged-filename.mjs';
import {PDFDocument} from 'pdf-lib';
import {documentAnalysis} from '@/lib/extraction/route.mjs';
import {quantityReport} from '@/lib/quantity-report.mjs';
import {invoiceVersions} from '@/lib/invoice-versions.mjs';
import {invoiceReview} from '@/lib/invoice-review.mjs';
import {automationRoute} from '@/lib/automation-runner.mjs';
import {googleRoute} from '@/lib/google-connection.mjs';
import {collectWorkflow,workflowFiles} from '@/lib/workflow-collection.mjs';
import {driveSharing,publicShare} from '@/lib/drive-sharing.mjs';
import {vendorSyncSummary,retryVendorSync} from '@/lib/vendor-sync.mjs';
import {ensureVendorMaster} from '@/lib/vendor-master.mjs';
import {verifyDocument} from '@/lib/document-verification.mjs';
import {driveDocuments} from '@/lib/drive-documents.mjs';
import {documentType,isPdfDocument,alternateDocumentName} from '@/lib/document-types.mjs';
export const dynamic='force-dynamic';
const entities=new Set(['Supplier','RunHistory']);
const json=(data:any,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const documentSelect="SELECT records.*, (SELECT s.data FROM records s WHERE s.owner=records.owner AND s.id='drive:share:'||records.owner||':'||records.id AND s.entity='DriveShare') AS customer_share_data FROM records";
const documentSummary=(r:any)=>({...safeDocument(publicRecord(r)),customer_share:r.customer_share_data?publicShare(JSON.parse(r.customer_share_data)):null});
const db=()=> (env as any).DB;
const bucket=()=> (env as any).BUCKET;
const publicRecord=(r:any)=>({...JSON.parse(r.data),id:r.id,created_date:r.created,updated_date:r.updated});
async function find(owner:string,id:string,entity:string){return db().prepare('SELECT * FROM records WHERE id=? AND owner=? AND entity=?').bind(id,owner,entity).first();}
async function add(owner:string,entity:string,data:any){const id=crypto.randomUUID(),time=new Date().toISOString();await db().prepare('INSERT INTO records (id,owner,entity,data,created,updated) VALUES (?,?,?,?,?,?)').bind(id,owner,entity,JSON.stringify(data),time,time).run();return {...data,id,created_date:time,updated_date:time};}
async function patch(owner:string,id:string,entity:string,data:any){const r=await find(owner,id,entity);if(!r)return null;const next={...JSON.parse(r.data),...data};await db().prepare('UPDATE records SET data=?,updated=? WHERE id=? AND owner=? AND entity=?').bind(JSON.stringify(next),new Date().toISOString(),id,owner,entity).run();return {...publicRecord(r),...next,updated_date:new Date().toISOString()};}
function preparedRecord(owner:string,entity:string,data:any){const id=crypto.randomUUID(),time=new Date().toISOString();return {record:{...data,id,created_date:time,updated_date:time},statement:db().prepare('INSERT INTO records (id,owner,entity,data,created,updated) VALUES (?,?,?,?,?,?)').bind(id,owner,entity,JSON.stringify(data),time,time)};}
function historyData(workflow:string,supplierName:string,operation:string,counts:any={}){return {run_date:new Date().toISOString(),supplier_id:workflow,supplier_name:supplierName,emails_found:0,pdfs_saved:0,files_saved:0,duplicates_skipped:0,identical_content_skipped:0,name_collision_saved:0,errors:0,status:'completed',operation,...counts};}
function safeDocument(doc:any){const {key,...safe}=doc;return safe;}
async function saveDocument(owner:string,data:any,bytes:Uint8Array,history:any,uniqueContent=false){
 const document=preparedRecord(owner,'Document',data),activity=preparedRecord(owner,'RunHistory',history);
 await bucket().put(data.key,bytes,{httpMetadata:{contentType:data.mime_type||'application/pdf'}});
 try{const statements=[document.statement,activity.statement];if(uniqueContent)statements.unshift(db().prepare('INSERT INTO document_content (owner,workflow,hash,document_id) VALUES (?,?,?,?)').bind(owner,data.workflow,data.hash,document.record.id));await db().batch(statements);return document.record;}
 catch(error){await bucket().delete(data.key);throw error;}
}
function supplierData(body:any){return {name:String(body.name||'').trim().slice(0,150),search_type:['sender_email','company_name','gmail_search'].includes(body.search_type)?body.search_type:'sender_email',email:String(body.email||'').slice(0,300),keyword:String(body.keyword||'').slice(0,1000),file_types:Array.isArray(body.file_types)?body.file_types.filter((x:string)=>['pdf','images','word','excel','powerpoint','zip'].includes(x)):['pdf'],drive_folder_name:String(body.drive_folder_name||'').trim().slice(0,150)};}
async function route(req:Request,{params}:{params:Promise<{path:string[]}>}){
 const user=await getChatGPTUser();if(!user)return json({error:'Sign in with ChatGPT to access your documents.'},401);
 const owner=user.userId;const {path}=await params;const [kind,entity,id]=path;const url=new URL(req.url);
 if(req.method!=='GET'){if(req.headers.get('origin')!==url.origin)return json({error:'Invalid request origin'},403);}
 try{
 if(kind==='drive-organization')return driveOrganization(req,{owner,db:db(),key:(env as any).GOOGLE_TOKEN_ENCRYPTION_KEY});
 if(kind==='vendor-sync'&&entity&&req.method==='POST'){
  const saved=await find(owner,entity,'Supplier');if(!saved)return json({error:'Vendor not found'},404);
  let body:any;try{body=await req.json();if(body.invoice_id!==undefined&&(typeof body.invoice_id!=='string'||body.invoice_id.length>100))throw Error();}catch{return json({error:'Invalid retry request'},400);}
  try{return json(await retryVendorSync({owner,db:db(),key:(env as any).GOOGLE_TOKEN_ENCRYPTION_KEY,supplier:publicRecord(saved),invoiceId:body.invoice_id||null}));}catch(error:any){return json({error:String(error.message||error)},502);}
 }
 if(kind==='vendor-master'&&entity&&req.method==='POST'){
  const saved=await find(owner,entity,'Supplier');if(!saved)return json({error:'Vendor not found'},404);
  try{const master=await ensureVendorMaster({owner,db:db(),key:(env as any).GOOGLE_TOKEN_ENCRYPTION_KEY,supplier:publicRecord(saved)});await patch(owner,entity,'Supplier',{master_status:'ready',master_url:master.url,master_id:master.spreadsheet_id,master_error:null});return json({master});}
  catch(error:any){await patch(owner,entity,'Supplier',{master_status:'pending',master_error:String(error.message||error)});return json({error:error.message},502);}
 }
 if(kind==='automation')return automationRoute(req,{owner,db:db(),bucket:bucket(),key:(env as any).GOOGLE_TOKEN_ENCRYPTION_KEY});
 if(kind==='invoice-batches')return invoiceBatches(req,{owner,db:db(),bucket:bucket()});
 if(kind==='packages')return customerPackages(req,{owner,db:db(),bucket:bucket(),key:(env as any).GOOGLE_TOKEN_ENCRYPTION_KEY});
 if(kind==='google')return await googleRoute(req,{owner,db:db(),key:(env as any).GOOGLE_TOKEN_ENCRYPTION_KEY});
 if(kind==='me')return json({...user,full_name:user.displayName,role:'user'});
 if(kind==='functions'){
  if(entity==='verifyDocument')return verifyDocument(req,{owner,db:db(),bucket:bucket(),key:(env as any).GOOGLE_TOKEN_ENCRYPTION_KEY});
  if(entity==='shareDocument')return driveSharing(req,{owner,db:db(),bucket:bucket(),key:(env as any).GOOGLE_TOKEN_ENCRYPTION_KEY});
  if(['mergePdfs','importDriveFiles','exportDriveDocument','linkDrivePdf'].includes(entity))return driveDocuments(req,{owner,db:db(),bucket:bucket(),key:(env as any).GOOGLE_TOKEN_ENCRYPTION_KEY});
  if(entity==='downloadPdfs')return collectWorkflow(req,{owner,db:db(),bucket:bucket(),key:(env as any).GOOGLE_TOKEN_ENCRYPTION_KEY});
  if(entity==='listWorkflowFiles'&&req.method==='POST')return workflowFiles(req,{owner,db:db(),key:(env as any).GOOGLE_TOKEN_ENCRYPTION_KEY});
  if(entity==='previewResults'&&req.method==='POST'){
   let criteria:any;try{const raw=await req.text();if(raw.length>6000)throw Error();criteria=JSON.parse(raw);if(!criteria||typeof criteria!=='object'||Array.isArray(criteria))throw Error();}catch{return json({error:'Invalid search criteria'},400);}
   if(criteria.supplier_id){const saved=await find(owner,String(criteria.supplier_id),'Supplier');if(!saved)return json({error:'Workflow not found'},404);criteria=JSON.parse(saved.data);}
   return googleRoute(new Request(url.origin+'/api/flow/google/preview',{method:'POST',headers:{origin:url.origin,'Content-Type':'application/json'},body:JSON.stringify(criteria)}),{owner,db:db(),key:(env as any).GOOGLE_TOKEN_ENCRYPTION_KEY});
  }
  return json({error:'Unknown workflow action.'},404);
 }
 if(kind==='invoice-suppliers'&&req.method==='GET'){const suppliers=(await db().prepare("SELECT supplier_key,supplier_name,COUNT(*) AS invoice_count,SUM(CASE WHEN audit_status='approved' THEN 1 ELSE 0 END) AS approved_count,SUM(CASE WHEN audit_status='needs_review' THEN 1 ELSE 0 END) AS review_count,SUM(CASE WHEN audit_status='excluded' THEN 1 ELSE 0 END) AS excluded_count FROM invoices WHERE owner=? AND capture_method IS NOT NULL GROUP BY supplier_key,supplier_name ORDER BY supplier_name").bind(owner).all()).results;return json({suppliers});}
 if(kind==='reconciliation')return statementReconciliation(req,{db:db(),owner});
 if(kind==='audit-workbooks')return auditWorkbooks(req,{db:db(),bucket:bucket(),owner,key:(env as any).GOOGLE_TOKEN_ENCRYPTION_KEY});
 if(kind==='chatgpt-review')return chatgptReview(req,{db:db(),owner,id:entity,key:(env as any).GOOGLE_TOKEN_ENCRYPTION_KEY});
 if(kind==='findings-workspace')return findingsWorkspace(req,{db:db(),owner});
 if(kind==='findings-export')return findingsExport(req,{db:db(),owner});
 if(kind==='findings')return findingReview(req,{db:db(),owner,id:entity});
 if(kind==='purchases')return productHistory(req,{db:db(),owner});
 if(kind==='reports'&&req.method==='GET')return quantityReport(req,{db:db(),owner});
 if(kind==='document-analysis'&&entity)return documentAnalysis(req,{db:db(),bucket:bucket(),owner,id:entity});
 if(kind==='invoices'){
  if(entity&&id==='versions')return invoiceVersions(req,{db:db(),owner,id:entity});
  if(entity&&id&&req.method==='POST')return invoiceReview(req,{db:db(),owner,id:entity,action:id});
  if(req.method==='GET'){
   if(entity){
    const invoice=await db().prepare('SELECT * FROM invoices WHERE id=? AND owner=?').bind(entity,owner).first();if(!invoice)return json({error:'Invoice not found'},404);
    const document=await find(owner,invoice.source_document_id,'Document');
    const lines=await db().prepare('SELECT * FROM invoice_line_items WHERE owner=? AND invoice_id=? ORDER BY position').bind(owner,entity).all();
    const ledger=await db().prepare('SELECT revision FROM invoice_ledger WHERE owner=?').bind(owner).first();
    const events=await db().prepare('SELECT * FROM invoice_events WHERE owner=? AND invoice_id=? ORDER BY created DESC,id DESC LIMIT 100').bind(owner,entity).all();
    const matches=(await matchingInvoices(db(),owner,invoice)).map((row:any)=>({id:row.id,invoice_number:row.invoice_number,supplier_name:row.supplier_name,document_type:row.document_type,invoice_series:row.invoice_series,audit_status:row.audit_status}));
    return json({invoice,source:document?safeDocument(publicRecord(document)):null,line_items:lines.results||[],events:events.results,matches,audit_current:invoice.audit_rule_version===AUDIT_RULE_VERSION&&invoice.identity_key===invoiceIdentity(invoice)&&invoice.audit_ledger_revision!==null&&invoice.audit_ledger_revision===(ledger?.revision??0)});
   }
   return listInvoices(db(),owner,url.searchParams);
  }
  if(req.method==='PATCH'&&entity)return saveInvoiceDraft(req,{db:db(),owner,id:entity});
  if(req.method==='DELETE'&&entity){
   const invoice=await db().prepare('SELECT id FROM invoices WHERE id=? AND owner=?').bind(entity,owner).first();if(!invoice)return json({error:'Invoice not found'},404);
   const result=await db().prepare("DELETE FROM invoices WHERE id=? AND owner=? AND analysis_status='awaiting_analysis' AND audit_status='not_started' AND NOT EXISTS (SELECT 1 FROM invoice_line_items WHERE invoice_id=? AND owner=?)").bind(entity,owner,entity,owner).run();if(!result.meta.changes)return json({error:'This invoice contains analysis or review data and cannot be removed from the queue.'},409);return json({ok:true});
  }
  if(req.method==='POST'&&!entity){
   const body:any=await req.json();if(typeof body.document_id!=='string'||body.document_id.length>100)return json({error:'Choose an existing PDF.'},400);
   const document=await find(owner,body.document_id,'Document');if(!document)return json({error:'Source document not found'},404);if(JSON.parse(document.data).invoice_review_classification==='not_invoice')return json({error:'Skipped — not an invoice. Restore this file from the Skipped tab before queueing it.'},409);if(JSON.parse(document.data).storage_kind==='drive_reference')return json({error:'This is a Drive reference. Local invoice extraction for large Drive PDFs is not available yet.'},409);if(!isPdfDocument(JSON.parse(document.data)))return json({error:'Invoice analysis starts with an original PDF.'},400);
   const now=new Date().toISOString(),invoiceId=crypto.randomUUID();
   const inserted=await db().prepare("INSERT INTO invoices (id,owner,source_document_id,analysis_status,audit_status,created,updated) SELECT ?,?,?,?, ?,?,? WHERE EXISTS (SELECT 1 FROM records WHERE id=? AND owner=? AND entity='Document') ON CONFLICT(owner,source_document_id) DO NOTHING").bind(invoiceId,owner,body.document_id,'awaiting_analysis','not_started',now,now,body.document_id,owner).run();
   const invoice=await db().prepare('SELECT * FROM invoices WHERE owner=? AND source_document_id=?').bind(owner,body.document_id).first();if(!invoice)return json({error:'The source document is no longer available.'},404);
   return json({invoice,already_queued:inserted.meta.changes===0});
  }
 }
 if(kind==='records'){
  if(!entities.has(entity))return json({error:'Unknown entity'},404);
  if(req.method==='GET'){
   if(id){const r=await find(owner,id,entity);return r?json(publicRecord(r)):json({error:'Record not found'},404);}
   const rows=await db().prepare('SELECT * FROM records WHERE owner=? AND entity=? ORDER BY created DESC LIMIT 500').bind(owner,entity).all();
   let out=(rows.results||[]).map(publicRecord);if(entity==='Supplier')out=await Promise.all(out.map(async(s:any)=>({...s,sheet_sync:await vendorSyncSummary({db:db(),owner,supplier:s})})));const sort=url.searchParams.get('sort')||'';
   if(sort){const field=sort.replace(/^-/,'');const direction=sort.startsWith('-')?-1:1;out.sort((a:any,b:any)=>String(a[field]||'').localeCompare(String(b[field]||''))*direction);}
   return json(out.slice(0,Math.min(500,Math.max(1,Number(url.searchParams.get('limit'))||200))));
  }
  if(entity!=='Supplier')return json({error:'History records are managed by document operations.'},403);
  if(req.method==='DELETE'&&id){await db().prepare('DELETE FROM records WHERE id=? AND owner=? AND entity=?').bind(id,owner,entity).run();return json({ok:true});}
  const body=await req.json();const existing=req.method==='PATCH'&&id?await find(owner,id,entity):null;if(req.method==='PATCH'&&id&&!existing)return json({error:'Record not found'},404);const data=supplierData({...(existing?JSON.parse(existing.data):{}),...body});if(!data.name||!data.drive_folder_name)return json({error:'Workflow name and folder name are required.'},400);
  if(req.method==='POST'){
   const saved=await add(owner,entity,{...data,status:'new',master_status:'pending'});
   try{const master=await ensureVendorMaster({owner,db:db(),key:(env as any).GOOGLE_TOKEN_ENCRYPTION_KEY,supplier:saved});return json(await patch(owner,saved.id,entity,{master_status:'ready',master_url:master.url,master_id:master.spreadsheet_id,master_error:null}));}
   catch(error:any){return json(await patch(owner,saved.id,entity,{master_status:'pending',master_error:String(error.message||error)}));}
  }
  if(req.method==='PATCH'&&id){const result=await patch(owner,id,entity,data);return result?json(result):json({error:'Record not found'},404);}
 }
 if(kind==='documents'){
  if(req.method==='GET'){
   if(entity){const r=await find(owner,entity,'Document');if(!r)return json({error:'Document not found'},404);const d=JSON.parse(r.data);if(d.storage_kind==='drive_reference')return Response.redirect('https://drive.google.com/file/d/'+encodeURIComponent(d.source_drive_file_id)+'/view',303);const obj=await bucket().get(d.key);if(!obj)return json({error:'File unavailable'},404);return new Response(obj.body,{headers:{'Content-Type':d.mime_type||'application/pdf','Content-Disposition':`${url.searchParams.get('preview')==='1'?'inline':'attachment'}; filename="${String(d.name).replace(/[^\x20-\x7e]|["\\]/g,'_')}"; filename*=UTF-8''${encodeURIComponent(d.name)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}
   if(url.searchParams.get('page')==='1'){
    const search=url.searchParams.get('search')||'',type=url.searchParams.get('type')||'',view=url.searchParams.get('view')||'',cursor=url.searchParams.get('cursor');
    if(search.length>200||/[\x00-\x1f]/.test(search)||type&&!['pdf','images','word','excel','powerpoint','zip'].includes(type)||!['','merged','shared'].includes(view))return json({error:'Invalid file filter.'},400);
    const limit=Math.min(100,Math.max(1,Math.trunc(Number(url.searchParams.get('limit')))||100));
    let where='owner=? AND entity=?';const values:any[]=[owner,'Document'];
    if(url.searchParams.has('workflow')){where+=" AND COALESCE(json_extract(data,'$.workflow'),'')=?";values.push(url.searchParams.get('workflow'));}
    if(search){where+=" AND instr(lower(json_extract(data,'$.name')),lower(?))>0";values.push(search);}
    if(type){where+=" AND COALESCE(json_extract(data,'$.file_type'),'pdf')=?";values.push(type);}
    if(view==='merged')where+=" AND json_extract(data,'$.merged')=1";
    if(view==='shared')where+=" AND EXISTS(SELECT 1 FROM records s WHERE s.owner=records.owner AND s.id='drive:share:'||records.owner||':'||records.id AND s.entity='DriveShare')";
    if(cursor){let last;try{if(cursor.length>500)throw Error();last=JSON.parse(atob(cursor));if(typeof last.created!=='string'||last.created.length>30||!Number.isFinite(Date.parse(last.created))||typeof last.id!=='string'||! /^[a-zA-Z0-9_-]{1,100}$/.test(last.id))throw Error();}catch{return json({error:'Invalid file page. Refresh the list.'},400);}where+=' AND (created<? OR (created=? AND id<?))';values.push(last.created,last.created,last.id);}
    const rows=(await db().prepare(documentSelect+' WHERE '+where+' ORDER BY created DESC,id DESC LIMIT ?').bind(...values,limit+1).all()).results||[];
    const page=rows.slice(0,limit),last=page.at(-1);return json({documents:page.map(documentSummary),next_cursor:rows.length>limit?btoa(JSON.stringify({created:last.created,id:last.id})):null});
   }
   const rows=await db().prepare(documentSelect+' WHERE owner=? AND entity=? ORDER BY created DESC LIMIT 500').bind(owner,'Document').all();return json((rows.results||[]).map(documentSummary));
  }
  if(req.method==='DELETE'&&entity){
   const lock=await find(owner,'collection:lock:'+owner,'CollectionLock');if(lock&&JSON.parse(lock.data).expires>Date.now())return json({error:'A Drive operation is running. Wait before deleting its source.'},409);
   const share=await find(owner,'drive:share:'+owner+':'+entity,'DriveShare');if(share&&JSON.parse(share.data).status!=='revoked')return json({error:'Revoke the customer link before deleting its source PDF.'},409);
   const r=await find(owner,entity,'Document');if(!r)return json({error:'Document not found'},404);const result=await db().batch([db().prepare("DELETE FROM records WHERE id=? AND owner=? AND entity='Document' AND NOT EXISTS (SELECT 1 FROM invoices WHERE owner=? AND source_document_id=?) AND NOT EXISTS(SELECT 1 FROM document_analysis WHERE owner=? AND document_id=?) AND NOT EXISTS(SELECT 1 FROM records WHERE owner=? AND entity='CollectionLock' AND CAST(json_extract(data,'$.expires') AS INTEGER)>?) AND NOT EXISTS(SELECT 1 FROM records WHERE owner=? AND id=? AND entity='DriveShare' AND json_extract(data,'$.status')<>'revoked')").bind(entity,owner,owner,entity,owner,entity,owner,Date.now(),owner,'drive:share:'+owner+':'+entity),db().prepare("DELETE FROM document_content WHERE document_id=? AND owner=? AND NOT EXISTS (SELECT 1 FROM records WHERE id=? AND owner=? AND entity='Document')").bind(entity,owner,entity,owner)]);if(result[0].meta.changes===0)return json({error:'This source is protected by invoice/analysis records, a customer link or an active Drive operation. Resolve the link or operation before deleting; invoice sources must be retained.'},409);if(JSON.parse(r.data).key)await bucket().delete(JSON.parse(r.data).key);return json({ok:true});}
  if(req.method==='POST'&&entity==='upload'){
   if(Number(req.headers.get('content-length')||0)>11*1024*1024)return json({error:'Maximum upload size is 10 MB.'},413);
   const form=await req.formData(),file=form.get('file');if(!(file instanceof File)||file.size>10*1024*1024)return json({error:'Choose a supported file smaller than 10 MB.'},400);
   const type=documentType(file.name);if(!type)return json({error:'Supported files: PDF, images, Word, Excel, PowerPoint and ZIP.'},400);const bytes=new Uint8Array(await file.arrayBuffer());if(type.file_type==='pdf'&&!new TextDecoder().decode(bytes.slice(0,1024)).includes('%PDF-'))return json({error:'This file is not a PDF.'},400);
   let pages:number|null=null,processingStatus=type.file_type==='pdf'?'ready':'stored';if(type.file_type==='pdf'){try{const pdf=await PDFDocument.load(bytes);pages=pdf.getPageCount();}catch{processingStatus='needs_review';}}
   let workflow=String(form.get('workflow')||'');if(workflow&&!await find(owner,workflow,'Supplier'))return json({error:'Workflow not found'},404);
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
   const supplierName=workflow?publicRecord(await find(owner,workflow,'Supplier')).name:'Manual upload';
   const previous=await db().prepare('SELECT * FROM records WHERE owner=? AND entity=?').bind(owner,'Document').all();const duplicate=(previous.results||[]).find((r:any)=>{const d=JSON.parse(r.data);return d.hash===hash&&d.workflow===workflow;});
   const duplicateResponse=async(r:any)=>{await add(owner,'RunHistory',historyData(workflow,supplierName,'File upload',{duplicates_skipped:1,identical_content_skipped:1}));return json({duplicate:true,document:safeDocument(publicRecord(r))});};
   if(duplicate)return duplicateResponse(duplicate);
   const originalName=file.name.replace(/[\x00-\x1f/\\]/g,'_').slice(0,180)||'document.pdf';
   const collision=(previous.results||[]).some((r:any)=>{const d=JSON.parse(r.data);return d.workflow===workflow&&(d.original_name||d.name)===originalName;});
   const name=collision?alternateDocumentName(originalName,hash):originalName;
   const key=owner+'/'+crypto.randomUUID()+'.'+type.extension;
   let doc;
   try{doc=await saveDocument(owner,{key,hash,workflow,name,original_name:originalName,mime_type:type.mime_type,file_type:type.file_type,size:file.size,pages,processing_status:processingStatus,merged:false},bytes,historyData(workflow,supplierName,'File upload',{pdfs_saved:type.file_type==='pdf'?1:0,files_saved:1,name_collision_saved:collision?1:0}),true);}
   catch(error){const claim=await db().prepare('SELECT document_id FROM document_content WHERE owner=? AND workflow=? AND hash=?').bind(owner,workflow,hash).first();if(claim){const existing=await find(owner,claim.document_id,'Document');if(existing)return duplicateResponse(existing);}throw error;}
   return json({document:safeDocument(doc),duplicate:false});
  }
  if(req.method==='POST'&&entity==='merge'){
   const body:any=await req.json();const ids=body.ids;if(!Array.isArray(ids)||ids.length<2||ids.length>20||new Set(ids).size!==ids.length)return json({error:'Select 2–20 different PDFs to merge.'},400);
   const selected=[];let size=0;for(const id of ids){const r=await find(owner,String(id),'Document');if(!r)return json({error:'A selected document is unavailable.'},404);const d=JSON.parse(r.data);if(!isPdfDocument(d))return json({error:`Only PDFs can be merged. ${d.name} is not a PDF.`},400);size+=d.size;selected.push(d);}
   if(selected.some(d=>d.storage_kind==='drive_reference'))return json({error:'Drive references cannot be merged locally. Import eligible smaller originals first; large-file merging is not available yet.'},409);
   if(size>20*1024*1024)return json({error:'Selected PDFs exceed the 20 MB merge limit.'},413);
   const merged=await PDFDocument.create();for(const d of selected){const obj=await bucket().get(d.key);if(!obj)return json({error:'A selected file is unavailable.'},404);try{const input=await PDFDocument.load(await obj.arrayBuffer());const pages=await merged.copyPages(input,input.getPageIndices());pages.forEach(page=>merged.addPage(page));}catch{return json({error:`Cannot merge ${d.name}: this PDF is encrypted or unreadable. The original remains stored and downloadable.`,document_id:ids[selected.indexOf(d)]},422);}}
   const bytes=await merged.save();const key=owner+'/'+crypto.randomUUID()+'.pdf';const mergeWorkflow=selected.every(d=>d.workflow===selected[0].workflow)?selected[0].workflow:'';const supplierRecord=mergeWorkflow?await find(owner,mergeWorkflow,'Supplier'):null;const supplierLabel=supplierRecord?JSON.parse(supplierRecord.data).name:(mergeWorkflow?'Documents':'Mixed suppliers');const name=String(body.name||mergedFilename(supplierLabel)).replace(/["\x00-\x1f/\\]/g,'_').slice(0,170);
   const workflow=selected.every(d=>d.workflow===selected[0].workflow)?selected[0].workflow:'';
   const doc=await saveDocument(owner,{key,mime_type:'application/pdf',file_type:'pdf',name:name.toLowerCase().endsWith('.pdf')?name:name+'.pdf',size:bytes.length,pages:merged.getPageCount(),processing_status:'ready',workflow,merged:true,source_ids:ids},bytes,historyData(workflow,'Manual merge','PDF merge',{pdfs_saved:1,files_saved:1}));return json({document:safeDocument(doc)});
  }
 }
 return json({error:'Not found'},404);
 }catch(e:any){console.error('Flowstack operation failed',e?.name);return json({error:'The operation could not be completed. Refresh and try again.'},500);}
}
export const GET=route,POST=route,PATCH=route,DELETE=route;
