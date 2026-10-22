import test from 'node:test';
import assert from 'node:assert/strict';
import {exportAnalysisReport,reportName} from '../lib/analysis-report.mjs';
test('finished batches export one scoped draft with a dated name and return the verified Drive workbook',async()=>{
 const calls=[],progress=[];const workbook={id:'saved',status:'completed',url:'https://docs.google.com/spreadsheets/d/saved/edit'};
 const result=await exportAnalysisReport({result:{stopped:false,batch_ids:['b1','b2']},template:'tournas',onProgress:p=>progress.push(p),request:async(path,options)=>{calls.push({path,options});return options?{workbook}:{rows:[{id:'line'}]};}});
 assert.equal(calls.length,2);assert.equal(calls[0].path,'/reports?status=all&batches=b1%2Cb2');
 const body=JSON.parse(calls[1].options.body);assert.equal(body.query,'status=all&batches=b1%2Cb2');assert.equal(body.include_drafts,true);assert.match(body.name,/Tournas Audit — Draft/);assert.equal(result.workbook,workbook);assert.equal(progress.length,2);
 assert.equal(reportName('tournas',new Date('2026-10-08T01:00:00Z')),'FlowStack Tournas Audit — Draft — 2026-10-07');
});
test('stopped or empty runs never export and export failure is surfaced without restarting analysis',async()=>{
 let calls=0;const request=async()=>{calls++;return {rows:[]};};
 assert.deepEqual(await exportAnalysisReport({result:{stopped:true,batch_ids:['b1']},request}),{skipped:true});assert.equal(calls,0);
 const empty=await exportAnalysisReport({result:{stopped:false,batch_ids:['b1']},request});assert.equal(empty.empty,true);assert.equal(calls,1);
 await assert.rejects(exportAnalysisReport({result:{stopped:false,batch_ids:['b1']},request:async(path,options)=>{if(options)throw Error('Drive unavailable');return {rows:[{}]};}}),/Drive unavailable/);
});
