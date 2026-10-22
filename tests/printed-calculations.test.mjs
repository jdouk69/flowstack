import test from 'node:test';
import assert from 'node:assert/strict';
import {auditInvoice,lineCalculation,reconcileLineTotals,decimal} from '../lib/invoice-audit.mjs';
import {tournasAmountBasis} from '../lib/extraction/amount-basis.mjs';
import {currencyFromOcr} from '../lib/extraction/currency.mjs';
import {validateInvoiceCapture} from '../lib/invoice-capture.mjs';
import {extractionCaptureDraft} from '../lib/extraction/capture-draft.mjs';
import {akronFixture} from './akron-fixture.mjs';
import {productDisplay,findingExplanation} from '../lib/finding-display.mjs';
const invoice={id:'isolated',supplier_key:'akron',supplier_name:'Test supplier',receiver_status:'blank',document_type:'Invoice',invoice_number:'TEST',account_information:'test',invoice_date:'2026-10-08',currency:'EUR',subtotal:'320.07',vat:'76.82',invoice_total:'396.89'};
const line={position:1,description:'Test washbasin',quantity:'1.00',unit:'pc',unit_price:'439.00',discount_printed:'27',discount_basis:'%',discount_amount_printed:'118.93',line_amount:'320.07',line_amount_basis:'net',unit_price_basis:'net'};
test('printed monetary discount wins over rounded percentage; original values remain unchanged',()=>{
 const before=structuredClone(line),a=auditInvoice(invoice,[line],[],[]);
 assert.equal(a.flag,'YELLOW');assert.equal(a.reasons[0].code,'discount_percentage_rounding');assert.equal(a.reasons[0].evidence[0].calculated_net,'320.07');assert.equal(a.reasons[0].evidence[0].percentage_calculation,'320.47');assert.deepEqual(line,before);
 const wrong=auditInvoice({...invoice,subtotal:'310.00'},[{...line,line_amount:'310.00'}],[],[]);assert.ok(wrong.reasons.some(r=>r.color==='ORANGE'&&r.code==='line_calculation'));
});
test('invoice-level monetary discount reconciles separate printed net totals without altering lines',()=>{
 const i={...invoice,subtotal:'538.68',subtotal_before_discount:'544.36',invoice_discount_printed:'5.68',vat:'129.28',invoice_total:'667.96'};
 const lines=[{...line,quantity:'2',unit_price:'279.84',discount_printed:'17',discount_amount_printed:'95.15',line_amount:'464.53'},{...line,position:2,quantity:'2',unit_price:'44.35',discount_printed:'10',discount_amount_printed:'8.87',line_amount:'79.83'}];
 const before=structuredClone({i,lines});assert.equal(auditInvoice(i,lines,[],[]).flag,'GREEN');assert.equal(reconcileLineTotals(i,lines).expected,decimal('538.68'));assert.deepEqual({i,lines},before);
 assert.ok(auditInvoice({...i,invoice_discount_printed:'4.00'},lines,[],[]).reasons.some(r=>r.code==='invoice_discount_mismatch'&&r.color==='ORANGE'));
});
test('VAT-inclusive receipt lines compare with gross total, never net subtotal',()=>{
 const i={...invoice,supplier_key:'tournas',document_type:'Απόδειξη Λιανικής Πώλησης-Δα',subtotal:'178.39',vat:'42.81',invoice_total:'221.20'};
 const lines=[{...line,quantity:'205.00',unit_price:'1.08',discount_printed:'0',discount_basis:null,discount_amount_printed:null,line_amount:'221.20'}];
 tournasAmountBasis(i.document_type,i,lines,1);assert.equal(lines[0].line_amount_basis,'gross');const a=auditInvoice(i,lines,[],[]);assert.ok(!a.reasons.some(r=>r.code==='subtotal_mismatch'));assert.equal(a.flag,'YELLOW');
 const ordinary=structuredClone(lines);tournasAmountBasis('Δ.Αποστολής Τιμολόγιο',i,ordinary,1);assert.equal(ordinary[0].line_amount_basis,'net');assert.ok(auditInvoice(i,ordinary,[],[]).reasons.some(r=>r.code==='subtotal_mismatch'&&r.color==='ORANGE'));
});
test('aggregate rounding bounds retain the actual printed amount precision; no blanket cents cutoff',()=>{
 const i={...invoice,subtotal:'1764.35',vat:'423.44',invoice_total:'2187.79'};
 const amounts=['1343.2','19.80','183.75','26.61','134.14','56.77'];const lines=amounts.map((amount,n)=>({...line,position:n+1,quantity:'1',unit_price:amount,discount_printed:'0',discount_amount_printed:null,line_amount:amount}));
 const r=reconcileLineTotals(i,lines);assert.equal(r.bound,decimal('0.12'));assert.equal(r.difference,decimal('-0.08'));assert.equal(auditInvoice(i,lines,[],[]).reasons.find(r=>r.code==='printed_amount_rounding').color,'YELLOW');
 assert.ok(auditInvoice({...i,subtotal:'1764.40',invoice_total:'2187.84'},lines,[],[]).reasons.some(r=>r.code==='subtotal_mismatch'&&r.color==='ORANGE'));
 const precise={...line,quantity:'1.00',unit_price:'10.00',discount_printed:'0',discount_amount_printed:null,line_amount:'10.02'};assert.equal(lineCalculation(precise).possibleRounding,false);
});
test('all supported decimal inputs multiply without intermediate truncation',()=>{
 const r=lineCalculation({...line,quantity:'0.000001',unit_price:'0.000001',discount_printed:'0',discount_amount_printed:null,line_amount:'0'});assert.equal(r.expectedText,'0.000000000001');assert.equal(r.differenceText,'-0.000000000001');
 const d=lineCalculation({...line,quantity:'0.000001',unit_price:'0.000001',discount_printed:'33.333333',discount_amount_printed:null,line_amount:'0'});assert.equal(d.expectedText,'0.00000000000066666667');
});
test('new capture fields survive extraction and validation; arbitrary VAT bases are rejected',()=>{
 const draft=extractionCaptureDraft({pages:1},{pages:JSON.stringify([akronFixture()]),analysis:JSON.stringify({template:'akron'}),revision:1});assert.equal(draft.line_items[0].discount_amount_printed,'31,28');assert.equal(draft.line_items[0].line_amount_basis,'net');
 const parsed=validateInvoiceCapture({revision:0,...draft.fields,line_items:draft.line_items});assert.equal(parsed.lines[0].discount_amount_printed,'31,28');assert.equal(parsed.invoice.subtotal_before_discount,'281,52');assert.throws(()=>validateInvoiceCapture({revision:0,line_items:[{...line,line_amount_basis:'guess'}]}));
});
test('currency requires the actual euro token plus matching printed total; OCR confusion never becomes EUR',()=>{
 const data=(symbol,confidence=95,total='221.20')=>({blocks:[{paragraphs:[{lines:[{words:[{text:symbol,confidence},{text:total,confidence:95}]}]}]}]});
 assert.equal(currencyFromOcr(data('€'),{page:1,total:'221,20'}).currency,'EUR');for(const d of [data('£'),data('€',79),data('€',95,'999.99'),{text:'€ 221.20'}])assert.equal(currencyFromOcr(d,{page:1,total:'221,20'}),null);
});
test('construction translations explain known materials and specify genuine uncertainty without mutation',()=>{
 for(const item of ['ΑΦΡΟΣ ΠΟΛ/ΝΗΣ ΧΑΜΗΛΗΣ ΔΙΟΓΚΩΣΗΣ ΠΙΣΤΟΛΙΟΥ','ΔΙΟΓΚ ΠΟΛ ΡΙΖΑΚΟΣ EPS 100 8cm','BATHCO 00608 ΝΙΠΤ Φ40x13h DOMED EΛΕΥΘ ΤΟΠΟΘ']){const f={item};const d=productDisplay(f);assert.equal(d.uncertain,false);assert.ok(!d.english.includes('needs review'));assert.equal(d.original,item);assert.deepEqual(f,{item});}
 const d=productDisplay({item:'ΦΟΥΡΚΕΤΕΣ'});assert.ok(d.english.includes('reinforcement'));assert.ok(d.uncertainty.includes('product shape'));
 const e=findingExplanation({key:['i','discount_percentage_rounding'],evidence:[{discount_amount_printed:'118.93',discount_printed:'27',calculated_net:'320.07',percentage_calculation:'320.47',line_amount:'320.07',difference:'0.4'}]});assert.match(e.summary,/118.93/);assert.match(e.summary,/320.47/);
});
