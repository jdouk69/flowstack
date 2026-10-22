import test from 'node:test';
import assert from 'node:assert/strict';
import {sendReviewFile} from '../lib/chatgpt-review-share.mjs';
const file=new File(['%PDF-test'],'FlowStack-review-test.pdf',{type:'application/pdf'});
test('shares the exact prepared file immediately, without a download or navigation',async()=>{
 let payload;const fail=()=>assert.fail('unexpected fallback');
 const result=sendReviewFile(file,{navigator:{canShare:({files})=>files[0]===file,share:data=>{payload=data;return Promise.resolve();}},download:fail,open:fail});
 assert.equal(payload.files[0],file);assert.equal(await result,'shared');
});
test('unsupported file sharing downloads the prepared file and opens ChatGPT',async()=>{
 for(const navigator of [{},{share(){},canShare:()=>false},{share(){},canShare(){throw Error('blocked');}}]){
  const calls=[];assert.equal(await sendReviewFile(file,{navigator,download:f=>calls.push(f),open:()=>calls.push('open')}),'fallback');assert.deepEqual(calls,[file,'open']);
 }
});
test('cancel and denied sharing keep the file ready without unexpected navigation',async()=>{
 for(const [name,expected] of [['AbortError','cancelled'],['NotAllowedError','failed']]){
  const fail=()=>assert.fail('must not download or navigate after a rejected share');
  assert.equal(await sendReviewFile(file,{navigator:{canShare:()=>true,share:()=>Promise.reject({name})},download:fail,open:fail}),expected);
 }
});
