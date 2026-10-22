import test from 'node:test';
import assert from 'node:assert/strict';
import {deleteStoredDocument,deletionConfirmation} from '../lib/delete-document.mjs';
test('shared merge revokes before deletion; revoked copy skips revocation',async()=>{
 const calls=[];const deps={request:async(path,opts)=>calls.push(['delete',path,opts.method]),invoke:async(name,data)=>calls.push(['share',data.action,data.document_id])};
 const d={id:'merged-1',name:'Merged Tournas.pdf',customer_share:{status:'active'}};
 assert.match(deletionConfirmation(d),/revoked first/);assert.match(deletionConfirmation(d),/Drive copies will remain/);
 await deleteStoredDocument(d,deps);assert.deepEqual(calls,[['share','revoke','merged-1'],['delete','/documents/merged-1','DELETE']]);
 calls.length=0;await deleteStoredDocument({...d,customer_share:{status:'revoked'}},deps);assert.equal(calls.length,1);
});
test('failed revocation never deletes; source protection remains an error',async()=>{
 let deleted=false;await assert.rejects(deleteStoredDocument({id:'x',customer_share:{status:'pending'}},{invoke:async()=>{throw Error('Drive unavailable');},request:async()=>{deleted=true;}}),/Drive unavailable/);assert.equal(deleted,false);
 await assert.rejects(deleteStoredDocument({id:'x'},{request:async()=>{throw Error('Invoice source retained');}}),/Invoice source retained/);
});
