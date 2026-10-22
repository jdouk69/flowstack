import test from 'node:test';
import assert from 'node:assert/strict';
import {documentType,isPdfDocument,alternateDocumentName} from '../lib/document-types.mjs';
test('the original attachment extensions remain supported',()=>{
 for(const ext of ['pdf','jpg','jpeg','png','heic','gif','webp','tif','tiff','doc','docx','xls','xlsx','ppt','pptx','zip'])assert.ok(documentType('document.'+ext));
 assert.equal(documentType('report.XLSX').file_type,'excel');
 assert.equal(documentType('script.html'),null);
 assert.equal(documentType('application.exe'),null);
});
test('collision names preserve original extensions and legacy PDFs stay mergeable',()=>{
 assert.equal(alternateDocumentName('report.xlsx','abcdef123456'),'report [alt-abcdef12].xlsx');
 assert.equal(isPdfDocument({name:'old.PDF'}),true);
 assert.equal(isPdfDocument({name:'looks.pdf',mime_type:'application/zip'}),false);
 assert.equal(isPdfDocument({name:'quantities.xlsx'}),false);
});
