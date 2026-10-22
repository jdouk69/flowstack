import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAutomaticPages,invoiceTotals} from '../lib/automation-runner.mjs';
const page={page:1,width:595,height:842,text:'ΤΙΜΟΛΟΓΙΟ\t123\t6/10/2026\n01.02.003\tPrinted item\tkg\t2,00\t5,00\t0,00\t10,00\t24,00',fragments:[{text:'10,00',x:510,y:162},{text:'2,40',x:510,y:146},{text:'12,40',x:510,y:113}]};
test('automatic capture accepts complete drafts with unknown artwork fields and supported service/receipt types',()=>{
 for(const type of ['ΤΙΜΟΛΟΓΙΟ','ΤΙΜΟΛΟΓΙΟ ΠΑΡΟΧΗΣ','ΑΠΟΔΕΙΞΗ']){
  const draft=validateAutomaticPages([{...page,text:page.text.replace('ΤΙΜΟΛΟΓΙΟ',type)}],'tournas');
  assert.equal(draft.fields.supplier_name,null);assert.equal(draft.fields.currency,null);
  assert.equal(draft.fields.supplier_key,'tournas');assert.equal(draft.line_items.length,1);
 }
});
test('automation rejects incomplete rows, scans, unclassified pages and multi-page sources before saving',()=>{
 assert.throws(()=>validateAutomaticPages([{...page,text:page.text+'\n01.02.004\tBroken row'}],'tournas'),/completely/);
 assert.throws(()=>validateAutomaticPages([{...page,text:'',fragments:[]}],'tournas'),/complete item rows/);
 assert.throws(()=>validateAutomaticPages([{...page,text:'Account summary'}],'tournas'),/complete item rows/);
 assert.throws(()=>validateAutomaticPages([page,{...page,page:2}],'tournas'),/one-page/);
});
test('invoice totals retain decimal-comma cents, normalize explicit euro symbols, separate unknown currencies and count invalid values',()=>{
 const rows=invoiceTotals([{currency:null,invoice_total:'18,60'},{currency:'',invoice_total:'168,80'},{currency:'EUR',invoice_total:'0,10'},{currency:'€',invoice_total:'0.20'},{currency:'USD',invoice_total:'-1,05'},{currency:'USD',invoice_total:'not a number'}]);
 assert.deepEqual(rows,[{currency:'EUR',amount:'0.3',invoice_count:2,invalid_totals:0},{currency:'Unknown currency',amount:'187.4',invoice_count:2,invalid_totals:0},{currency:'USD',amount:'-1.05',invoice_count:1,invalid_totals:1}]);
});
