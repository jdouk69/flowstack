// Read-only acceptance checks against the owner's separately supplied source PDFs.
// Source files are never copied into the repository or uploaded by this script.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import {readPdfPages} from '../lib/extraction/pdf-text.mjs';
import {analyzePages} from '../lib/extraction/suppliers/tournas.mjs';
if(!process.argv[2]||!process.argv[3])throw Error('Supply Tournas and Ergobeton source PDF paths.');
const read=path=>readPdfPages(new Uint8Array(readFileSync(path)),pdfjs);
const pages=await read(process.argv[2]),analysis=analyzePages(pages,'tournas');
assert.equal(pages.length,86);
const d=analysis.documents;
assert.equal(d[25].invoice_number,'295');assert.equal(d[25].account_number,'8891');assert.equal(d[25].receiver,'ΜΠΟΥΖΟΥΝΙΕΡΑΚΗΣ');assert.equal(d[25].line_items.length,5);assert.equal(d[25].invoice_total,'265,19');
assert.equal(d[26].document_type,'account_statement');assert.equal(d[26].entries.length,5);
assert.equal(d[84].line_items.length,1);assert.equal(d[84].invoice_total,'62,00');
assert.equal(d[85].invoice_number,'3741');assert.equal(d[85].receiver,null);assert.equal(d[85].line_items.length,4);assert.equal(d[85].invoice_total,'701,01');
assert.equal(analysis.status,'needs_review');
const scan=await read(process.argv[3]);assert.equal(scan.length,24);assert.equal(scan.filter(p=>!p.text.trim()).length,15);
assert.equal(analyzePages(scan,'generic').documents.filter(d=>d.document_type==='ocr_required').length,15);
console.log('PASS: source Tournas 86 pages, verified examples 26/27/85/86, blank receiver distinct from deliverer; Ergobeton 24 pages, 15 explicitly require OCR. Remaining rows still need source review.');
