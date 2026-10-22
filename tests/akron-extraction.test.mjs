import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAkronPage} from '../lib/extraction/suppliers/akron.mjs';
import {extractionCaptureDraft} from '../lib/extraction/capture-draft.mjs';
import {validateInvoiceCapture} from '../lib/invoice-capture.mjs';
import {validatePages} from '../lib/extraction/suggestions.mjs';
import {akronFixture} from './akron-fixture.mjs';
test('Akron preserves printed columns, full series identity, unknown artwork/currency and receiver role',()=>{
 const p=akronFixture(),d=parseAkronPage(p);assert.equal(d.invoice_number,'ΤΔΑΜ000001');assert.equal(d.invoice_date,'2026-10-06');assert.equal(d.account_number,'TEST-ACCOUNT');assert.equal(d.customer_information,'TEST CUSTOMER');assert.equal(d.receiver,'RECEIVER');assert.equal(d.supplier_name,null);assert.equal(d.currency,null);assert.equal(d.invoice_total,'349,08');assert.equal(d.line_items.length,1);const l=d.line_items[0];assert.equal(l.description,'Printed item');assert.equal(l.quantity,'460,00');assert.equal(l.discount_printed,'10');assert.equal(l.discount_basis,'%');assert.equal(l.discount_amount_printed,'31,28');assert.equal(l.line_amount,'281,52');assert.equal(l.vat_rate,'24');assert.equal(l.vat_amount,null);assert.equal(l.gross_line_amount,null);
 assert.equal(parseAkronPage({...p,fragments:p.fragments.filter(f=>f.text!=='RECEIVER')}).receiver,null);
 assert.equal(parseAkronPage({...p,fragments:p.fragments.map(f=>f.text==='RECEIVER'?{...f,text:'.'}:f)}).receiver,null);
});
test('blank discounts do not shift net amounts and Letter coordinates retain the same fields',()=>{
 const p=akronFixture();p.fragments=p.fragments.filter(f=>!['10','31,28'].includes(f.text));const d=parseAkronPage(p);assert.equal(d.line_items[0].discount_printed,null);assert.equal(d.line_items[0].line_amount,'281,52');
 const letter={...p,width:612,height:792,fragments:p.fragments.map(f=>({...f,x:f.x*324/330,y:f.y-49.73}))};assert.equal(parseAkronPage(letter).line_items[0].unit_price,'0,68');assert.equal(parseAkronPage(letter).receiver,'RECEIVER');
});
test('quotes, delivery notes, statements, scans and unknown layouts never become invoice drafts',()=>{
 const p=akronFixture();for(const change of [{text:''},{text:'Αριθμός Προσφοράς:\tΠΑΡ0000001\tΗμερομηνία:\t6/10/2026'},{text:p.text.replace('Τιμολόγιο -','')},{text:'Καρτέλα πελάτη'},{width:800},{text:p.text.replace('075018558002','999999999999')},{text:p.text+'\n'+p.text.split('\n')[1]}]){const changed={...p,...change},d=parseAkronPage(changed);assert.notEqual(d.document_type,'invoice');assert.equal(d.line_items.length,0);assert.throws(()=>extractionCaptureDraft({pages:1},{revision:1,pages:JSON.stringify([changed]),analysis:JSON.stringify({template:'akron'})}));}
});
test('unreadable or unrecognized table rows block partial draft transfer; ambiguous totals stay unknown',()=>{
 const p=akronFixture(),saved=page=>({revision:1,pages:JSON.stringify([page]),analysis:JSON.stringify({template:'akron'})});
 const changed={...p,fragments:[...p.fragments,{text:'BAD-CODE',x:22,y:520}]};assert.throws(()=>extractionCaptureDraft({pages:1},saved(changed)),/could not be read/);
 const unreadable={...p,fragments:p.fragments.map(f=>f.text==='460,00'?{...f,text:'UNREADABLE'}:f)};assert.equal(parseAkronPage(unreadable).line_items.length,0);assert.throws(()=>extractionCaptureDraft({pages:1},saved(unreadable)));
 const ambiguous={...p,fragments:[...p.fragments,{text:'88,00',x:525,y:240.25}]};assert.equal(parseAkronPage(ambiguous).invoice_total,null);
});
test('draft bridge recomputes source, preserves evidence, and uses existing normalized capture without approval',()=>{
 const p=akronFixture(),saved={revision:2,pages:JSON.stringify([p]),analysis:JSON.stringify({template:'akron',documents:[{receiver:'FORGED',invoice_total:'0'}]})};assert.equal(validatePages({revision:0,template:'akron',pages:[p]}).template,'akron');const draft=extractionCaptureDraft({pages:1},saved);assert.equal(draft.fields.receiver,'RECEIVER');assert.equal(draft.fields.supplier_key,'akron');assert.equal(draft.fields.invoice_total,'349,08');assert.match(draft.line_items[0].printed_evidence,/31,28/);const capture=validateInvoiceCapture({revision:0,...draft.fields,line_items:draft.line_items});assert.equal(capture.invoice.supplier_name,null);assert.equal(capture.lines[0].discount_basis,'%');assert.equal(JSON.parse(saved.analysis).documents[0].receiver,'FORGED');
});
