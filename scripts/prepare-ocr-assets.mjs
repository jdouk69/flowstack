import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {mkdirSync,copyFileSync,readdirSync} from 'node:fs';
const require=createRequire(import.meta.url),target=join(process.cwd(),'public/ocr/v1');
mkdirSync(join(target,'core'),{recursive:true});mkdirSync(join(target,'lang'),{recursive:true});
const tess=dirname(require.resolve('tesseract.js/package.json'));
const core=dirname(require.resolve('tesseract.js-core/package.json',{paths:[tess]}));
copyFileSync(join(tess,'dist/worker.min.js'),join(target,'worker.min.js'));
copyFileSync(join(core,'LICENSE'),join(target,'Tesseract-LICENSE'));
// Host engine and languages ourselves: source images never go to an OCR service/CDN.
for(const file of readdirSync(core).filter(f=>f.endsWith('.wasm.js')||f.endsWith('.wasm')))copyFileSync(join(core,file),join(target,'core',file));
for(const language of ['ell','eng'])copyFileSync(join(dirname(require.resolve('@tesseract.js-data/'+language+'/package.json')),'4.0.0',language+'.traineddata.gz'),join(target,'lang',language+'.traineddata.gz'));
