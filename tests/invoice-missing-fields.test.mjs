import test from 'node:test';
import assert from 'node:assert/strict';
import {invoiceMissingFields} from '../lib/invoice-missing-fields.mjs';
const invoice={supplier_name:'Supplier',invoice_number:'1',document_type:'invoice',invoice_date:'2026-10-11',subtotal:'10',vat:'0',invoice_total:'10',currency:'EUR',field_evidence:'Header and totals',source_page:1,receiver_status:'blank'};
const line={description:'Service',quantity:'1',unit:'service',unit_price:'10',line_amount:'10',source_page:1,printed_evidence:'Row 1',line_amount_basis:'net',unit_price_basis:'net'};
test('optional absent fields and printed zero VAT are not missing',()=>{
 assert.deepEqual(invoiceMissingFields(invoice,[line]),[]);
});
test('missing amounts identify their exact row and disappear as corrected',()=>{
 const missing=invoiceMissingFields({...invoice,currency:null},[line,{...line,line_amount:null}]);
 assert.deepEqual(missing.map(m=>[m.field,m.lineIndex,m.id]),[['currency',undefined,'invoice-field-currency'],['line_amount',1,'invoice-item-2-line_amount']]);
 assert.deepEqual(invoiceMissingFields(invoice,[line,line]),[]);
});
test('unknown VAT basis and unreadable receiver are unverified; confirmed blank is valid',()=>{
 const missing=invoiceMissingFields({...invoice,receiver_status:'unreadable'},[{...line,unit_price_basis:'unknown'}]);
 assert.deepEqual(missing.map(m=>m.field),['receiver_status','unit_price_basis']);
 assert.ok(invoiceMissingFields({...invoice,receiver_status:'shown',receiver:''},[line]).some(m=>m.field==='receiver'));
});
