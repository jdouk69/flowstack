import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {PDFDocument} from 'pdf-lib';
import {documentAnalysis} from '../lib/extraction/route.mjs';
import {ocrPage,OCR_ENGINE,withOcrCancellation,createBrowserOcr} from '../lib/extraction/ocr.mjs';
import {readPdfPages} from '../lib/extraction/pdf-text.mjs';
import {validatePages} from '../lib/extraction/suggestions.mjs';
import {analyzePages} from '../lib/extraction/suppliers/tournas.mjs';
import {extractionCaptureDraft} from '../lib/extraction/capture-draft.mjs';
const data={text:'Unverified invoice 539',confidence:54,blocks:[{paragraphs:[{lines:[{words:[{text:'539',bbox:{x0:100,y0:200,x1:150,y1:220}}]}]}]}]};
test('saved OCR preview preserves history and captured corrections while automatic capture stays blocked',async()=>{
 const require=createRequire(resolve('package.json')),{Miniflare}=require(require.resolve('miniflare',{paths:[require.resolve('wrangler')]}));
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-05-15',d1Databases:['DB'],r2Buckets:['BUCKET']});
 try{
  const db=await mf.getD1Database('DB'),bucket=await mf.getR2Bucket('BUCKET');for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+file,'utf8').split(/;|--> statement-breakpoint/).map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
  const pdf=await PDFDocument.create();pdf.addPage();await bucket.put('owner/source.pdf',await pdf.save());
  await db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)').bind('source','owner','Document',JSON.stringify({name:'scan.pdf',key:'owner/source.pdf',file_type:'pdf',pages:1}),'now','now').run();
  await db.prepare('INSERT INTO invoices(id,owner,source_document_id,receiver,revision,capture_method,created,updated) VALUES(?,?,?,?,?,?,?,?)').bind('invoice','owner','source','OWNER CORRECTION',2,'manual','now','now').run();
  const context={db,bucket,owner:'owner',id:'source'},page=ocrPage(data,{page:1,width:595,height:842,pixelWidth:1190,pixelHeight:1684});
  for(const revision of [0,1]){const r=await documentAnalysis(new Request('https://test.local/',{method:'POST',body:JSON.stringify({revision,template:'generic',pages:[page]})}),context);assert.equal(r.status,200);const saved=await r.json();assert.equal(saved.result.pages[0].extraction_method,'ocr');assert.equal(saved.result.revision,revision+1);}
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM document_analysis_versions').first()).n,2);
  assert.equal((await db.prepare('SELECT receiver FROM invoices').first()).receiver,'OWNER CORRECTION');
  const capture=await documentAnalysis(new Request('https://test.local/?capture=1'),context);assert.equal(capture.status,409);assert.match((await capture.json()).error,/preview only/);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM invoice_line_items').first()).n,0);
 }finally{await mf.dispose();}
});
test('OCR provenance and positioned evidence survive saving; OCR cannot silently enter invoice capture',()=>{
 const page=ocrPage(data,{page:1,width:595,height:842,pixelWidth:1190,pixelHeight:1684});assert.ok(Math.abs(page.fragments[0].x-50)<1e-8);assert.equal(page.fragments[0].y,732);assert.equal(page.ocr_engine,OCR_ENGINE);
 const validated=validatePages({revision:0,template:'tournas',pages:[page]});assert.equal(validated.pages[0].ocr_confidence,54);assert.equal(validated.pages[0].extraction_method,'ocr');
 const analysis=analyzePages(validated.pages,'tournas');assert.equal(analysis.documents[0].document_type,'ocr_preview');assert.equal(analysis.documents[0].line_items.length,0);
 assert.throws(()=>extractionCaptureDraft({pages:1},{pages:JSON.stringify(validated.pages),analysis:JSON.stringify(analysis)}),/preview only/);
 assert.throws(()=>validatePages({revision:0,template:'generic',pages:[{...page,extraction_method:'approved'}]}),/method/);
 assert.equal(validatePages({revision:0,template:'generic',pages:[{...page,ocr_confidence:500}]}).pages[0].ocr_confidence,null);
});
test('OCR cancellation does not wait for a hung recognition promise',async()=>{
 await assert.rejects(createBrowserOcr({signal:AbortSignal.abort()}),{name:'AbortError'});
 const controller=new AbortController(),job=withOcrCancellation(new Promise(()=>{}),controller.signal);controller.abort();await assert.rejects(job,{name:'AbortError'});
 assert.equal(await withOcrCancellation(Promise.resolve('done')), 'done');
});
test('mixed PDFs preserve selectable text, scan failure and page limits never return partial previews',async()=>{
 let destroyed=0,calls=0;
 const fake=count=>({getDocument:()=>({promise:Promise.resolve({numPages:count,getPage:async n=>({getTextContent:async()=>({items:n===1?[{str:'Printed text',transform:[1,0,0,1,10,100]}]:[]}),getViewport:()=>({width:595,height:842}),cleanup(){}})}),destroy:async()=>{destroyed++;}})});
 const recognizeScan=async(_,metadata)=>{calls++;return ocrPage(data,{...metadata,pixelWidth:1190,pixelHeight:1684});};
 const pages=await readPdfPages(new Uint8Array(),fake(2),{recognizeScan});assert.equal(calls,1);assert.equal(pages[0].text,'Printed text');assert.equal(pages[0].extraction_method,undefined);assert.equal(pages[1].extraction_method,'ocr');
 await assert.rejects(readPdfPages(new Uint8Array(),fake(7),{recognizeScan}),/5 scanned pages/);
 await assert.rejects(readPdfPages(new Uint8Array(),fake(2),{recognizeScan:async()=>{throw Error('OCR failed');}}),/OCR failed/);assert.equal(destroyed,3);
});
if(process.env.FLOWSTACK_OCR_RESULT)test('actual Ergobeton recognition retains uncertain text and never fabricates structured purchase rows',()=>{
 const actual=JSON.parse(readFileSync(process.env.FLOWSTACK_OCR_RESULT,'utf8'));assert.ok(actual.text.includes('Sika Viscocrete Techno-10 Bulk'));assert.ok(actual.text.includes('5.656,88')); // Header fields were missed: retain OCR uncertainty, never prefill them.

 const page=ocrPage(actual,{page:1,width:595,height:842,pixelWidth:1556,pixelHeight:2200}),validated=validatePages({revision:0,template:'generic',pages:[page]});assert.equal(validated.pages[0].text,actual.text);assert.ok(page.fragments.length);assert.equal(analyzePages(validated.pages).documents[0].line_items.length,0);
});
