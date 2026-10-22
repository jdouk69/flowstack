import test from 'node:test';
import assert from 'node:assert/strict';
import {extractionCaptureDraft} from '../lib/extraction/capture-draft.mjs';
import {validateInvoiceCapture} from '../lib/invoice-capture.mjs';
const page={page:1,width:595,height:842,text:'ΤΙΜΟΛΟΓΙΟ\t123\t6/10/2026\nΚωδ.Πελάτη\t:\t8891\n01.02.003\tPrinted item\tkg\t2,00\t5,00\t0,00\t10,00\t24,00',fragments:[{text:'DELIVERER',x:50,y:113},{text:'RECEIVER',x:160,y:113},{text:'ΤΟΥΡΝΑΣ Α.Ε.',x:170,y:810},{text:'10,00',x:510,y:162},{text:'2,40',x:510,y:146},{text:'12,40',x:510,y:113},{text:'€',x:500,y:100}]};
const saved=(pages=[page],template='tournas')=>({pages:JSON.stringify(pages),analysis:JSON.stringify({template,documents:[{receiver:'FORGED'}]}),revision:3});
test('read-only bridge recomputes source suggestions and preserves complete structured printed fields',()=>{
 const source={pages:1};const snapshot=saved();const draft=extractionCaptureDraft(source,snapshot);
 assert.equal(draft.fields.receiver,'RECEIVER');assert.equal(draft.fields.supplier_name,'ΤΟΥΡΝΑΣ Α.Ε.');assert.equal(draft.fields.currency,'€');assert.equal(draft.fields.account_information,'8891');assert.equal(draft.line_items[0].product_code,'01.02.003');assert.equal(draft.line_items[0].gross_line_amount,null);assert.equal(draft.line_items[0].discount_basis,null);assert.match(draft.line_items[0].printed_evidence,/Printed item/);assert.equal(draft.preview_revision,3);
 const capture=validateInvoiceCapture({revision:0,...draft.fields,line_items:draft.line_items});assert.equal(capture.lines[0].vat_rate,'24,00');assert.equal(capture.invoice.receiver,'RECEIVER');assert.equal(capture.lines[0].source_page,1);assert.equal(JSON.parse(snapshot.analysis).documents[0].receiver,'FORGED');
});
test('multi-page, OCR, generic, statements and incomplete rows cannot become partial invoice suggestions',()=>{
 for(const [source,snapshot] of [[{pages:2},saved([page,{...page,page:2}])],[{pages:1},null],[{pages:1},saved([page],'generic')],[{pages:1},saved([{...page,text:''}])],[{pages:1},saved([{...page,text:'ΚΑΡΤΕΛΕΣ ΠΕΛΑΤΩΝ'}])],[{pages:1},saved([{...page,text:page.text+'\n01.02.004\tUnreadable item\tkg\tx\t5,00\t0,00\t10,00\t24,00'}])]])assert.throws(()=>extractionCaptureDraft(source,snapshot));
});
test('extended capture retains decimals, rejects invalid evidence/page/origin and leaves absent values unknown',()=>{
 const body={revision:0,receiver:'Receiver as printed',source_page:'1',line_items:[{description:'item',product_code:'001',discount_printed:'3,00',vat_rate:'24,00',vat_amount:'1,23',gross_line_amount:'6,78',source_page:'1',value_origin:'mixed'}]};
 const result=validateInvoiceCapture(body);assert.equal(result.lines[0].discount_printed,'3,00');assert.equal(result.lines[0].printed_evidence,null);assert.equal(result.lines[0].value_origin,'mixed');assert.equal(result.invoice.source_page,1);
 for(const change of [{source_page:0},{source_page:1.1},{value_origin:'guessed'},{vat_rate:'unknown'}])assert.throws(()=>validateInvoiceCapture({...body,line_items:[{...body.line_items[0],...change}]}));
});


test('Ergobeton SoftOne extraction produces an unapproved review draft with printed series preserved',()=>{
 const page={page:1,width:595.5,height:842.25,text:'Τιμολόγιο\tA_ΤΙΜ\t4037\t7/8/2026\t14:44\nΚΩΔ. ΠΕΛ.\t01.2916\nΠΕΛΑΤΗΣ\tDOUKAKIS JIM PETER PANAGIOTIS\n12.13.061\tSika Viscocrete Techno-10 Bulk\tkg\t40\t2,10\t84,00\t0,00\t84\t24\n21.15.302\tC25/30 ΣΚΥΡΟΔΕΜΑ\tΜ3\t36\t101,64\t3659,04\t0,00\t3659,04\t24\n73.01.000\tΑΝΤΛΗΣΗ ΣΚΥΡΟΔΕΜΑΤΟΣ\tΜ3\t36\t4,36\t156,96\t0,00\t156,96\t24\nΚΑΘΑΡΗ ΑΞΙΑ\t3900,00\nΦ.Π.Α\t936,00\nΠΛΗΡΩΤΕΟ ΠΟΣΟ\t4836,00',fragments:[]};
 const draft=extractionCaptureDraft({pages:1},saved([page],'ergobeton'));const checked=validateInvoiceCapture({revision:0,...draft.fields,line_items:draft.line_items});
 assert.equal(checked.invoice.supplier_key,'ergobeton');assert.equal(checked.invoice.invoice_series,'A_ΤΙΜ');assert.equal(checked.invoice.invoice_total,'4836,00');assert.equal(checked.lines.length,3);assert.equal(checked.lines[2].printed_name,'ΑΝΤΛΗΣΗ ΣΚΥΡΟΔΕΜΑΤΟΣ');assert.equal(checked.lines[2].value_origin,'printed');
});
