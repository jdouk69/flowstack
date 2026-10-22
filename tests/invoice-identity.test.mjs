import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {readFileSync,readdirSync} from 'node:fs';
import {invoiceIdentity,auditInvoice,sameInvoice,matchingInvoices} from '../lib/invoice-audit.mjs';
import {saveInvoiceDraft} from '../lib/invoice-save.mjs';
import {invoiceReview} from '../lib/invoice-review.mjs';
import {quantityReport} from '../lib/quantity-report.mjs';
import {buildAuditWorkbook} from '../lib/audit-workbook.mjs';
import {buildPurchaseHistory} from '../lib/product-history.mjs';
const invoice={supplier_key:'tournas',supplier_name:'TEST ONLY',receiver_status:'blank',account_information:'8891',invoice_number:'1457',document_type:'Materials invoice',invoice_series:'Α-ΤΔΑ',currency:'EUR',invoice_date:'2026-10-08',subtotal:'10',vat:'2.40',invoice_total:'12.40'};
const lines=[{position:1,description:'TEST ONLY',quantity:'1',unit:'piece',unit_price:'10',line_amount:'10'}];
test('supplier, type and series isolate matching numbers without dropping punctuation or zeros',()=>{
 const key=invoiceIdentity(invoice);
 for(const change of [{supplier_key:'akron'},{document_type:'Service invoice'},{invoice_series:'Β-ΤΔΑ'},{invoice_number:'01457'}]){
  const other={...invoice,...change,id:'other',audit_status:'needs_review'};
  assert.notEqual(invoiceIdentity(other),key);assert.equal(sameInvoice(invoice,other),false);
  assert.equal(auditInvoice({...invoice,id:'current'},lines,[other],[]).duplicate_of,null);
 }
 assert.equal(sameInvoice(invoice,{...invoice,invoice_number:' 1457 ',invoice_series:'α-τδα'}),true);
 const unknown={...invoice,id:'unknown',document_type:null};assert.equal(sameInvoice(invoice,unknown),false);
 assert.ok(auditInvoice({...invoice,id:'current'},lines,[unknown],[]).reasons.some(r=>r.code==='uncertain_identity'));
});
test('legacy approved keys remain untouched, but dynamic checks catch their duplicate and approvals for different types succeed',async()=>{
 const require=createRequire(resolve('package.json'));const {Miniflare}=require(require.resolve('miniflare',{paths:[require.resolve('wrangler')]}));
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-05-15',d1Databases:['DB']});
 try{
  const db=await mf.getD1Database('DB'),owner='test';
  for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint'))await db.prepare(sql).run();
  const request=body=>new Request('https://test.local',{method:'POST',body:JSON.stringify(body)});
  const get=id=>db.prepare('SELECT * FROM invoices WHERE id=? AND owner=?').bind(id,owner).first();
  const checked=async r=>{const b=await r.json();assert.equal(r.status,200,JSON.stringify(b));return b.invoice;};
  const save=async(id,fields={})=>{
   await db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)').bind('source-'+id,owner,'Document',JSON.stringify({pages:1}),'now','now').run();
   await db.prepare("INSERT INTO invoices(id,owner,source_document_id,created,updated) VALUES(?,?,?,'now','now')").bind(id,owner,'source-'+id).run();
   return checked(await saveInvoiceDraft(request({...invoice,...fields,printed_document_identifier:'Α-ΤΔΑ01457',line_items:lines,revision:0}),{db,owner,id}));
  };
  const action=async(id,command,extra={})=>invoiceReview(request({revision:(await get(id)).revision,...extra}),{db,owner,id,action:command});
  const approve=async id=>{await checked(await action(id,'audit'));await checked(await action(id,'review',{confirmed:true,note:'Synthetic isolated source reviewed.'}));return checked(await action(id,'approve'));};
  await save('legacy');await approve('legacy');
  await db.prepare('UPDATE invoices SET identity_key=? WHERE id=?').bind(JSON.stringify(['classified:tournas','1457']),'legacy').run();
  const historical=await get('legacy');
  const report=await (await quantityReport(new Request('https://test.local/reports'),{db,owner})).json();
  assert.equal(report.rows[0].invoice_series,'Α-ΤΔΑ');assert.equal(report.rows[0].printed_document_identifier,'Α-ΤΔΑ01457');
  const workbook=buildAuditWorkbook({...report,groups:await buildPurchaseHistory(report.rows)},{name:'TEST ONLY',origin:'https://test.local',filters:''});
  const tab=workbook.tabs.find(t=>t.title==='Line Item Audit');
  assert.equal(tab.rows[1][tab.rows[0].indexOf('Invoice series (printed)')],'Α-ΤΔΑ');
  assert.equal(tab.rows[1][tab.rows[0].indexOf('Document identifier (printed)')],'Α-ΤΔΑ01457');
  await save('different-type',{document_type:'Service invoice'});await approve('different-type');
  await save('different-series',{invoice_series:'Β-ΤΔΑ'});await approve('different-series');
  const copy=await save('copy');assert.equal((await matchingInvoices(db,owner,copy))[0].id,'legacy');
  const audited=await checked(await action('copy','audit'));assert.equal(audited.duplicate_of,'legacy');assert.equal((await action('copy','review',{confirmed:true,note:'Not sufficient to ignore duplicate'})).status,409);
  await checked(await action('copy','exclude',{duplicate_of:'legacy',note:'Retain the original; both documents preserved.'}));
  assert.deepEqual(await get('legacy'),historical);
  await save('missing-type',{document_type:null});await checked(await action('missing-type','audit'));
  assert.equal((await action('missing-type','exclude',{duplicate_of:'legacy',note:'Cannot assume unknown type'})).status,400);
  assert.equal((await action('missing-type','review',{confirmed:true,note:'Type missing'})).status,409);
  // A pre-v2 reviewed state must be re-audited before approval, not automatically upgraded.
  await save('stale',{invoice_number:'9999'});await checked(await action('stale','audit'));await checked(await action('stale','review',{confirmed:true}));
  await db.prepare('UPDATE invoices SET identity_key=? WHERE id=?').bind(JSON.stringify(['classified:tournas','9999']),'stale').run();
  assert.equal((await action('stale','approve')).status,409);
  assert.equal((await matchingInvoices(db,'other-owner',copy)).length,0);
 }finally{await mf.dispose();}
});
