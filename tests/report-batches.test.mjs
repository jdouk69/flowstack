import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {quantityReport} from '../lib/quantity-report.mjs';
import {productHistory} from '../lib/product-history.mjs';
import {reportBatchIds,combinedReportUrl} from '../lib/report-batches.mjs';
const require=createRequire(resolve('package.json'));const {Miniflare}=require(require.resolve('miniflare',{paths:[require.resolve('wrangler')]}));
test('combined report validates and carries all batch IDs',()=>{assert.deepEqual(reportBatchIds(new URL('https://test'+combinedReportUrl(['batch-a','batch-b'])).searchParams),['batch-a','batch-b']);assert.throws(()=>reportBatchIds(new URLSearchParams('batches=a,a')));assert.throws(()=>reportBatchIds(new URLSearchParams('batches=bad%27')));assert.throws(()=>reportBatchIds(new URLSearchParams({batches:Array.from({length:11},(_,n)=>'b'+n).join(',')})));});
test('batch report includes failures with no rows, deduplicates overlaps, excludes other owners and keeps workbook product scope',async()=>{
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-05-15',d1Databases:['DB']});
 try{const db=await mf.getD1Database('DB');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+f,'utf8').split(/;|--> statement-breakpoint/).map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
 for(const [id,owner] of [['one','jim'],['two','jim'],['failed','jim'],['outside','jim'],['other','other']]){
 await db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)').bind('source-'+id,owner,'Document',JSON.stringify({name:id+'.pdf'}),'now','now').run();
 await db.prepare('INSERT INTO invoices(id,owner,source_document_id,analysis_status,audit_status,created,updated) VALUES(?,?,?,?,?,?,?)').bind(id,owner,'source-'+id,'analyzed','needs_review','now','now').run();
 if(id!=='failed')await db.prepare('INSERT INTO invoice_line_items(id,owner,invoice_id,position,description,quantity,unit) VALUES(?,?,?,?,?,?,?)').bind('line-'+id,owner,id,0,'Paint','2','L').run();
 }
 const item=(id,status)=>({invoice_id:id,source_document_id:'source-'+id,name:id+'.pdf',status,reason:status==='failed'?'Unreadable source':null});
 for(const [id,owner,items] of [['batch-a','jim',[item('one','saved'),item('failed','failed')]],['batch-b','jim',[item('one','saved'),item('two','saved')]],['batch-other','other',[item('other','saved')]]])await db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)').bind(id,owner,'InvoiceBatch',JSON.stringify({items}),'now','now').run();
 const req=new Request('https://test.local'+combinedReportUrl(['batch-a','batch-b']));const report=await(await quantityReport(req,{db,owner:'jim'})).json();assert.deepEqual(report.rows.map(r=>r.invoice_id),['one','two']);assert.equal(report.processing.length,3);assert.equal(report.processing.find(i=>i.status==='failed').reason,'Unreadable source');assert.equal(report.invoice_count,2);
 const products=await(await productHistory(req,{db,owner:'jim'})).json();assert.equal(products.line_count,2);
 const csv=await(await quantityReport(new Request(req.url+'&format=csv'),{db,owner:'jim'})).text();assert.ok(!csv.includes('line-outside'));assert.ok(!csv.includes('line-other'));
 assert.equal((await quantityReport(new Request('https://test.local'+combinedReportUrl(['batch-other'])),{db,owner:'jim'})).status,404);
 }finally{await mf.dispose();}
});
