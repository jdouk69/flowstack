import test from 'node:test';
import assert from 'node:assert/strict';
import {compareValue,compareInvoices} from '../lib/invoice-comparison.mjs';
test('numeric format differences match without rounding away real differences',()=>{
 assert.equal(compareValue('1595.5','1595.50',true),'match');
 assert.equal(compareValue('1595.5','1595.52',true),'different');
 assert.equal(compareValue('1595,50','1595.5',true),'match');
});
test('unknowns never count as required field matches',()=>{
 assert.equal(compareValue(null,null,true),'missing');
 assert.equal(compareValue('unknown','unknown'),'missing');
 assert.equal(compareValue('bad','bad',true),'missing');
 assert.equal(compareValue(null,null,false,true),'not_recorded');
 assert.equal(compareValue('1',null,true,true),'missing');
});
test('identity punctuation is preserved',()=>{
 assert.equal(compareValue('000539','539'),'different');
 assert.equal(compareValue(' ΤΟΜΕΣ  ΑΤΕ ','ΤΟΜΕΣ ΑΤΕ'),'match');
});
test('empty and incomplete item captures cannot be considered verified',()=>{
 const result=compareInvoices({invoice:{},line_items:[]},{invoice:{},line_items:[{quantity:'1'}]});
 assert.equal(result.hasItems,false);assert.equal(result.lineCountMatch,false);assert.ok(result.missing>0);
});
test('item differences surface in the corresponding saved row',()=>{
 const left={invoice:{},line_items:[{quantity:'18',unit_price:'88.6400',line_amount:'1595.5'}]};
 const right={invoice:{},line_items:[{quantity:'18',unit_price:'88.64',line_amount:'1595.52'}]};
 const result=compareInvoices(left,right);assert.equal(result.differences,1);
 assert.equal(result.items[0].rows.find(r=>r.label==='Printed line amount').status,'different');
});
