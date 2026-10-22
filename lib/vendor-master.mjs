import {sheetsQuotaGate} from './sheets-quota.mjs';
import {googleAccess} from './google-connection.mjs';
import {googleProvider} from './google-provider.mjs';
import {auditSheetProvider} from './audit-sheet-provider.mjs';
import {managedFolder} from './drive-folders.mjs';
import {LINE_HEADERS,ATTENTION_HEADERS,syncTournasInvoice} from './tournas-master-sync.mjs';
const TOURNAS_MASTER='1kWKSJBUTms912f1kZyGmNkpasVNDMX62Iz3HnqkYPCc';
const now=()=>new Date().toISOString();
async function prepareVendorMaster({owner,db,key,supplier,provider:injected,sheets:injectedSheets,fetcher=fetch}){
 const id='vendor-master:'+owner+':'+supplier.id;
 const row=await db.prepare("SELECT data FROM records WHERE owner=? AND id=? AND entity='VendorMaster'").bind(owner,id).first();
 const saved=row?JSON.parse(row.data):{vendor_id:supplier.id,name:supplier.name+' — FlowStack Master',created:now()};
 const put=()=>db.prepare("INSERT INTO records(id,owner,entity,data,created,updated) VALUES(?,?,'VendorMaster',?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated WHERE records.owner=excluded.owner AND records.entity='VendorMaster'").bind(id,owner,JSON.stringify(saved),saved.created,now()).run();
 const token=injected&&injectedSheets?null:(await googleAccess({owner,db,key,fetcher})).access_token;
 const provider=injected||googleProvider(token,fetcher),sheets=injectedSheets||auditSheetProvider(token,fetcher,{beforeRequest:sheetsQuotaGate(db,owner)});
 if(!saved.spreadsheet_id&&/tournas|τουρνα/i.test(supplier.name)){
  const suppliers=(await db.prepare("SELECT id,data FROM records WHERE owner=? AND entity='Supplier' ORDER BY created,id").bind(owner).all()).results||[];
  const original=suppliers.find(row=>/tournas|τουρνα/i.test(JSON.parse(row.data).name||''));
  if(original?.id===supplier.id)saved.spreadsheet_id=TOURNAS_MASTER;
 }
 if(!saved.spreadsheet_id){
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(id));saved.marker=[...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');
  const candidates=await provider.auditFiles(saved.marker);if(candidates.length>1)throw Error('Multiple vendor masters found. Review Drive before continuing.');
  if(candidates.length===1)saved.spreadsheet_id=candidates[0].id;
  else{
   if(saved.create_started)throw Error('Master creation outcome is uncertain. Resume to look for the original; no duplicate will be created.');
   const folder=await managedFolder({db,owner,provider},'audit');saved.create_started=now();await put();
   try{const file=await provider.createAudit({name:saved.name,mimeType:'application/vnd.google-apps.spreadsheet',parents:[folder.id],appProperties:{flowstack_audit:saved.marker}});if(!file?.id)throw Error('Google returned no master identifier.');saved.spreadsheet_id=file.id;await put();}
   catch(error){if([400,401,403,404,429].includes(error.providerStatus)){saved.create_started=null;await put();}throw error;}
  }
 }
 await put();
 if(saved.spreadsheet_id!==TOURNAS_MASTER){
  const file=await provider.file(saved.spreadsheet_id);if(file.trashed||file.mimeType!=='application/vnd.google-apps.spreadsheet'||file.appProperties?.flowstack_audit!==saved.marker)throw Error('Vendor master was removed or changed; restore it before retrying.');
  const permissions=await provider.permissions(saved.spreadsheet_id);if(!permissions.length||permissions.some(p=>p.type!=='user'||p.role!=='owner'))throw Error('Keep this vendor master private before writing audit data.');
 }
 const metadata=await sheets.metadata(saved.spreadsheet_id);if(metadata.spreadsheetId!==saved.spreadsheet_id)throw Error('Unexpected spreadsheet returned.');
 const tabs=[['Line Item Audit',LINE_HEADERS],['Needs Attention',ATTENTION_HEADERS],['Paint & Consumables',ATTENTION_HEADERS]];
 const found=tabs.map(([title])=>metadata.sheets?.find(s=>s.properties?.title===title));
 if(found.some(Boolean)&&!found.every(Boolean))throw Error('Vendor master tabs were changed; no cells were overwritten.');
 if(!found.some(Boolean)){
  if(saved.initialized||saved.spreadsheet_id===TOURNAS_MASTER)throw Error('Expected master tabs are missing. Restore them before retrying.');
  if(metadata.sheets?.some(s=>s.properties?.gridProperties?.rowCount>1000))throw Error('Unexpected workbook layout.');
  await sheets.write(saved.spreadsheet_id,tabs.flatMap(([title,headers],i)=>[{addSheet:{properties:{sheetId:100+i,title,gridProperties:{rowCount:10000,columnCount:10,frozenRowCount:1}}}},{updateCells:{start:{sheetId:100+i,rowIndex:0,columnIndex:0},rows:[{values:headers.map(value=>({userEnteredValue:{stringValue:value}}))}],fields:'userEnteredValue'}}]));
 }
 const ranges=tabs.map(([title])=>"'"+title+"'!A1:J1"),values=await sheets.read(saved.spreadsheet_id,ranges);
 if(!tabs.every(([,headers],i)=>JSON.stringify(values.valueRanges?.[i]?.values?.[0])===JSON.stringify(headers)))throw Error('Master headers failed verification.');
 saved.initialized=true;saved.url='https://docs.google.com/spreadsheets/d/'+saved.spreadsheet_id+'/edit';saved.status='ready';await put();return saved;
}
export async function syncVendorInvoice(context){const candidate=context.master;const master=candidate?.vendor_id===context.supplier.id&&candidate?.status==='ready'?candidate:await ensureVendorMaster(context);if(candidate===master&&master.spreadsheet_id!==TOURNAS_MASTER){const {owner,db,key,fetcher=fetch}=context;const token=(await googleAccess({owner,db,key,fetcher})).access_token;const provider=googleProvider(token,fetcher),file=await provider.file(master.spreadsheet_id),permissions=await provider.permissions(master.spreadsheet_id);if(file.trashed||file.appProperties?.flowstack_audit!==master.marker||!permissions.length||permissions.some(p=>p.type!=='user'||p.role!=='owner'))throw Error('Vendor master privacy or identity changed. No audit data was written.');}const result=await syncTournasInvoice({...context,masterId:master.spreadsheet_id,vendorId:context.supplier.id});return {...result,master_url:master.url};}

export async function ensureVendorMaster(context){
 const {owner,db,supplier}=context,lock='vendor-master-lock:'+owner+':'+supplier.id,lease=crypto.randomUUID(),expires=Date.now()+180000;
 const claimed=await db.prepare("INSERT INTO records(id,owner,entity,data,created,updated) VALUES(?,?,'VendorMasterLock',?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated WHERE records.owner=excluded.owner AND CAST(json_extract(records.data,'$.expires') AS INTEGER)<? RETURNING id").bind(lock,owner,JSON.stringify({lease,expires}),now(),now(),Date.now()).first();
 if(!claimed)throw Error('Vendor master setup is already running. Retry shortly.');
 try{return await prepareVendorMaster(context);}
 finally{await db.prepare("DELETE FROM records WHERE owner=? AND id=? AND entity='VendorMasterLock' AND json_extract(data,'$.lease')=?").bind(owner,lock,lease).run();}
}
