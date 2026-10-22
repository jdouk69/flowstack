import test from 'node:test';
import assert from 'node:assert/strict';
import {readAll} from '../lib/tournas-master-sync.mjs';

test('master reader accepts the 10,001-row grids Google creates after the first append',async()=>{
 const titles=['Line Item Audit','Needs Attention','Paint & Consumables'];
 let requested=[];
 const sheets={
  metadata:async()=>({sheets:titles.map((title,sheetId)=>({properties:{title,sheetId,gridProperties:{rowCount:10001,columnCount:10}}}))}),
  read:async(_id,ranges)=>{requested=ranges;return {valueRanges:ranges.map(range=>({range,values:[['header']]}))};}
 };
 const result=await readAll(sheets,'master-id');
 assert.deepEqual(requested,titles.map(title=>`'${title}'!A1:J10001`));
 assert.deepEqual(result.valueRanges.map(range=>range.values),[[['header']],[['header']],[['header']]]);
});

