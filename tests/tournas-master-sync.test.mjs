import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {auditInvoice} from '../lib/invoice-audit.mjs';
import {sheetsQuotaGate} from '../lib/sheets-quota.mjs';
import {syncTournasInvoice} from '../lib/tournas-master-sync.mjs';
import {seal,GOOGLE_SCOPES} from '../lib/google-connection.mjs';
const require=createRequire(resolve('package.json'));
const {Miniflare}=require(require.resolve('miniflare',{paths:[require.resolve('wrangler')]}));
const owner='sheet-test',key=Buffer.alloc(32,9).toString('base64'),id='1kWKSJBUTms912f1kZyGmNkpasVNDMX62Iz3HnqkYPCc';
const headers={
 'Line Item Audit':['Date','Invoice','Receiver (Ο ΠΑΡΑΛΑΒΩΝ)','Item','Quantity','Unit','Unit Price (pre-VAT)','Line Amount (pre-VAT)','Flag','Notes'],
 'Needs Attention':['Date','Invoice','Name(s) Printed','Item','Quantity','Unit','Unit Price (pre-VAT)','Line Amount (pre-VAT)','Flag','Notes'],
 'Paint & Consumables':['Date','Invoice','Name(s) Printed','Item','Quantity','Unit','Unit Price (pre-VAT)','Line Amount (pre-VAT)','Flag','Notes']
};
function googleFake({loseAppend=false,gridRows=1000}={}){
 const tabs=new Map(Object.entries(headers).map(([name,row])=>[name,[row]]));let lost=false;
 const fetcher=async(url,options={})=>{
  if(url.includes('spreadsheets/'+id+'?fields='))return Response.json({spreadsheetId:id,spreadsheetUrl:`https://docs.google.com/spreadsheets/d/${id}/edit`,sheets:[...tabs.keys()].map((title,index)=>({properties:{title,sheetId:index+1,gridProperties:{rowCount:gridRows,columnCount:10}}}))});
  if(url.includes(':batchUpdate')){for(const r of JSON.parse(options.body).requests){if(r.addSheet)tabs.set(r.addSheet.properties.title,[]);if(r.updateCells){const tab=[...tabs.keys()].find((x,i)=>i===tabs.size-1);tabs.get(tab).push(r.updateCells.rows[0].values.map(c=>c.userEnteredValue.stringValue));}}return Response.json({replies:[]});}
  if(url.includes('/values:batchGet?')){const ranges=new URL(url).searchParams.getAll('ranges');return Response.json({valueRanges:ranges.map(range=>{const title=range.match(/^'([^']+)'/)?.[1];return {range,values:tabs.get(title)||[]};})});}
  if(url.includes(':append?')){const match=decodeURIComponent(url).match(/values\/'?([^']+?)'?!A:[A-Z]+:append/);const tab=match?.[1]||decodeURIComponent(url).match(/values\/([^:]+):append/)?.[1]?.replace(/^'|'$/g,'');const data=JSON.parse(options.body);tabs.get(tab).push(...data.values);if(loseAppend&&!lost){lost=true;return Response.json({error:'lost response'},{status:503});}return Response.json({updates:{updatedRows:data.values.length}});}
  throw Error('Unexpected Sheets request: '+url);
 };
 return {fetcher,tabs};
}
async function setup(t){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-05-15',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 for(const sql of ['CREATE TABLE records(id TEXT PRIMARY KEY,owner TEXT,entity TEXT,data TEXT,created TEXT,updated TEXT)','CREATE TABLE invoices(id TEXT PRIMARY KEY,owner TEXT,source_document_id TEXT,supplier_key TEXT,supplier_name TEXT,invoice_date TEXT,invoice_number TEXT,currency TEXT,audit_flag TEXT,audit_reasons TEXT,audit_status TEXT,capture_method TEXT,created TEXT,revision INTEGER,document_type TEXT,invoice_series TEXT,printed_document_identifier TEXT,customer_information TEXT,account_information TEXT,project_information TEXT,subtotal_before_discount TEXT,invoice_discount_printed TEXT,subtotal TEXT,vat TEXT,invoice_total TEXT,receiver TEXT,receiver_status TEXT,deliverer TEXT,vehicle_registration TEXT,duplicate_of TEXT,field_evidence TEXT)','CREATE TABLE invoice_line_items(id TEXT PRIMARY KEY,owner TEXT,invoice_id TEXT,position INTEGER,printed_name TEXT,description TEXT,quantity TEXT,unit TEXT,unit_price TEXT,line_amount TEXT,product_code TEXT)'])await db.prepare(sql).run();
 const tokens={access_token:'fake-access',scope:GOOGLE_SCOPES.join(' '),expires:Date.now()+3600000};await db.prepare("INSERT INTO records(id,owner,entity,data,created,updated) VALUES(?,?,'GooglePrivate',?,?,?)").bind('google:tokens:'+owner,owner,await seal(tokens,key,owner+':tokens'),new Date().toISOString(),new Date().toISOString()).run();
 await db.prepare('INSERT INTO invoices(id,owner,source_document_id,supplier_key,supplier_name,invoice_date,invoice_number,currency,audit_flag,audit_reasons,audit_status,capture_method,created,revision,document_type,printed_document_identifier,customer_information,account_information,project_information,subtotal_before_discount,invoice_discount_printed,subtotal,vat,invoice_total,receiver,receiver_status,deliverer,vehicle_registration,field_evidence) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind('invoice5866',owner,'doc5866','tournas','TOURNAS', '2026-10-10','5866','EUR','YELLOW',JSON.stringify([{color:'YELLOW',code:'price_change',reason:'Printed unit price differs from a prior approved purchase.',evidence:[{position:1,invoice_number:'5000',invoice_date:'2026-09-01',unit_price:'1.20',current_unit_price:'1.50',unit:'pcs'}]}]),'needs_review','extraction','2026-10-10T12:00:00Z',3,'invoice','T-5866','Jim Doukakis','8891','Agia Marina','10.00','0.00','10.00','2.40','12.40',null,'blank',null,null,'Printed header and totals evidence').run();
 await db.prepare('INSERT INTO invoice_line_items(id,owner,invoice_id,position,printed_name,description,quantity,unit,unit_price,line_amount,product_code) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind('line5866',owner,'invoice5866',1,'ΒΙΔΑ ΣΚΥΡΟΔΕΜΑΤΟΣ','ΒΙΔΑ ΣΚΥΡΟΔΕΜΑΤΟΣ','2','pcs','1.50','3.00','C101').run();return {db};
}
test('Tournas master sync appends verified rows, preserves layout, and safely retries a lost response without duplicates',async t=>{
 const {db}=await setup(t),google=googleFake({loseAppend:true}),context={owner,db,invoiceId:'invoice5866',key,fetcher:google.fetcher,sheetOptions:{beforeRequest:async()=>{}}};
 await assert.rejects(syncTournasInvoice(context),/Google Sheets request failed/);
 assert.equal(google.tabs.get('Line Item Audit').length,2,'the remote append may have succeeded despite its lost response');
 const result=await syncTournasInvoice(context);assert.equal(result.status,'completed');assert.equal(result.verified.line_item_rows,0);assert.equal(result.verified.attention_rows,1);assert.equal(result.verified.invoice_register_rows,1);assert.equal(google.tabs.get('Line Item Audit').length,2);assert.equal(google.tabs.get('Needs Attention').length,2);assert.equal(google.tabs.get('Invoice Register').length,2);assert.equal(google.tabs.get('Invoice Register')[1][1],'5866');assert.equal(google.tabs.get('Invoice Register')[1][17],'12.40');assert.match(google.tabs.get('Invoice Register')[1][29],/ΒΙΔΑ ΣΚΥΡΟΔΕΜΑΤΟΣ/);assert.ok(google.tabs.get('Needs Attention')[1][9].includes('Printed unit price differs'));assert.ok(google.tabs.get('Needs Attention')[1][9].includes('invoice #5000'));
 const again=await syncTournasInvoice(context);assert.equal(again.skipped,true);assert.equal(google.tabs.get('Line Item Audit').length,2);assert.equal(google.tabs.get('Needs Attention').length,2);assert.equal(google.tabs.get('Invoice Register').length,2);
});
test('master sync reads and verifies the Google-created 10,001-row grid without duplicating a row',async t=>{
 const {db}=await setup(t),google=googleFake({gridRows:10001}),context={owner,db,invoiceId:'invoice5866',key,fetcher:google.fetcher,sheetOptions:{beforeRequest:async()=>{}}};
 const result=await syncTournasInvoice(context);
 assert.equal(result.status,'completed');assert.equal(result.verified.line_item_rows,1);assert.equal(result.verified.attention_rows,1);assert.equal(google.tabs.get('Line Item Audit').length,2);assert.equal(google.tabs.get('Needs Attention').length,2);
 const again=await syncTournasInvoice(context);assert.equal(again.skipped,true);assert.equal(google.tabs.get('Line Item Audit').length,2);assert.equal(google.tabs.get('Needs Attention').length,2);
});

test('historical comparisons refer to the current line and preserve the prior number/position',()=>{
 const invoice={id:'new',supplier_key:'tournas',invoice_date:'2026-10-10',invoice_number:'6000',account_information:'account',currency:'EUR',receiver_status:'blank'};
 const old={...invoice,id:'prior',audit_status:'approved',invoice_date:'2026-09-01',invoice_number:'5000'};
 const current={id:'new-line',position:2,printed_name:'ΒΙΔΑ',quantity:'2',unit:'pcs',unit_price:'1.50',line_amount:'3.00'};
 const prior={...current,id:'prior-line',invoice_id:'prior',position:7,unit_price:'1.20',line_amount:'2.40'};
 const reason=auditInvoice(invoice,[current],[old],[prior]).reasons.find(r=>r.code==='price_change');
 assert.equal(reason.evidence[0].position,2);assert.equal(reason.evidence[0].prior_position,7);assert.equal(reason.evidence[0].invoice_number,'5000');
});
test('sync preserves old Notes and saves findings/comparisons once in append-only evidence',async t=>{
 const {db}=await setup(t),google=googleFake({gridRows:10001});
 google.tabs.get('Line Item Audit').push(['2026-10-10','5866','Original receiver','Concrete screw / anchor','2','pcs','1.50','3.00','YELLOW','Original note']);
 const context={owner,db,invoiceId:'invoice5866',key,fetcher:google.fetcher,sheetOptions:{beforeRequest:async()=>{}}};
 const before=JSON.stringify(google.tabs.get('Line Item Audit'));
 const result=await syncTournasInvoice(context);
 assert.equal(result.status,'completed');assert.ok(google.tabs.get('Line Item Audit').some(r=>r[9]==='Original note'));
 const evidence=google.tabs.get('Audit Evidence');assert.equal(evidence.length,3);assert.match(evidence[1][8],/5000/);
 assert.equal(result.verified.invoice_line_rows,1);const size=evidence.length;
 await syncTournasInvoice(context);assert.equal(evidence.length,size);
 const notes=google.tabs.get('Needs Attention')[1][9];assert.match(notes,/prior unit price 1.20/);assert.match(notes,/current unit price 1.50/);
});
test('durable Sheets quota slots are spaced across requests and isolated by owner',async t=>{
 const {db}=await setup(t),waits=[],gate=sheetsQuotaGate(db,owner,{clock:()=>100000,sleep:async n=>waits.push(n)});
 await gate('GET');await gate('GET');await gate('GET');assert.deepEqual(waits,[1600,3200]);
 await gate('POST');assert.deepEqual(waits,[1600,3200]);
 const other=sheetsQuotaGate(db,'other',{clock:()=>100000,sleep:async()=>assert.fail('another owner must have an independent slot')});await other();
});

test('combined master keeps matching invoice numbers from different suppliers separate and retries without duplicates',async t=>{
 const {db}=await setup(t),google=googleFake();
 const vendor='akron-workflow';
 await db.prepare("INSERT INTO records VALUES(?,?,'Document',?,?,?)").bind('doc5866',owner,JSON.stringify({workflow:vendor}),'now','now').run();
 const base={owner,db,invoiceId:'invoice5866',key,fetcher:google.fetcher,sheetOptions:{beforeRequest:async()=>{}}};
 await syncTournasInvoice(base);
 const original=JSON.stringify(google.tabs.get('Line Item Audit'));
 await db.prepare("UPDATE invoices SET supplier_key='akron',supplier_name='Akron' WHERE id='invoice5866'").run();
 const {syncCombinedInvoice}=await import('../lib/combined-master.mjs');
 const context={...base,supplier:{id:vendor,name:'Akron'}};
 const result=await syncCombinedInvoice(context);
 assert.equal(result.verified.line_item_rows,1);
 assert.equal(JSON.stringify(google.tabs.get('Line Item Audit').slice(0,2)),original);
 assert.match(google.tabs.get('Line Item Audit')[2][9],/Supplier: Akron/);
 await syncCombinedInvoice(context);
 assert.equal(google.tabs.get('Line Item Audit').length,3);
});

test('overall master setup only reads the selected existing workbook',async()=>{
 const {ensureCombinedMaster}=await import('../lib/combined-master.mjs');let reads=0;
 const sheets={metadata:async actual=>{assert.equal(actual,id);reads++;return {spreadsheetId:id,sheets:Object.keys(headers).map(title=>({properties:{title}}))};},read:async actual=>{assert.equal(actual,id);reads++;return {valueRanges:Object.values(headers).map(row=>({values:[row]}))};}};
 const result=await ensureCombinedMaster({supplier:{id:'akron',name:'Akron'},sheets});
 assert.equal(result.scope,'overall');assert.equal(result.spreadsheet_id,id);assert.equal(reads,2);
 await assert.rejects(ensureCombinedMaster({supplier:{id:'akron'},sheets:{...sheets,metadata:async()=>({spreadsheetId:id,sheets:[]})}}),/tabs changed/);
});
