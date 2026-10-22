import test from 'node:test';
import assert from 'node:assert/strict';
import { previewCriteria, countPreviewAttachments, previewCollection } from '../lib/collection-preview.mjs';

test('search modes preserve criteria and attachment requirement', () => {
  assert.equal(previewCriteria({email:'supplier@example.com'}).query, 'from:supplier@example.com has:attachment');
  assert.equal(previewCriteria({search_type:'company_name',keyword:'Supplier Name'}).query, 'from:"Supplier Name" has:attachment');
  assert.equal(previewCriteria({search_type:'gmail_search',keyword:'from:a OR from:b'}).query, '(from:a OR from:b) has:attachment');
  assert.throws(() => previewCriteria({email:'x OR from:y'}));
  assert.throws(() => previewCriteria({email:'a@b.com',file_types:['unknown']}));
});

test('MIME traversal covers single attachments and nested mixed types', () => {
  const allowed = previewCriteria({email:'a@b.com',file_types:['pdf','images']}).allowedExtensions;
  assert.equal(countPreviewAttachments({filename:'invoice.PDF'}, allowed), 1);
  assert.equal(countPreviewAttachments({parts:[{filename:'a.pdf'},{parts:[{filename:'b.JPG'},{filename:'c.docx'}]}]}, allowed), 2);
});

test('exact preview deduplicates message IDs without storing documents', async () => {
  const calls = [];
  const result = await previewCollection({email:'a@b.com'}, {
    search: async () => ({messages:[{id:'one'},{id:'one'},{id:'two'}]}),
    read: async id => { calls.push(id); return {payload:{filename:'invoice.pdf',headers:[{name:'Subject',value:id}]}}; },
  });
  assert.deepEqual(calls, ['one','two']);
  assert.equal(result.files_found, 2);
  assert.equal(result.files_found_is_estimate, false);
  assert.equal(result.search_truncated, false);
});

test('bounded search marks estimates and incomplete counts explicitly', async () => {
  let page = 0; let reads = 0;
  const result = await previewCollection({email:'a@b.com'}, {
    search: async () => ({messages:Array.from({length:100},(_,i)=>({id:`${page}-${i}`})),nextPageToken:`page-${++page}`}),
    read: async () => { reads++; return {payload:{parts:[{filename:'a.pdf'},{filename:'b.pdf'}]}}; },
  });
  assert.equal(page, 3); assert.equal(reads, 50);
  assert.equal(result.files_found, 600);
  assert.equal(result.files_found_is_estimate, true);
  assert.equal(result.emails_found_is_lower_bound, true);
});

test('provider failures never become empty or partial success', async () => {
  await assert.rejects(previewCollection({email:'a@b.com'}, {search:async()=>{throw new Error('permission denied');}}), /permission denied/);
  await assert.rejects(previewCollection({email:'a@b.com'}, {
    search:async()=>({messages:[{id:'one'}]}),read:async()=>null,
  }), /Could not read/);
  await assert.rejects(previewCollection({email:'a@b.com'}, {
    search:async()=>({messages:[],nextPageToken:'repeat'}),
  }), /pagination/);
});
