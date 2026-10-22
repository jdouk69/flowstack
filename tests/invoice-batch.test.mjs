import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {PDFDocument} from 'pdf-lib';
import {akronFixture} from './akron-fixture.mjs';
import {invoiceBatches} from '../lib/invoice-batch.mjs';
import {quantityReport} from '../lib/quantity-report.mjs';
const require=createRequire(resolve('package.json'));const {Miniflare}=require(require.resolve('miniflare',{paths:[require.resolve('wrangler')]}));
const req=body=>new Request('https://test.local/api/flow/invoice-batches',body?{method:'POST',body:JSON.stringify(body)}:{});
async function result(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json();}
async function setup(){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-05-15',d1Databases:['DB'],r2Buckets:['BUCKET']});const db=await mf.getD1Database('DB'),bucket=await mf.getR2Bucket('BUCKET');
 for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+file,'utf8').split(/;|--> statement-breakpoint/).map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
 const pdf=await PDFDocument.create();pdf.addPage();const bytes=await pdf.save();
 for(const id of ['one','two']){await bucket.put('test/'+id+'.pdf',bytes);await db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)').bind('source-'+id,'test','Document',JSON.stringify({key:'test/'+id+'.pdf',name:id+'.pdf',file_type:'pdf',size:bytes.length,pages:1}),'now','now').run();await db.prepare('INSERT INTO invoices(id,owner,source_document_id,analysis_status,audit_status,created,updated) VALUES(?,?,?,?,?,?,?)').bind(id,'test','source-'+id,'awaiting_analysis','not_started','now','now').run();}
 return {mf,db,bucket,owner:'test'};
}
const start=async(f,ids=['one','two'])=>(await result(await invoiceBatches(req({invoice_ids:ids,template:'akron',confirmed:true}),f))).batch;
const processItem=(batch,id,pages=[akronFixture()])=>req({id:batch.id,invoice_id:id,action:'process',pages});
test('batch persists individual successes and failures, protects captured corrections and never approves',async()=>{
 const f=await setup();try{
  const batch=await start(f);let success=await result(await invoiceBatches(processItem(batch,'one'),f));assert.equal(success.item.status,'saved');assert.equal(success.item.line_count,1);assert.equal(success.item.flag,'YELLOW');
  const failed=await result(await invoiceBatches(processItem(batch,'two',[{page:1,text:'',width:595,height:842,fragments:[]}]),f));assert.equal(failed.item.status,'failed');
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM invoice_line_items').first()).n,1);
  const history=await result(await invoiceBatches(req(),f));assert.deepEqual(history.batches[0].items.map(i=>i.status),['saved','failed']);
  await result(await invoiceBatches(processItem(batch,'two'),f));assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM invoice_line_items').first()).n,2);
  const beforeLines=(await f.db.prepare('SELECT * FROM invoice_line_items ORDER BY invoice_id,position').all()).results;
  await result(await invoiceBatches(processItem(batch,'one'),f));assert.deepEqual((await f.db.prepare('SELECT * FROM invoice_line_items ORDER BY invoice_id,position').all()).results,beforeLines);
  await f.db.prepare("UPDATE invoices SET receiver='OWNER CORRECTION',revision=revision+1 WHERE id='one'").run();const before=await f.db.prepare("SELECT * FROM invoices WHERE id='one'").first();
  const again=await start(f,['one']);success=await result(await invoiceBatches(processItem(again,'one'),f));assert.equal(success.item.status,'preserved');assert.deepEqual(await f.db.prepare("SELECT * FROM invoices WHERE id='one'").first(),before);
  assert.equal((await result(await quantityReport(new Request('https://test.local/?status=all'),f))).rows.length,2);
  assert.equal((await result(await quantityReport(new Request('https://test.local/'),f))).rows.length,0);
  assert.ok((await f.db.prepare('SELECT audit_status FROM invoices').all()).results.every(i=>i.audit_status==='needs_review'));
  assert.ok((await f.db.prepare('SELECT capture_method FROM invoices').all()).results.every(i=>i.capture_method==='extraction'));
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM records WHERE entity='Document'").first()).n,2);
 }finally{await f.mf.dispose();}
});

if(process.env.FLOWSTACK_TOURNAS_SOURCE)test('retained Tournas five-item source batch preserves printed values and durable evidence',async()=>{
 const f=await setup();try{
  const original=await PDFDocument.create(),source=await PDFDocument.load(readFileSync(process.env.FLOWSTACK_TOURNAS_PDF));const [page]=await original.copyPages(source,[25]);original.addPage(page);await f.bucket.put('test/one.pdf',await original.save());
  const batch=(await result(await invoiceBatches(req({invoice_ids:['one'],template:'tournas',confirmed:true}),f))).batch;
  const checked=await result(await invoiceBatches(processItem(batch,'one',[JSON.parse(readFileSync(process.env.FLOWSTACK_TOURNAS_SOURCE,'utf8'))]),f));
  assert.equal(checked.item.status,'saved');assert.equal(checked.item.line_count,5);assert.equal(checked.item.flag,'ORANGE');assert.equal(checked.item.preview_revision,1);
  const invoice=await f.db.prepare("SELECT * FROM invoices WHERE id='one'").first();assert.equal(invoice.invoice_number,'295');assert.equal(invoice.account_information,'8891');assert.equal(invoice.currency,null);assert.equal(invoice.receiver,'ΜΠΟΥΖΟΥΝΙΕΡΑΚΗΣ');assert.equal(invoice.capture_method,'extraction');
  const lines=(await f.db.prepare("SELECT * FROM invoice_line_items WHERE invoice_id='one' ORDER BY position").all()).results;assert.equal(lines.length,5);assert.deepEqual(lines.map(l=>l.quantity),['80,00','200,00','50,00','500,00','10,00']);assert.ok(lines.every(l=>l.source_page===1));
  await result(await invoiceBatches(processItem(batch,'one',[]),f));assert.deepEqual((await f.db.prepare("SELECT * FROM invoice_line_items WHERE invoice_id='one' ORDER BY position").all()).results,lines);
 }finally{await f.mf.dispose();}
});
test('batch validates selection, confirmation and owner; concurrent processing commits once',async()=>{
 const f=await setup();try{
  await result(await invoiceBatches(req({invoice_ids:['one'],template:'akron'}),f),400);
  await result(await invoiceBatches(req({invoice_ids:['one','one'],template:'akron',confirmed:true}),f),400);
  await result(await invoiceBatches(req({invoice_ids:['one'],template:'akron',confirmed:true}),{...f,owner:'other'}),404);
  const batch=await start(f,['one']);await result(await invoiceBatches(processItem(batch,'one'),{...f,owner:'other'}),404);
  const responses=await Promise.all([invoiceBatches(processItem(batch,'one'),f),invoiceBatches(processItem(batch,'one'),f)]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM invoice_line_items').first()).n,1);
  assert.equal((await result(await invoiceBatches(req(),{...f,owner:'other'}))).batches.length,0);
 }finally{await f.mf.dispose();}
});
test('saved rows survive failed checks; retry checks without recapturing, and read errors cannot overwrite success',async()=>{
 const f=await setup();try{
  const batch=await start(f,['one']);const failed=await result(await invoiceBatches(processItem(batch,'one'),{...f,review:async()=>Response.json({error:'Checks unavailable'},{status:503})}));
  assert.equal(failed.item.status,'saved_checks_failed');const before=(await f.db.prepare('SELECT * FROM invoice_line_items').all()).results;
  const retried=await result(await invoiceBatches(processItem(batch,'one',undefined),f));assert.equal(retried.item.status,'saved');assert.deepEqual((await f.db.prepare('SELECT * FROM invoice_line_items').all()).results,before);
  const late=await result(await invoiceBatches(req({id:batch.id,invoice_id:'one',action:'read_failed',reason:'Late network error'}),f));assert.equal(late.item.status,'saved');
 }finally{await f.mf.dispose();}
});

test('different item results persist independently and expired processing locks can resume',async()=>{
 const f=await setup();try{
  const batch=await start(f);const job=await f.db.prepare('SELECT data FROM records WHERE id=?').bind(batch.id).first();const data=JSON.parse(job.data);
  data.items[0]={...data.items[0],status:'processing',token:'expired-test-token',expires:'2000-01-01T00:00:00.000Z'};
  await f.db.prepare('UPDATE records SET data=? WHERE id=?').bind(JSON.stringify(data),batch.id).run();
  const responses=await Promise.all([invoiceBatches(processItem(batch,'one'),f),invoiceBatches(processItem(batch,'two'),f)]);assert.ok(responses.every(r=>r.status===200));
  const saved=(await result(await invoiceBatches(req(),f))).batches[0];assert.ok(saved.items.every(i=>['saved','saved_checks_failed'].includes(i.status)));assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM invoice_line_items').first()).n,2);
 }finally{await f.mf.dispose();}
});

test('100-invoice durable batch accepts every ID and processes the last item; 101 rejects without a partial job',async()=>{
 const f=await setup();try{
 const ids=['one','two'];const inserts=[];for(let n=2;n<100;n++){const id='bulk-'+String(n).padStart(3,'0');ids.push(id);inserts.push(f.db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)').bind('source-'+id,f.owner,'Document',JSON.stringify({key:'test/one.pdf',name:id+'.pdf',file_type:'pdf',pages:1}),'now','now'),f.db.prepare('INSERT INTO invoices(id,owner,source_document_id,analysis_status,audit_status,created,updated) VALUES(?,?,?,?,?,?,?)').bind(id,f.owner,'source-'+id,'awaiting_analysis','not_started','now','now'));}await f.db.batch(inserts);
 const batch=await start(f,ids);assert.equal(batch.items.length,100);assert.equal(batch.items.at(-1).invoice_id,ids.at(-1));const last=await result(await invoiceBatches(processItem(batch,ids.at(-1)),f));assert.equal(last.item.status,'saved');assert.equal(last.item.line_count,1);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM invoice_line_items').first()).n,1);assert.equal((await f.db.prepare("SELECT audit_status FROM invoices WHERE id=?").bind(ids.at(-1)).first()).audit_status,'needs_review');
 await result(await invoiceBatches(req({invoice_ids:[...ids,'overflow'],template:'akron',confirmed:true}),f),400);assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM records WHERE entity='InvoiceBatch'").first()).n,1);
 }finally{await f.mf.dispose();}
});
