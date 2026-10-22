import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {validateInvoiceCapture} from '../lib/invoice-capture.mjs';
import {receiverLabel} from '../lib/invoice-evidence.mjs';
import {auditInvoice,AUDIT_RULE_VERSION} from '../lib/invoice-audit.mjs';
import {saveInvoiceDraft} from '../lib/invoice-save.mjs';
import {invoiceReview} from '../lib/invoice-review.mjs';
import {quantityReport} from '../lib/quantity-report.mjs';
import {productHistory,buildPurchaseHistory} from '../lib/product-history.mjs';
import {buildAuditWorkbook} from '../lib/audit-workbook.mjs';
import {parseTournasPage} from '../lib/extraction/suppliers/tournas.mjs';
const require=createRequire(resolve('package.json'));
const {Miniflare}=require(require.resolve('miniflare',{paths:[require.resolve('wrangler')]}));
// Explicit controlled fixtures. They are not the owner's three original PDFs.
const invoice={supplier_key:'tournas',supplier_name:'TEST SUPPLIER',account_information:'8891',invoice_number:'TEST-1',document_type:'TEST INVOICE',invoice_date:'2026-10-08',currency:'EUR',subtotal:'12.10',vat:'2.90',invoice_total:'15.00',receiver:null,receiver_status:'blank',deliverer:'TEST DELIVERER',vehicle_registration:'TEST VEHICLE',field_evidence:'TEST source page 1: labelled delivery and empty receiver box',printed_document_identifier:'TEST-A-1'};
const lines=[{position:1,printed_name:'TEST screws',description:'TEST screws',quantity:'100',unit:'piece',unit_price:'0.12',line_amount:'12.10'}];
const request=(body)=>new Request('https://test.local/api/flow/invoices/i',{method:'POST',body:JSON.stringify(body)});
test('confirmed blank receiver is distinct from unknown, unreadable and deliverer',()=>{
 const blank=validateInvoiceCapture({revision:0,...invoice,line_items:lines}).invoice;
 assert.equal(receiverLabel(blank),'No receiver shown');assert.equal(blank.receiver,null);assert.equal(blank.deliverer,'TEST DELIVERER');
 assert.equal(receiverLabel({receiver:null}),'Receiver not verified');
 assert.match(receiverLabel({receiver_status:'unreadable'}),/unreadable/);
 for(const status of ['blank','unreadable'])assert.throws(()=>validateInvoiceCapture({revision:0,...invoice,receiver_status:status,receiver:'DELIVERER MUST NOT BECOME RECEIVER',line_items:lines}),/Clear the receiver/);
 assert.throws(()=>validateInvoiceCapture({revision:0,...invoice,receiver_status:'shown',receiver:null,line_items:lines}),/exactly as printed/);
});
test('rounded displayed prices request clarification while larger source differences remain significant; printed amounts stay unchanged',()=>{
 const before=JSON.stringify(lines),rounded=auditInvoice(invoice,lines,[],[]);
 assert.equal(rounded.flag,'YELLOW');assert.equal(rounded.reasons[0].code,'printed_price_rounding');assert.equal(rounded.reasons[0].evidence[0].line_amount,'12.10');
 const changed=auditInvoice({...invoice,subtotal:'20',vat:'4.80',invoice_total:'24.80'},[{...lines[0],line_amount:'20'}],[],[]);
 assert.equal(changed.flag,'ORANGE');assert.ok(changed.reasons.some(r=>r.code==='line_calculation'));assert.equal(JSON.stringify(lines),before);
});
test('historical prices require the same supplier account, or explicit shared project for different suppliers',()=>{
 const current={...invoice,subtotal:'10',vat:'2.40',invoice_total:'12.40'},line={...lines[0],quantity:'1',unit_price:'10',line_amount:'10'};
 const old={...current,id:'prior',invoice_number:'TEST-0',invoice_date:'2026-10-01',audit_status:'approved'},previousLine={...line,invoice_id:'prior',unit_price:'9'};
 assert.ok(auditInvoice(current,[line],[old],[previousLine]).reasons.some(r=>r.code==='price_change'));
 for(const account of ['8655',null])assert.ok(!auditInvoice(current,[line],[{...old,account_information:account}],[previousLine]).reasons.some(r=>r.code==='price_change'));
 assert.ok(!auditInvoice(current,[line],[{...old,supplier_key:'akron'}],[previousLine]).reasons.some(r=>r.code==='cross_supplier'));
 assert.ok(auditInvoice({...current,project_information:'TEST SITE'},[line],[{...old,supplier_key:'akron',project_information:'TEST SITE'}],[previousLine]).reasons.some(r=>r.code==='cross_supplier'));
});
test('labelled Tournas roles and address do not fill receiver from deliverer or workflow',()=>{
 const page={page:1,width:595,height:842,fragments:[],text:'ΤΙΜΟΛΟΓΙΟ\t123\t8/10/2026\nΟ ΠΑΡΑΔΟΥΣ\t:\tTEST GIVER\nΔΙΕΥΘΥΝΣΗ\t:\tTEST SITE\tΑΡ.ΑΥΤΟΚΙΝΗΤΟΥ\t:\tTEST PLATE\n01.00.001\tTEST ITEM\tΤεμ.\t1,00\t1,00\t0\t1,00\t24'};
 const parsed=parseTournasPage(page);assert.equal(parsed.deliverer,'TEST GIVER');assert.equal(parsed.receiver,null);assert.equal(parsed.receiver_status,'unknown');assert.equal(parsed.account_number,null);assert.equal(parsed.project_information,'TEST SITE');assert.equal(parsed.vehicle_registration,'TEST PLATE');
});
test('purchase history separates account quantities, price comparisons and equipment repeats without changing product labels',async()=>{
 const rows=[{...invoice,...lines[0],id:'line-1',invoice_id:'invoice-1',audit_status:'approved',invoice_date:'2026-10-01'}, {...invoice,...lines[0],id:'line-2',invoice_id:'invoice-2',audit_status:'approved',account_information:'8655',unit_price:'0.20'}, {...invoice,...lines[0],id:'line-3',invoice_id:'invoice-3',audit_status:'approved',account_information:null}];
 const [initial]=await buildPurchaseHistory(rows);
 const [group]=await buildPurchaseHistory(rows,[{key:initial.key,kind:'reusable',category:'TEST Tools',note:'Existing owner label preserved',revision:4}]);
 assert.equal(group.note,'Existing owner label preserved');assert.equal(group.revision,4);assert.equal(group.buckets.length,3);assert.equal(group.findings.filter(f=>f.color==='ORANGE').length,0);assert.ok(!group.findings.some(f=>f.reason.includes('prices changed')));
});
test('role evidence persists through versions, exact account reports, CSV/workbook, older clients and safe approval',async()=>{
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-05-15',d1Databases:['DB'],r2Buckets:['BUCKET']});
 try{
 const db=await mf.getD1Database('DB'),owner='test-evidence';
 for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
 for(const id of ['i','other']){
 await db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)').bind('source-'+id,owner,'Document',JSON.stringify({pages:1,file_type:'pdf',name:'CONTROLLED TEST.pdf'}),'now','now').run();
 await db.prepare('INSERT INTO invoices(id,owner,source_document_id,created,updated) VALUES(?,?,?,?,?)').bind(id,owner,'source-'+id,'now','now').run();
 }
 const save=async(id,payload)=>{const r=await saveInvoiceDraft(request(payload),{db,owner,id});assert.equal(r.status,200,await r.clone().text());return (await r.json()).invoice;};
 let saved=await save('i',{revision:0,...invoice,line_items:lines});
 await save('other',{revision:0,...invoice,invoice_number:'TEST-OTHER',account_information:'8655',line_items:lines});
 const reportReq=new Request('https://test.local/reports?status=all&supplier=tournas&account=8891');
 const report=await(await quantityReport(reportReq,{db,owner})).json();assert.equal(report.rows.length,1);assert.equal(report.rows[0].deliverer,'TEST DELIVERER');assert.equal(report.rows[0].receiver_display,'No receiver shown');
 const products=await(await productHistory(reportReq,{db,owner})).json();assert.equal(products.line_count,1);
 const workbook=buildAuditWorkbook({...products,invoice_count:1},{name:'CONTROLLED TEST',origin:'https://test.local',filters:'account=8891'}),tab=workbook.tabs.find(t=>t.title==='Line Item Audit');
 assert.equal(tab.rows[1][tab.rows[0].indexOf('Deliverer (Ο ΠΑΡΑΔΟΥΣ)')],'TEST DELIVERER');assert.equal(tab.rows[1][2],'No receiver shown');
 const csv=await(await quantityReport(new Request(reportReq.url+'&format=csv'),{db,owner})).text();assert.match(csv,/receiver_status/);assert.match(csv,/TEST DELIVERER/);assert.ok(!csv.includes('TEST-OTHER'));
 // Omitted additive fields from an old client must not erase reviewed source evidence.
 const oldPayload={revision:saved.revision,...invoice,line_items:lines};for(const field of ['deliverer','receiver_status','vehicle_registration','field_evidence'])delete oldPayload[field];saved=await save('i',oldPayload);assert.equal(saved.deliverer,'TEST DELIVERER');assert.equal(saved.receiver_status,'blank');
 const action=async(action,extra={})=>{const current=await db.prepare('SELECT * FROM invoices WHERE id=?').bind('i').first();return invoiceReview(request({revision:current.revision,...extra}),{db,owner,id:'i',action});};
 assert.equal((await action('audit')).status,200);
 assert.equal((await action('review',{confirmed:true,note:'CONTROLLED TEST source checked; displayed price rounding reviewed.'})).status,200);
 await db.prepare('UPDATE invoices SET audit_rule_version=NULL WHERE id=?').bind('i').run();assert.equal((await action('approve')).status,409);
 assert.equal((await action('audit')).status,200);assert.equal((await action('review',{confirmed:true,note:'CONTROLLED TEST source rechecked.'})).status,200);assert.equal((await action('approve')).status,200);
 const approved=await db.prepare('SELECT * FROM invoices WHERE id=?').bind('i').first();assert.equal(approved.audit_rule_version,AUDIT_RULE_VERSION);
 assert.equal((await saveInvoiceDraft(request({revision:approved.revision,...invoice,line_items:lines}),{db,owner,id:'i'})).status,409);
 const version=(await db.prepare('SELECT data FROM invoice_versions WHERE invoice_id=? AND revision=?').bind('i',approved.revision).first()).data;assert.equal(JSON.parse(version).invoice.deliverer,'TEST DELIVERER');assert.equal(JSON.parse(version).invoice.receiver_status,'blank');
 }finally{await mf.dispose();}
});
