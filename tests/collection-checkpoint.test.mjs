import test from 'node:test';
import assert from 'node:assert/strict';
import {collectionWindow,collectionSignature,successfulCheckpoint} from '../lib/collection-checkpoint.mjs';
const workflow={email:'supplier@example.com',search_type:'sender_email',file_types:['pdf'],drive_folder_name:'Supplier'};
test('checkpoint scope includes search, selected types and destination, and never assumes last_run was successful',()=>{
 const started='2026-10-08T17:00:00Z',signature=collectionSignature(workflow);
 assert.equal(collectionWindow({...workflow,last_run:started},'incremental',started).mode,'full');
 const scoped={...workflow,collection_checkpoint:{through:'2026-10-07T17:00:00Z',criteria_signature:signature}};
 assert.equal(collectionWindow(scoped,'incremental',started).mode,'incremental');
 for(const changed of [{email:'other@example.com'},{file_types:['pdf','images']},{drive_folder_name:'Elsewhere'}])assert.equal(collectionWindow({...scoped,...changed},'incremental',started).mode,'full');
 const job={done:true,criteria_signature:signature,checkpoint_through:started,completed_at:started,run_id:'test'};
 assert.equal(successfulCheckpoint(workflow,job,{errors:1,status:'partial'}),null);
 assert.equal(successfulCheckpoint(workflow,{...job,done:false},{errors:0,status:'running'}),null);
 assert.equal(successfulCheckpoint({...workflow,email:'other@example.com'},job,{errors:0,status:'completed'}),null);
 assert.equal(successfulCheckpoint(workflow,job,{errors:0,status:'completed'}).through,started);
 assert.deepEqual(successfulCheckpoint({...workflow,collection_checkpoint:{through:'2026-10-09T17:00:00Z',criteria_signature:signature}},job,{errors:0,status:'completed'}),{through:'2026-10-09T17:00:00Z',criteria_signature:signature});
});
