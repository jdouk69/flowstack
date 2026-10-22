import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {PDFDocument} from 'pdf-lib';
import {akronFixture} from './akron-fixture.mjs';
import {documentAnalysis} from '../lib/extraction/route.mjs';
import {saveInvoiceDraft} from '../lib/invoice-save.mjs';
import {invoiceReview} from '../lib/invoice-review.mjs';
import {invoiceVersions} from '../lib/invoice-versions.mjs';
import {quantityReport} from '../lib/quantity-report.mjs';
import {productHistory} from '../lib/product-history.mjs';
import {buildAuditWorkbook} from '../lib/audit-workbook.mjs';
import {saveAndCheckInvoice} from '../lib/invoice-actions.mjs';
const require=createRequire(resolve('package.json'));const {Miniflare}=require(require.resolve('miniflare',{paths:[require.resolve('wrangler')]}));
const req=(path,body)=>new Request('https://test.local/api/flow/'+path,body?{method:'POST',body:JSON.stringify(body)}:{});
async function setup(pageCount=1,originalBytes=null){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-05-15',d1Databases:['DB'],r2Buckets:['BUCKET']});
 const db=await mf.getD1Database('DB'),bucket=await mf.getR2Bucket('BUCKET');
 for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+file,'utf8').split(/;|--> statement-breakpoint/).map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
 const pdf=await PDFDocument.create();for(let n=0;n<pageCount;n++)pdf.addPage();const bytes=originalBytes||await pdf.save();await bucket.put('test/original.pdf',bytes);
 await db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)').bind('source','test','Document',JSON.stringify({key:'test/original.pdf',file_type:'pdf',name:'test.pdf',size:bytes.length,pages:null}),'now','now').run();
 await db.prepare("INSERT INTO invoices(id,owner,source_document_id,analysis_status,audit_status,created,updated) VALUES('invoice','test','source','awaiting_analysis','not_started','now','now')").run();
 return {mf,db,bucket,owner:'test',id:'source',bytes};
}
async function body(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json();}
async function preview(f,page=akronFixture(),revision=0){return body(await documentAnalysis(req('document-analysis/source',{revision,template:'akron',pages:[page]}),f));}
async function draft(f){return (await body(await documentAnalysis(req('document-analysis/source?capture=1'),f))).draft;}
async function save(f,d,revision=0,extra={}){return body(await saveInvoiceDraft(req('invoices/invoice',{revision,...d.fields,...extra,line_items:d.line_items}),{...f,id:'invoice'}));}
async function review(f,action,revision,extra={}){return body(await invoiceReview(req('invoices/invoice/'+action,{revision,...extra}),{...f,id:'invoice',action}));}
test('unknown original page metadata is verified; save, audit, correction, approval, reports and reprocessing preserve data',async()=>{
 const f=await setup();try{
  await preview(f);const d=await draft(f);assert.equal(d.line_items.length,1);
  // Explicit synthetic test values, never added to production or real extraction.
  const fields={supplier_name:'TEST SUPPLIER',currency:'EUR',receiver_status:'shown'};
  let saved=await save(f,d,0,fields);const firstIds=(await f.db.prepare('SELECT id FROM invoice_line_items').all()).results.map(r=>r.id);
  let checked=await review(f,'audit',saved.invoice.revision);assert.equal(checked.invoice.audit_flag,'GREEN');
  const corrected={...d,fields:{...d.fields,receiver:'TEST CORRECTION'}};saved=await save(f,corrected,checked.invoice.revision,fields);
  checked=await review(f,'audit',saved.invoice.revision);const reviewed=await review(f,'review',checked.invoice.revision,{confirmed:true,note:'Synthetic test source reviewed.'});
  const approved=await review(f,'approve',reviewed.invoice.revision);assert.equal(approved.invoice.audit_status,'approved');
  const report=await body(await quantityReport(req('reports'),f));assert.equal(report.invoice_count,1);assert.equal(report.rows.length,1);assert.ok(report.rows.every(r=>r.source_document_id==='source'&&r.receiver==='TEST CORRECTION'));
  const before=await f.db.prepare('SELECT * FROM invoices').first();const beforeLines=(await f.db.prepare('SELECT * FROM invoice_line_items ORDER BY position').all()).results;
  await preview(f,akronFixture(),1);await draft(f);
  assert.deepEqual(await f.db.prepare('SELECT * FROM invoices').first(),before);assert.deepEqual((await f.db.prepare('SELECT * FROM invoice_line_items ORDER BY position').all()).results,beforeLines);
  assert.equal((await body(await quantityReport(req('reports'),f))).rows.length,1);
  await body(await saveInvoiceDraft(req('invoices/invoice',{revision:approved.invoice.revision,...d.fields,...fields,line_items:d.line_items}),{...f,id:'invoice'}),409);
  const versions=await body(await invoiceVersions(req('invoices/invoice/versions'),{...f,id:'invoice'}));assert.ok(versions.versions.some(v=>v.action==='capture'));assert.ok(versions.versions.some(v=>v.action==='approve'));assert.ok(firstIds.length===1);
  await body(await documentAnalysis(req('document-analysis/source?capture=1'),{...f,owner:'other'}),404);
 }finally{await f.mf.dispose();}
});
test('partial reading of an unknown two-page original is rejected; merged originals never transfer to purchases',async()=>{
 const f=await setup(2);try{await body(await documentAnalysis(req('document-analysis/source',{revision:0,template:'akron',pages:[akronFixture()]}),f),400);assert.equal(await f.db.prepare('SELECT * FROM document_analysis').first(),null);
 await f.db.prepare("UPDATE records SET data=json_set(data,'$.pages',1,'$.merged',json('true')) WHERE id='source'").run();await preview(f);await body(await documentAnalysis(req('document-analysis/source?capture=1'),f),409);
 }finally{await f.mf.dispose();}
});
test('missing supplier/currency stay unknown and block approval instead of guessing',async()=>{
 const f=await setup();try{await preview(f);const d=await draft(f);assert.equal(d.fields.supplier_name,null);assert.equal(d.fields.currency,null);const saved=await save(f,d);const checked=await review(f,'audit',saved.invoice.revision);assert.equal(checked.invoice.audit_flag,'YELLOW');await body(await invoiceReview(req('invoices/invoice/review',{revision:checked.invoice.revision,confirmed:true,note:'Test'}),{...f,id:'invoice',action:'review'}),409);assert.equal((await body(await quantityReport(req('reports'),f))).rows.length,0);
 }finally{await f.mf.dispose();}
});
if(process.env.FLOWSTACK_VERIFY_SOURCE)test('actual retained Akron original passes extraction transfer, draft persistence, discounted arithmetic and source-linked rows in an isolated database',async()=>{
 const row=JSON.parse(readFileSync(process.env.FLOWSTACK_VERIFY_SOURCE,'utf8')).find(r=>r.id==='e161c128-635a-4191-a1bd-6f6863ee48ac');assert.ok(row);const f=await setup(1,new Uint8Array(readFileSync(row.path)));
 try{await preview(f,row.pages[0]);const d=await draft(f);assert.equal(d.fields.invoice_number,'ΤΔΑΜ003392');assert.equal(d.line_items.length,2);assert.deepEqual(d.line_items.map(l=>l.line_amount),['743,93','218,34']);const saved=await save(f,d);const checked=await review(f,'audit',saved.invoice.revision);assert.ok(!JSON.parse(checked.invoice.audit_reasons).some(r=>r.code==='line_calculation'||r.code==='subtotal_mismatch'||r.code==='total_mismatch'));assert.equal(checked.invoice.audit_flag,'YELLOW');const report=await body(await quantityReport(req('reports?status=all'),f));assert.equal(report.rows.length,2);assert.ok(report.rows.every(r=>r.source_document_id==='source'));const purchases=await body(await productHistory(req('purchases?status=all'),f));assert.equal(purchases.groups.length,2);assert.equal(purchases.line_count,2);assert.deepEqual(purchases.groups.map(g=>g.product_code),['88.00250','88.00341']);assert.ok(purchases.groups.every(g=>g.rows.every(r=>r.source_document_id==='source'&&r.receiver==='ΓΙΑΝΝΗΣ')));assert.ok(purchases.groups.every(g=>g.findings.length===0&&g.kind==='unknown'));assert.equal((await body(await productHistory(req('purchases'),f))).line_count,0);assert.equal((await body(await quantityReport(req('reports'),f))).rows.length,0);await preview(f,row.pages[0],1);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM invoice_line_items').first()).n,2);const invoice=await f.db.prepare('SELECT * FROM invoices').first();assert.equal(invoice.revision,checked.invoice.revision);assert.equal(invoice.audit_flag,'YELLOW');
 }finally{await f.mf.dispose();}
});

if(process.env.FLOWSTACK_TOURNAS_SOURCE)test('retained Tournas source passes capture, five-row reporting, explained arithmetic review and correction-safe reprocessing',async()=>{
 const page=JSON.parse(readFileSync(process.env.FLOWSTACK_TOURNAS_SOURCE,'utf8'));
 // Isolate page 26 of the retained source in a test-only PDF. Never import the merged document as one invoice.
 const source=await PDFDocument.load(readFileSync(process.env.FLOWSTACK_TOURNAS_PDF));
 const original=await PDFDocument.create();const [selected]=await original.copyPages(source,[25]);original.addPage(selected);
 const f=await setup(1,await original.save());
 function documentAnalysisResponse(revision){return documentAnalysis(req('document-analysis/source',{revision,template:'tournas',pages:[page]}),f);}
 try{
  await body(await documentAnalysisResponse(0));const d=await draft(f);
  assert.equal(d.fields.invoice_number,'295');assert.equal(d.fields.account_information,'8891');
  assert.equal(d.fields.receiver,'ΜΠΟΥΖΟΥΝΙΕΡΑΚΗΣ');assert.equal(d.fields.currency,null);
  assert.equal(d.line_items.length,5);
  assert.deepEqual(d.line_items.map(l=>l.quantity),['80,00','200,00','50,00','500,00','10,00']);
  const outcome=await saveAndCheckInvoice(async(path,options)=>{
   const request=new Request('https://test.local'+path,options);
   return body(await (path.endsWith('/audit')?invoiceReview(request,{...f,id:'invoice',action:'audit'}):saveInvoiceDraft(request,{...f,id:'invoice'})));
  },'invoice',{revision:0,...d.fields,line_items:d.line_items});
  assert.equal(outcome.checkError,null);let saved=outcome.saved;const checked=outcome.checked;
  const reasons=JSON.parse(checked.invoice.audit_reasons);
  assert.ok(!reasons.some(r=>r.code==='subtotal_mismatch'||r.code==='total_mismatch'));
  assert.ok(reasons.some(r=>r.code==='printed_price_rounding'&&r.evidence[0].quantity==='200,00'&&r.evidence[0].unit_price==='0,28'&&r.evidence[0].line_amount==='56,40'));
  assert.equal(checked.invoice.audit_flag,'YELLOW');
  const report=await body(await quantityReport(req('reports?status=all'),f));
  assert.equal(report.rows.length,5);assert.equal(report.invoice_count,1);
  const purchases=await body(await productHistory(req('purchases?status=all'),f));
  assert.equal(purchases.groups.length,5);
  assert.ok(purchases.groups.filter(g=>g.name.includes('THRUTY')).every(g=>g.effective_category==='Formwork'));
  const disc=purchases.groups.find(g=>g.product_code==='08.19.193');
  assert.equal(disc.suggestion.kind,'consumable');assert.equal(disc.findings.length,0);
  assert.ok(purchases.groups.every(g=>g.rows.every(r=>r.source_document_id==='source'&&r.source_page===1)));
  const workbook=buildAuditWorkbook({...purchases,status:'all',invoice_count:1},{name:'ISOLATED TOURNAS TEST',filters:'status=all',origin:'https://test.local'});
  const detail=workbook.tabs.find(t=>t.title==='Line Item Audit').rows.slice(1);
  assert.equal(detail.length,5);assert.ok(detail.every(r=>r[9]==='YELLOW'&&r[10].includes('rounding')));
  assert.equal(workbook.tabs.find(t=>t.title==='Invoice Totals').rows.length,2);
  // An explicit draft correction survives a second preview read; it never gains approval automatically.
  saved=await save(f,{...d,fields:{...d.fields,receiver:'ISOLATED TEST CORRECTION'}},checked.invoice.revision);
  const before=await f.db.prepare('SELECT * FROM invoices').first();
  const beforeLines=(await f.db.prepare('SELECT * FROM invoice_line_items ORDER BY position').all()).results;
  await body(await documentAnalysisResponse(1));await draft(f);
  assert.deepEqual(await f.db.prepare('SELECT * FROM invoices').first(),before);
  assert.deepEqual((await f.db.prepare('SELECT * FROM invoice_line_items ORDER BY position').all()).results,beforeLines);
  assert.equal((await body(await quantityReport(req('reports?status=all'),f))).rows.length,5);
  assert.equal((await body(await quantityReport(req('reports'),f))).rows.length,0);
 }finally{await f.mf.dispose();}
});
