import {sheetsQuotaGate} from './sheets-quota.mjs';
import {googleAccess} from './google-connection.mjs';
import {auditSheetProvider} from './audit-sheet-provider.mjs';
import {constructionTranslation} from './product-translations.mjs';
import {suggestProductCategory} from './product-categories.mjs';
import {receiverLabel} from './invoice-evidence.mjs';

export const MASTER_ID='1kWKSJBUTms912f1kZyGmNkpasVNDMX62Iz3HnqkYPCc';
const MAX_MASTER_ROWS=20000;
const SYNC_VERSION='master-invoice-register-v4';
const CONTENT_FINGERPRINT_VERSION='master-evidence-v3';
export const EVIDENCE_HEADERS=['Recorded At','Invoice','Invoice ID','Audit Revision','Line Position','Flag','Finding Code','Finding','Evidence JSON','Original PDF','Review Link','Evidence Key'];
export const INVOICE_HEADERS=['Recorded At','Invoice','Invoice ID','Audit Revision','Supplier','Supplier Key','Document Type','Series','Printed Identifier','Invoice Date','Customer','Account / Tax ID','Project / Destination','Subtotal Before Discount','Invoice Discount','Net Subtotal','VAT','Invoice Total','Currency','Receiver','Receiver Status','Deliverer','Vehicle Registration','Audit Status','Audit Flag','Duplicate Of','Original PDF','Review Link','Printed Field Evidence','Line Items JSON','Audit Reasons JSON','Evidence Key'];
export const LINE_HEADERS=['Date','Invoice','Receiver (Ο ΠΑΡΑΛΑΒΩΝ)','Item','Quantity','Unit','Unit Price (pre-VAT)','Line Amount (pre-VAT)','Flag','Notes'];
export const ATTENTION_HEADERS=['Date','Invoice','Name(s) Printed','Item','Quantity','Unit','Unit Price (pre-VAT)','Line Amount (pre-VAT)','Flag','Notes'];
const keyText=value=>String(value??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('el');
const amount=value=>value===null||value===undefined||value===''?'':/^[-+]?\d+(?:[.,]\d+)?$/.test(String(value))?Number(String(value).replace(',','.')):String(value);
const serialDate=value=>{if(typeof value==='number'&&Number.isFinite(value)){const d=new Date(Date.UTC(1899,11,30)+value*86400000);return d.toISOString().slice(0,10);}return String(value??'').slice(0,10);};
const sameCore=(a,b)=>serialDate(a?.[0])===serialDate(b[0])&&keyText(a?.[1])===keyText(b[1])&&keyText(a?.[3])===keyText(b[3])&&amount(a?.[4])===amount(b[4])&&keyText(a?.[5])===keyText(b[5])&&amount(a?.[6])===amount(b[6])&&amount(a?.[7])===amount(b[7]);
const signature=row=>JSON.stringify([serialDate(row?.[0]),keyText(row?.[1]),keyText(row?.[3]),amount(row?.[4]),keyText(row?.[5]),amount(row?.[6]),amount(row?.[7]),String(row?.[9]||'').match(/^Supplier workflow: (.+)$/m)?.[1]||'']);
const rowsOf=valueRange=>valueRange?.values||[];
const parseReasons=invoice=>{try{const value=JSON.parse(invoice.audit_reasons||'[]');return Array.isArray(value)?value:[];}catch{return [];}};
function explanation(invoice,line,reasons,origin){
 const greek=line.printed_name||line.description||'';
 const translated=constructionTranslation(greek);
 const relevant=reasons.filter(reason=>!reason.evidence?.some?.(entry=>Number.isInteger(entry.position))||reason.evidence.some(entry=>entry.position===line.position));
 const checks=relevant.map(reason=>{
  const evidence=(reason.evidence||[]).map(entry=>{
   const source=entry.invoice_number?`invoice #${entry.invoice_number}${entry.invoice_date?` (${entry.invoice_date})`:''}`:entry.invoice_id?`earlier invoice record ${entry.invoice_id}`:'';
   const prices=entry.current_unit_price!=null||entry.unit_price!=null?` at prior unit price ${entry.unit_price??'unknown'} per ${entry.unit||line.unit||'unit'}${entry.current_unit_price!=null?`; current unit price ${entry.current_unit_price}`:''}`:'';
   const math=entry.calculated_net!=null?`; calculation ${entry.calculated_net}, printed ${entry.line_amount??line.line_amount}, difference ${entry.difference??'not available'}`:'';
   return source?source+prices+math+(entry.invoice_id?`; review ${origin}/invoices/${entry.invoice_id}`:''):'';
  }).filter(Boolean);
  let question='Can you confirm this item’s specification, quantity, price and delivery against the original supplier and site records?';
  if(/price_change|unit price/i.test(reason.code||''))question='Can you confirm whether the compared products, pack sizes, discounts and VAT basis are equivalent, and explain the price difference?';
  else if(/duplicate/i.test(reason.code||''))question='Can you confirm whether this invoice or charge was already billed or paid, and provide the corresponding payment or credit record?';
  else if(/line_calculation|subtotal|total_mismatch/i.test(reason.code||''))question='Can you confirm the printed quantity, unit price, discount, VAT and invoice total, and explain the arithmetic difference?';
  else if(/cross_supplier/i.test(reason.code||''))question='Can you confirm the exact product specification and why it was purchased from this supplier rather than the earlier supplier?';
  return `${reason.color||'YELLOW'}: ${reason.reason||'Review the original invoice.'}${evidence.length?` Supporting comparison: ${evidence.join('; ')}.`:''} Ask: ${question}`;
 });
 return [
  greek?`Original Greek: ${greek}`:'Original product text is missing.',
  translated?.english?`English: ${translated.english}${translated.uncertainty?` ${translated.uncertainty}`:''}`:/[\u0370-\u03ff\u1f00-\u1fff]/u.test(greek)?'English translation is not confidently available; check the original.':`English: ${greek}`,
  ...(checks.length?checks:['No meaningful concern was identified by the available checks; this unapproved draft still requires review.']),
  `Original PDF: ${origin}/api/flow/documents/${invoice.source_document_id}`,
  `FlowStack review: ${origin}/invoices/${invoice.id}`
 ].join('\n');
}
function valuesFor(invoice,line,flag,notes){
 const translation=constructionTranslation(line.printed_name||line.description);
 const display=translation?.english||line.printed_name||line.description||'Product translation needs review';
 return [invoice.invoice_date||'',invoice.invoice_number??'',receiverLabel(invoice),display,line.quantity??'',line.unit??'',line.unit_price??'',line.line_amount??'',flag,notes];
}
const digest=async data=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(data))))].map(n=>n.toString(16).padStart(2,'0')).join('');
const TITLES=['Line Item Audit','Needs Attention','Paint & Consumables'];
export async function readAll(sheets,masterId,metadata=null,includeEvidence=false,extra={}){
 metadata??=await sheets.metadata(masterId);
 const titles=includeEvidence?[...TITLES,'Audit Evidence','Invoice Register']:TITLES;
 const ranges=titles.map(title=>{const rows=(Number(metadata.sheets?.find(s=>s.properties?.title===title)?.properties?.gridProperties?.rowCount)||1000)+(extra[title]||0),end=title==='Audit Evidence'?'L':title==='Invoice Register'?'AF':'J';if(rows>MAX_MASTER_ROWS)throw Error(`Master sheet grid exceeds the safe ${MAX_MASTER_ROWS.toLocaleString()}-row limit; synchronization stopped before reading or appending rows.`);return "'"+title+"'!A1:"+end+rows;});
 const result=await sheets.read(masterId,ranges);
 return {...result,valueRanges:(result.valueRanges||[]).map((range,i)=>({...range,title:titles[i]}))};
}
const counts=rows=>{const map=new Map();for(const row of rows){const sig=signature(row);map.set(sig,(map.get(sig)||0)+1);}return map;};
const missingRows=(expected,existing)=>{const seen=new Map(),current=counts(existing);return expected.filter(row=>{const sig=signature(row),n=(seen.get(sig)||0)+1;seen.set(sig,n);return n>(current.get(sig)||0);});};
const hasEveryRow=(actual,expected)=>{const a=counts(actual),e=counts(expected);return [...e].every(([sig,n])=>(a.get(sig)||0)>=n);};
export async function syncTournasInvoice({owner,db,invoiceId,key,origin='https://flowstack.jimdoukakis.chatgpt.site',fetcher=fetch,masterId=MASTER_ID,vendorId=null,combinedSupplier=null,sheetOptions={}}){
 const lock=`sheets-sync-lock:${owner}:${masterId}`,lease=crypto.randomUUID(),time=new Date().toISOString();
 const claimed=await db.prepare("INSERT INTO records(id,owner,entity,data,created,updated) VALUES(?,?,'SheetsSyncLock',?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated WHERE records.owner=excluded.owner AND records.entity='SheetsSyncLock' AND CAST(json_extract(records.data,'$.expires') AS INTEGER)<? RETURNING id").bind(lock,owner,JSON.stringify({lease,expires:Date.now()+300000}),time,time,Date.now()).first();
 if(!claimed)throw Error('Another sync to this master is running. Retry shortly; no duplicate write was started.');
 const syncId=vendorId?`sheets-sync:${owner}:${masterId}:${invoiceId}`:`sheets-sync:${owner}:${invoiceId}`;
 const job={invoice_id:invoiceId,vendor_id:vendorId,spreadsheet_id:masterId,sync_version:SYNC_VERSION,status:'running',stage:'read',started:time,updated:time,error:null};
 const writeStatus=async()=>{job.updated=new Date().toISOString();await db.prepare("INSERT INTO records(id,owner,entity,data,created,updated) VALUES(?,?,'SheetsSync',?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated WHERE records.owner=excluded.owner AND records.entity='SheetsSync'").bind(syncId,owner,JSON.stringify(job),time,job.updated).run();};
 try{
  const invoice=await db.prepare('SELECT * FROM invoices WHERE owner=? AND id=?').bind(owner,invoiceId).first();
  if(!invoice)throw Error('Invoice record is missing.');
  const supplier=String(invoice.supplier_key||'').toLowerCase();
  if(!vendorId&&supplier!=='tournas'&&!/tournas|τουρνα/i.test(invoice.supplier_name||'')){job.status='skipped';job.error='This supplier is not configured for the Tournas master.';job.completed=new Date().toISOString();await writeStatus();return job;}
  if(vendorId){const source=await db.prepare("SELECT data FROM records WHERE owner=? AND id=? AND entity='Document'").bind(owner,invoice.source_document_id).first();if(!source||JSON.parse(source.data).workflow!==vendorId)throw Error('Invoice does not belong to this vendor master.');}
  const lineRows=(await db.prepare('SELECT * FROM invoice_line_items WHERE owner=? AND invoice_id=? ORDER BY position').bind(owner,invoiceId).all()).results||[];
  if(!lineRows.length)throw Error('No extracted line items are available to synchronize.');
  job.invoice_number=invoice.invoice_number||invoiceId;
  const {created:ignoredCreated,updated:ignoredUpdated,...snapshotInvoice}=invoice;
  job.fingerprint=await digest({version:CONTENT_FINGERPRINT_VERSION,invoice:snapshotInvoice,lines:lineRows});
  const old=await db.prepare("SELECT data FROM records WHERE id=? AND owner=? AND entity='SheetsSync'").bind(syncId,owner).first();
  const saved=old?JSON.parse(old.data):null;
  if(saved?.status==='completed'&&saved.fingerprint===job.fingerprint&&saved.sync_version===SYNC_VERSION)return {...saved,skipped:true};
  await writeStatus();
  const tokens=await googleAccess({owner,db,key,fetcher});
  if(!String(tokens.scope||'').split(' ').includes('https://www.googleapis.com/auth/spreadsheets'))throw Error('This saved Google connection lacks the Google Sheets write scope. Reconnect Google in Settings and grant Sheets access.');
  const sheets=auditSheetProvider(tokens.access_token,fetcher,{beforeRequest:sheetsQuotaGate(db,owner),...sheetOptions});
  const metadata=await sheets.metadata(masterId);
  if(metadata.spreadsheetId!==masterId)throw Error('Google returned a different spreadsheet.');
  const expected=[['Line Item Audit',LINE_HEADERS],['Needs Attention',ATTENTION_HEADERS],['Paint & Consumables',ATTENTION_HEADERS]];
  if(expected.some(([title])=>!metadata.sheets?.some(s=>s.properties?.title===title)))throw Error('The configured master tabs were renamed or removed; no rows were written.');
  // Append-only evidence snapshots preserve original master rows and notes.
  for(const [title,headers] of [['Audit Evidence',EVIDENCE_HEADERS],['Invoice Register',INVOICE_HEADERS]])if(!metadata.sheets.some(s=>s.properties?.title===title)){
   const sheetId=Math.max(0,...metadata.sheets.map(s=>s.properties.sheetId))+1,properties={sheetId,title,gridProperties:{rowCount:1000,columnCount:headers.length,frozenRowCount:1}};
   await sheets.write(masterId,[{addSheet:{properties}},{updateCells:{start:{sheetId,rowIndex:0,columnIndex:0},rows:[{values:headers.map(value=>({userEnteredValue:{stringValue:value}}))}],fields:'userEnteredValue'}}]);metadata.sheets.push({properties});
  }
  expected.push(['Audit Evidence',EVIDENCE_HEADERS],['Invoice Register',INVOICE_HEADERS]);
  const current=await readAll(sheets,masterId,metadata,true),byTitle=new Map(current.valueRanges.map(r=>[r.title,rowsOf(r)]));
  if(!expected.every(([title,headers])=>JSON.stringify(byTitle.get(title)?.[0]||[])===JSON.stringify(headers)))throw Error('The configured master headers changed; no data rows were written.');
  const reasons=parseReasons(invoice),lineExpected=[],attentionExpected=[],paintExpected=[],severity={GREEN:0,YELLOW:1,ORANGE:2,RED:3};
  for(const line of lineRows){
   const relevant=reasons.filter(reason=>!reason.evidence?.some?.(entry=>Number.isInteger(entry.position))||reason.evidence.some(entry=>entry.position===line.position));
   const strongest=relevant.reduce((value,reason)=>severity[reason.color]>severity[value]?reason.color:value,'GREEN');
   let flag=['GREEN','YELLOW','ORANGE','RED'].includes(invoice.audit_flag)?invoice.audit_flag:'YELLOW';
   if(severity[strongest]>severity[flag])flag=strongest;
   if(invoice.audit_status!=='approved'&&flag==='GREEN')flag='YELLOW';
   const notes=explanation(invoice,line,reasons,origin);
   const label=combinedSupplier&&!/tournas|τουρνα/i.test(combinedSupplier.name||'')?`Supplier: ${combinedSupplier.name}\nSupplier workflow: ${JSON.stringify(vendorId)}\n`:'';
   const row=valuesFor(invoice,line,flag,label+notes);
   lineExpected.push(row);if(flag!=='GREEN')attentionExpected.push(row);
   const category=suggestProductCategory(line);if(category.category==='Paint & Finishing'&&!category.ambiguous)paintExpected.push(row);
  }
  const findings=[...reasons,{color:invoice.audit_flag||'YELLOW',code:'comparison_coverage',reason:reasons.some(r=>(r.evidence||[]).some(e=>e.invoice_id&&e.invoice_id!==invoice.id))?'Prior-invoice comparison evidence is included in this snapshot.':'No prior-invoice comparison evidence was established by this audit. Comparisons require matching approved history and verified account/project, item, unit and currency.',evidence:[]}];
  const evidenceRows=[];
  for(const [index,reason] of findings.entries()){
   const evidenceKey=await digest([invoice.id,job.fingerprint,index,reason]);
   const positions=[...new Set((reason.evidence||[]).map(e=>e.position).filter(Number.isInteger))].join(', ');
   evidenceRows.push([time,job.invoice_number,invoice.id,invoice.revision??'',positions,reason.color||'',reason.code||'',reason.reason||'',JSON.stringify(reason.evidence||[]),origin+'/api/flow/documents/'+invoice.source_document_id,origin+'/invoices/'+invoice.id,evidenceKey]);
  }
  const existingKeys=new Set((byTitle.get('Audit Evidence')||[]).slice(1).map(r=>r[11]));
  const registerKey=await digest([invoice.id,job.fingerprint,'invoice-register']),registerRow=[time,invoice.invoice_number??'',invoice.id,invoice.revision??'',invoice.supplier_name||combinedSupplier?.name||invoice.supplier_key||'',invoice.supplier_key||'',invoice.document_type||'',invoice.invoice_series||'',invoice.printed_document_identifier||'',invoice.invoice_date||'',invoice.customer_information||'',invoice.account_information||'',invoice.project_information||'',invoice.subtotal_before_discount??'',invoice.invoice_discount_printed??'',invoice.subtotal??'',invoice.vat??'',invoice.invoice_total??'',invoice.currency||'',invoice.receiver||'',invoice.receiver_status||'',invoice.deliverer||'',invoice.vehicle_registration||'',invoice.audit_status||'',invoice.audit_flag||'',invoice.duplicate_of||'',origin+'/api/flow/documents/'+invoice.source_document_id,origin+'/invoices/'+invoice.id,invoice.field_evidence||'',JSON.stringify(lineRows.map(({id:lineId,owner:lineOwner,invoice_id:lineInvoice,...line})=>line)),JSON.stringify(reasons),registerKey];
  const existingRegisterKeys=new Set((byTitle.get('Invoice Register')||[]).slice(1).map(r=>r[31]));
  const additions=new Map([['Line Item Audit',missingRows(lineExpected,byTitle.get('Line Item Audit').slice(1))],['Needs Attention',missingRows(attentionExpected,byTitle.get('Needs Attention').slice(1))],['Paint & Consumables',missingRows(paintExpected,byTitle.get('Paint & Consumables').slice(1))],['Audit Evidence',evidenceRows.filter(r=>!existingKeys.has(r[11]))],['Invoice Register',existingRegisterKeys.has(registerKey)?[]:[registerRow]]]);
  const extra=Object.fromEntries([...additions].map(([title,rows])=>[title,rows.length]));
  for(const [title,n] of Object.entries(extra)){const grid=metadata.sheets.find(s=>s.properties.title===title).properties.gridProperties.rowCount;if(grid+n>MAX_MASTER_ROWS)throw Error('This append would exceed the safe master grid limit. No data rows were appended.');}
  job.stage='append';job.planned={line_item_rows:additions.get('Line Item Audit').length,attention_rows:additions.get('Needs Attention').length,paint_rows:additions.get('Paint & Consumables').length,evidence_rows:additions.get('Audit Evidence').length};await writeStatus();
  for(const [title,rows] of additions){if(rows.length)await sheets.append(masterId,"'"+title+"'!A:"+(title==='Audit Evidence'?'L':'J'),rows);}
  job.stage='verify';await writeStatus();
  const after=await readAll(sheets,masterId,metadata,true,extra),afterMap=new Map(after.valueRanges.map(r=>[r.title,rowsOf(r).slice(1)]));
  const keys=new Set((afterMap.get('Audit Evidence')||[]).map(r=>r[11]));
  const registerKeys=new Set((afterMap.get('Invoice Register')||[]).map(r=>r[31]));
  if(!hasEveryRow(afterMap.get('Line Item Audit')||[],lineExpected)||!hasEveryRow(afterMap.get('Needs Attention')||[],attentionExpected)||!hasEveryRow(afterMap.get('Paint & Consumables')||[],paintExpected)||!evidenceRows.every(r=>keys.has(r[11]))||!registerKeys.has(registerKey))throw Error('One or more invoice, line-item or evidence rows did not verify on readback. Retry reads the master and appends only missing rows.');
  job.status='completed';job.completed=new Date().toISOString();job.verified={...job.planned,invoice_register_rows:1,invoice_line_rows:lineExpected.length,existing_line_rows:lineExpected.length-job.planned.line_item_rows,finding_count:reasons.length,comparison_evidence:reasons.reduce((n,r)=>n+(r.evidence||[]).filter(e=>e.invoice_id&&e.invoice_id!==invoice.id).length,0),spreadsheet_url:metadata.spreadsheetUrl};await writeStatus();return job;
 }catch(error){job.status='failed';job.error=String(error?.message||error).slice(0,1000);job.completed=new Date().toISOString();await writeStatus();throw error;}
 finally{await db.prepare("DELETE FROM records WHERE id=? AND owner=? AND entity='SheetsSyncLock' AND json_extract(data,'$.lease')=?").bind(lock,owner,lease).run();}
}
