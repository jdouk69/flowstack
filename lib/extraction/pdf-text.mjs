export const MAX_PAGES=100,MAX_TEXT=500000,MAX_PAGE_TEXT=50000;
// Preserve fragments, separate columns with tabs and approximate rows by baseline.
// Visual reading order still needs source review, particularly tables/rotated text.
export function textFromItems(items){
 const rows=[];
 for(const item of items){
  if(typeof item.str!=='string'||!item.str.trim())continue;
  const x=item.transform?.[4],y=item.transform?.[5];
  if(!Number.isFinite(x)||!Number.isFinite(y)){rows.push({y:-Infinity,items:[{x:0,text:item.str}]});continue;}
  let row=rows.find(row=>Math.abs(row.y-y)<=2);if(!row){row={y,items:[]};rows.push(row);}
  row.items.push({x,text:item.str});
 }
 return rows.sort((a,b)=>b.y-a.y).map(row=>row.items.sort((a,b)=>a.x-b.x).map(item=>item.text).join('\t')).join('\n');
}
export async function readPdfPages(bytes,pdfjs,{signal,onProgress=()=>{},recognizeScan,recognizeCurrency}={}){
 if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
 const task=pdfjs.getDocument({data:bytes,isEvalSupported:false,stopAtErrors:true});
 const cancel=()=>{void task.destroy().catch(()=>{});};signal?.addEventListener('abort',cancel,{once:true});
 try{
  const pdf=await task.promise;if(pdf.numPages>MAX_PAGES)throw Error(`This PDF has more than ${MAX_PAGES} pages. Use manual capture; no partial text was saved.`);
  const pages=[];let length=0,scans=0;
  for(let page=1;page<=pdf.numPages;page++){
   if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
   const source=await pdf.getPage(page);const content=await source.getTextContent();let text=textFromItems(content.items);
   const view=source.getViewport({scale:1});let recognized;
   if(!text.trim()&&recognizeScan){if(++scans>5)throw Error('OCR supports up to 5 scanned pages per original. Use smaller original PDFs; no partial preview was saved.');recognized=await recognizeScan(source,{page,width:view.width,height:view.height});text=recognized.text;}
   const result=recognized||{page,text,width:view.width,height:view.height,fragments:content.items.filter(item=>typeof item.str==='string'&&item.str.trim()&&Number.isFinite(item.transform?.[4])&&Number.isFinite(item.transform?.[5])).map(item=>({text:item.str,x:item.transform[4],y:item.transform[5]}))};
   if(!recognized&&recognizeCurrency){try{const currency=await recognizeCurrency(source,result);if(currency)result.currency_evidence=currency;}catch(error){if(signal?.aborted||error.name==='AbortError')throw error;result.currency_check_warning='The printed currency image could not be read. Verify currency manually on the original; no value was inferred.';}}
   source.cleanup();
   length+=text.length;if(text.length>MAX_PAGE_TEXT||length>MAX_TEXT)throw Error('This PDF exceeds the text-reading limit. Use manual capture; no partial text was saved.');
   pages.push(result);onProgress(page,pdf.numPages);
  }
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');return pages;
 }finally{signal?.removeEventListener('abort',cancel);await task.destroy().catch(()=>{});}
}
export async function readStoredPdf(documentId,options){
 const response=await fetch('/api/flow/documents/'+encodeURIComponent(documentId),{signal:options.signal});
 if(!response.ok)throw Error('Could not open the stored source PDF. Refresh and try again.');
 const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>20*1024*1024)throw Error('This PDF exceeds the 20 MB text-reading limit. Use manual capture.');
 const [pdfjs,worker]=await Promise.all([import('pdfjs-dist/build/pdf.mjs'),import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
 pdfjs.GlobalWorkerOptions.workerSrc=worker.default;
 if(!options.ocr&&options.template!=='tournas')return readPdfPages(bytes,pdfjs,options);
 const {createBrowserOcr,ocrPage,MAX_OCR_SIDE}=await import('./ocr.mjs');let engine,currencyEngine;
 const currencyReader=options.template==='tournas'?async(source,page)=>{const {recognizePrintedCurrency}=await import('./currency.mjs');return recognizePrintedCurrency(source,page,{pdfjs,signal:options.signal,createCanvas:(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;},recognize:async c=>{currencyEngine??=await createBrowserOcr({signal:options.signal,onProgress:options.onOcrProgress,languages:['eng'],singleLine:true});return currencyEngine.recognize(c);}});}:undefined;
 try{return await readPdfPages(bytes,pdfjs,{...options,recognizeCurrency:currencyReader,recognizeScan:options.ocr?async(source,metadata)=>{
  engine??=await createBrowserOcr({signal:options.signal,onProgress:options.onOcrProgress});
  const viewport=source.getViewport({scale:Math.min(3,MAX_OCR_SIDE/Math.max(metadata.width,metadata.height))});
  const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  const render=source.render({canvasContext:canvas.getContext('2d'),viewport});const cancel=()=>render.cancel();options.signal?.addEventListener('abort',cancel,{once:true});
  try{await render.promise;return ocrPage(await engine.recognize(canvas),{...metadata,pixelWidth:canvas.width,pixelHeight:canvas.height});}
  finally{options.signal?.removeEventListener('abort',cancel);canvas.width=0;canvas.height=0;}
 }:undefined});}finally{await engine?.terminate();await currencyEngine?.terminate();}
}
