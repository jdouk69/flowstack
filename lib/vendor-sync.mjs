import {syncVendorInvoice} from './vendor-master.mjs';
import {markDocument} from './automation-runner.mjs';
const read=row=>row?JSON.parse(row.data):null;
export async function vendorSyncSummary({db,owner,supplier}){
 if(!supplier.master_id)return {last_verified:null,last_attempt:null};
 const args=[owner,supplier.master_id];
 const last=read(await db.prepare("SELECT data FROM records WHERE owner=? AND entity='SheetsSync' AND json_extract(data,'$.spreadsheet_id')=? ORDER BY updated DESC,id DESC LIMIT 1").bind(...args).first());
 const verified=read(await db.prepare("SELECT data FROM records WHERE owner=? AND entity='SheetsSync' AND json_extract(data,'$.spreadsheet_id')=? AND json_extract(data,'$.status')='completed' ORDER BY json_extract(data,'$.completed') DESC,id DESC LIMIT 1").bind(...args).first());
 const safe=job=>job?{invoice:job.invoice_number||job.invoice_id,status:job.status,completed:job.completed,updated:job.updated,verified:job.verified||null,error:job.error||null}:null;
 return {last_verified:safe(verified),last_attempt:safe(last)};
}
// One existing invoice per request. This repair never extracts again or creates
// PDFs/master files. Master appends are verified and deduplicated by the sync.
export async function retryVendorSync({db,owner,key,supplier,invoiceId=null,fetcher=fetch,sync=syncVendorInvoice}){
 const master=read(await db.prepare("SELECT data FROM records WHERE owner=? AND id=? AND entity='VendorMaster'").bind(owner,'vendor-master:'+owner+':'+supplier.id).first());
 if(!master?.spreadsheet_id||master.status!=='ready')throw Error('This vendor has no ready saved master. Set up its master first.');
 const rows=(await db.prepare("SELECT i.id,d.id AS document_id,d.data FROM invoices i JOIN records d ON d.owner=i.owner AND d.id=i.source_document_id AND d.entity='Document' LEFT JOIN records s ON s.owner=i.owner AND s.entity='SheetsSync' AND s.id=('sheets-sync:'||i.owner||':'||?||':'||i.id) WHERE i.owner=? AND json_extract(d.data,'$.workflow')=? AND i.capture_method IS NOT NULL AND i.audit_status<>'excluded' AND (? IS NULL OR i.id=?) AND (json_extract(s.data,'$.status')='failed' OR json_extract(d.data,'$.automation_sheet_sync_status')='failed') ORDER BY i.created,i.id LIMIT 1").bind(master.spreadsheet_id,owner,supplier.id,invoiceId,invoiceId).all()).results||[];
 if(!rows.length)return {done:true,status:'completed',message:'No failed captured-invoice sync remains for this vendor.'};
 const row=rows[0],result=await sync({db,owner,key,supplier,invoiceId:row.id,master,fetcher});
 if(result.status!=='completed')throw Error('The saved invoice sync did not verify completion.');
 await markDocument(db,owner,{id:row.document_id,data:row.data},{automation_sheet_sync_status:'completed',automation_processed_at:new Date().toISOString()});
 return {done:false,status:'completed',invoice:result.invoice_number,completed:result.completed,verified:result.verified,master_url:result.master_url};
}
