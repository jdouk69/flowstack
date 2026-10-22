import test from 'node:test';
import assert from 'node:assert/strict';
import {auditSheetProvider} from '../lib/audit-sheet-provider.mjs';
test('429 reads back off and recover; append errors are never automatically replayed',async()=>{
 let reads=0,writes=0;const delays=[],gates=[];
 const sheets=auditSheetProvider('fake',async(_url,options)=>{
  if(options.method==='POST'){writes++;return Response.json({error:{status:'UNAVAILABLE'}},{status:503});}
  reads++;return reads===1?Response.json({error:{status:'RESOURCE_EXHAUSTED',details:[{reason:'RATE_LIMIT_EXCEEDED'}]}},{status:429,headers:{'retry-after':'12'}}):Response.json({spreadsheetId:'master'});
 },{beforeRequest:async method=>gates.push(method),sleep:async ms=>delays.push(ms)});
 assert.equal((await sheets.metadata('master')).spreadsheetId,'master');
 assert.equal(reads,2);assert.deepEqual(delays,[12000]);assert.deepEqual(gates,['GET','GET']);
 await assert.rejects(sheets.append('master','A:J',[[1]]),/503/);assert.equal(writes,1);
});
test('403 includes Google permission/protection details without encouraging repeated reconnects',async()=>{
 const sheets=auditSheetProvider('fake',async()=>Response.json({error:{status:'PERMISSION_DENIED',message:'You are trying to edit a protected cell.',details:[{reason:'protectedRange'}]}},{status:403}));
 await assert.rejects(sheets.append('master','A:J',[[1]]),error=>/protectedRange/.test(error.message)&&/protected cell/.test(error.message));
});
