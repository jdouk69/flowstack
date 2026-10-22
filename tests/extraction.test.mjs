import test from 'node:test';
import assert from 'node:assert/strict';
import {textFromItems,readPdfPages} from '../lib/extraction/pdf-text.mjs';
import {validatePages,printedDecimal} from '../lib/extraction/suggestions.mjs';
import {analyzePages,parseTournasPage} from '../lib/extraction/suppliers/tournas.mjs';
const page={page:1,width:595,height:842,text:'ΤΙΜΟΛΟΓΙΟ\t123\t6/10/2026\nΚωδ.Πελάτη\t:\t8891\n01.02.003\tPrinted item\tkg\t2,00\t5,00\t0,00\t10,00\t24,00',fragments:[{text:'DELIVERER',x:50,y:113},{text:'RECEIVER',x:160,y:113},{text:'10,00',x:510,y:162},{text:'2,40',x:510,y:146},{text:'12,40',x:510,y:113}]};
test('retains printed line data and receiver role without inventing values',()=>{
 const d=parseTournasPage(page);assert.equal(d.account_number,'8891');assert.equal(d.receiver,'RECEIVER');assert.equal(d.invoice_total,'12,40');assert.equal(d.line_items[0].product_code,'01.02.003');assert.equal(d.line_items[0].quantity,'2,00');assert.equal(d.line_items[0].gross_line_amount,null);assert.equal(d.line_items[0].discount_basis,null);assert.equal(d.currency,null);assert.equal(d.customer_information,null);
 const missing=parseTournasPage({...page,text:page.text.replace('Κωδ.Πελάτη\t:\t8891\n',''),fragments:page.fragments.filter(f=>f.text!=='RECEIVER')});assert.equal(missing.account_number,null);assert.equal(missing.receiver,null);
});
test('ambiguous totals, changed layouts and incomplete rows require review',()=>{
 assert.equal(parseTournasPage({...page,fragments:[...page.fragments,{text:'15,00',x:520,y:113}]}).invoice_total,null);
 assert.equal(parseTournasPage({...page,width:800}).receiver,null);
 assert.equal(parseTournasPage({...page,text:page.text.replace('2,00','unreadable')}).line_items.length,0);
 assert.equal(analyzePages([{...page,text:'',fragments:[]}],'tournas').documents[0].document_type,'ocr_required');
 assert.equal(analyzePages([page],'generic').documents[0].line_items.length,0);
});
test('validates full ordered source pages and preserves decimal precision',()=>{
 assert.equal(printedDecimal('1.234,56'),'1234,56');assert.equal(printedDecimal('unknown'),null);
 assert.equal(validatePages({revision:0,template:'tournas',pages:[page]}).pages.length,1);
 assert.throws(()=>validatePages({revision:0,template:'tournas',pages:[{...page,page:2}]}));
 assert.throws(()=>validatePages({revision:0,template:'tournas',pages:[{...page,width:NaN}]}));
});
test('sorts text columns and rows by actual PDF coordinates',()=>{
 const item=(str,x,y)=>({str,transform:[1,0,0,1,x,y]});assert.equal(textFromItems([item('right',50,80),item('bottom',10,10),item('left',10,80)]),'left\tright\nbottom');
});
test('page limits and extraction errors destroy reader with no partial success',async()=>{
 let destroyed=0;const pdfjs={getDocument:()=>({promise:Promise.resolve({numPages:101}),destroy:async()=>{destroyed++;}})};
 await assert.rejects(readPdfPages(new Uint8Array(),pdfjs),/100 pages/);assert.equal(destroyed,1);
 const bad={getDocument:()=>({promise:Promise.reject(Error('Damaged PDF')),destroy:async()=>{destroyed++;}})};await assert.rejects(readPdfPages(new Uint8Array(),bad),/Damaged/);assert.equal(destroyed,2);
 const signal=AbortSignal.abort();await assert.rejects(readPdfPages(new Uint8Array(),pdfjs,{signal}),{name:'AbortError'});
});

test('Ergobeton SoftOne invoice extracts printed header, all rows and totals without inventing currency or receiver',async()=>{
 const {parseErgobetonPage}=await import('../lib/extraction/suppliers/ergobeton.mjs');
 const text=[
  'Τιμολόγιο\tA_ΤΙΜ\t4037\t7/8/2026\t14:44',
  'ΚΩΔ. ΠΕΛ.\t01.2916',
  'ΠΕΛΑΤΗΣ\tDOUKAKIS JIM PETER PANAGIOTIS',
  '12.13.061\tSika Viscocrete Techno-10 Bulk\tkg\t40\t2,10\t84,00\t0,00\t84\t24',
  '21.15.302\tC25/30 ΣΚΥΡΟΔΕΜΑ\tΜ3\t36\t101,64\t3659,04\t0,00\t3659,04\t24',
  '73.01.000\tΑΝΤΛΗΣΗ ΣΚΥΡΟΔΕΜΑΤΟΣ\tΜ3\t36\t4,36\t156,96\t0,00\t156,96\t24',
  'ΚΑΘΑΡΗ ΑΞΙΑ\t3900,00','Φ.Π.Α\t936,00','ΠΛΗΡΩΤΕΟ ΠΟΣΟ\t4836,00'
 ].join('\n');
 const actual=parseErgobetonPage({page:1,width:595.5,height:842.25,text,fragments:[]});
 assert.equal(actual.document_type,'invoice');assert.equal(actual.invoice_number,'4037');assert.equal(actual.invoice_series,'A_ΤΙΜ');assert.equal(actual.invoice_date,'2026-08-07');assert.equal(actual.account_number,'01.2916');assert.equal(actual.supplier_classification,'ergobeton');assert.equal(actual.supplier_name,null);assert.equal(actual.receiver,null);assert.equal(actual.currency,null);
 assert.equal(actual.line_items.length,3);assert.equal(actual.line_items[0].product_code,'12.13.061');assert.equal(actual.line_items[0].quantity,'40');assert.equal(actual.line_items[0].unit_price,'2,10');assert.equal(actual.line_items[0].line_amount,'84');assert.equal(actual.line_items[0].discount_printed,'0,00');assert.equal(actual.line_items[0].vat_rate,'24');assert.equal(actual.subtotal,'3900,00');assert.equal(actual.vat,'936,00');assert.equal(actual.invoice_total,'4836,00');
 const {extractionCaptureDraft}=await import('../lib/extraction/capture-draft.mjs');const draft=extractionCaptureDraft({pages:1},{pages:JSON.stringify([{page:1,width:595.5,height:842.25,text,fragments:[]}]),analysis:JSON.stringify({template:'ergobeton'}),revision:4});
 assert.equal(draft.fields.supplier_key,'ergobeton');assert.equal(draft.fields.invoice_series,'A_ΤΙΜ');assert.equal(draft.fields.printed_document_identifier,'A_ΤΙΜ 4037');assert.equal(draft.line_items.length,3);
});

test('Ergobeton parser rejects ambiguous header and incomplete table rows instead of creating partial suggestions',async()=>{
 const {parseErgobetonPage}=await import('../lib/extraction/suppliers/ergobeton.mjs');const base={page:1,width:595.5,height:842.25,fragments:[],text:'Τιμολόγιο\tA_ΤΙΜ\t4037\t7/8/2026\t14:44\n12.13.061\tItem\tkg\t1\t2,00\t2,00\t0,00\t2,00\t24\nΚΑΘΑΡΗ ΑΞΙΑ\t2,00\nΦ.Π.Α\t0,48\nΠΛΗΡΩΤΕΟ ΠΟΣΟ\t2,48'};
 assert.equal(parseErgobetonPage({...base,text:base.text+'\nΤιμολόγιο\tA_ΤΙΜ\t4038\t8/8/2026\t14:44'}).document_type,'unsupported');
 const incomplete=parseErgobetonPage({...base,text:base.text.replace('2,00\t0,00\t2,00\t24','x\t2,00\t24')});assert.equal(incomplete.line_items.length,0);assert.ok(incomplete.warnings.some(x=>x.startsWith('Unparsed item row:')));
});


test('automatic audit routes Ergobeton GPT invoices through the SoftOne parser into reviewable invoice drafts',async()=>{
 const {supplierTemplate,validateAutomaticPages}=await import('../lib/automation-runner.mjs');assert.equal(supplierTemplate('Ergobeton GPT'),'ergobeton');
 const page={page:1,width:595.5,height:842.25,fragments:[],text:'Τιμολόγιο\tA_ΤΙΜ\t4037\t7/8/2026\t14:44\n12.13.061\tItem\tkg\t1\t2,00\t2,00\t0,00\t2,00\t24\nΚΑΘΑΡΗ ΑΞΙΑ\t2,00\nΦ.Π.Α\t0,48\nΠΛΗΡΩΤΕΟ ΠΟΣΟ\t2,48'};
 const draft=validateAutomaticPages([page],'ergobeton');assert.equal(draft.fields.supplier_key,'ergobeton');assert.equal(draft.fields.invoice_number,'4037');assert.equal(draft.line_items.length,1);
});
