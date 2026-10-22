import test from 'node:test';
import assert from 'node:assert/strict';
import {validateInvoiceCapture} from '../lib/invoice-capture.mjs';
test('unknown fields remain null and no account/currency is inferred',()=>{
 const result=validateInvoiceCapture({revision:0,line_items:[]});
 for(const key of ['supplier_name','invoice_number','account_information','invoice_total','vat','currency'])assert.equal(result.invoice[key],null);
 assert.deepEqual(result.lines,[]);
});
test('line precision, printed names and units remain separate and exact',()=>{
 const result=validateInvoiceCapture({revision:1,supplier_key:'tournas',supplier_name:'ΤΟΥΡΝΑΣ',printed_names:['Printed customer'],line_items:[{description:'Printed concrete mix',quantity:'2,50',unit:'m³',unit_price:'3.20',line_amount:'8.00'}]});
 assert.equal(result.lines[0].quantity,'2,50');assert.equal(result.lines[0].unit_price,'3.20');assert.equal(result.lines[0].unit,'m³');assert.equal(result.invoice.supplier_name,'ΤΟΥΡΝΑΣ');
});
test('invalid amounts, dates, unnamed items and revisions are rejected',()=>{
 for(const input of [{invoice_total:'€95'},{invoice_date:'2026-02-30'},{line_items:[{quantity:'3'}]},{revision:-1},{line_items:[{description:'item',quantity:'unknown'}]}])assert.throws(()=>validateInvoiceCapture({revision:0,line_items:[],...input}));
});
