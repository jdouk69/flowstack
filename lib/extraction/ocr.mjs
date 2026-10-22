export const OCR_ENGINE='tesseract-6-ell-eng-v1',MAX_OCR_PAGES=5,MAX_OCR_SIDE=2200;
export async function withOcrCancellation(promise,signal){
 if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
 let cancel;
 const aborted=new Promise((_,reject)=>{cancel=()=>reject(new DOMException('Cancelled','AbortError'));signal?.addEventListener('abort',cancel,{once:true});});
 try{return await Promise.race([promise,aborted]);}finally{signal?.removeEventListener('abort',cancel);}
}
export function ocrPage(data,{page,width,height,pixelWidth,pixelHeight}){
 if(!data||typeof data.text!=='string'||data.text.length>50000)throw Error('OCR text exceeds the preview limit. No partial result was saved.');
 const confidence=Number.isFinite(data.confidence)?data.confidence:null;
 const fragments=(data.blocks||[]).flatMap(b=>b.paragraphs||[]).flatMap(p=>p.lines||[]).flatMap(l=>l.words||[]).map(w=>({text:w.text,x:w.bbox.x0/pixelWidth*width,y:height-w.bbox.y1/pixelHeight*height}));
 return {page,text:data.text,width,height,fragments,extraction_method:'ocr',ocr_engine:OCR_ENGINE,ocr_confidence:confidence};
}
export async function createBrowserOcr({signal,onProgress=()=>{},languages=['ell','eng'],singleLine=false}={}){
 if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
 const {createWorker,PSM}=await import('tesseract.js');
 if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
 let worker,stopped=false;
 const stop=()=>{stopped=true;if(worker)void worker.terminate();};signal?.addEventListener('abort',stop,{once:true});
 try{
  const startup=createWorker(languages,1,{workerPath:'/ocr/v1/worker.min.js',corePath:'/ocr/v1/core',langPath:'/ocr/v1/lang',workerBlobURL:false,logger:m=>onProgress(m.status,m.progress)});
  startup.then(value=>{if(stopped)void value.terminate();},()=>{});
  worker=await withOcrCancellation(startup,signal);
  if(signal?.aborted||stopped){await worker.terminate();throw new DOMException('Cancelled','AbortError');}
  await withOcrCancellation(worker.setParameters({tessedit_pageseg_mode:singleLine?PSM.SINGLE_LINE:PSM.SINGLE_BLOCK,preserve_interword_spaces:'1'}),signal);
  return {recognize:async canvas=>{if(stopped)throw new DOMException('Cancelled','AbortError');const r=await withOcrCancellation(worker.recognize(canvas,{}, {text:true,blocks:true}),signal);if(stopped)throw new DOMException('Cancelled','AbortError');return r.data;},terminate:async()=>{signal?.removeEventListener('abort',stop);if(!stopped){stopped=true;await worker.terminate();}}};
 }catch(error){signal?.removeEventListener('abort',stop);if(worker&&!stopped)await worker.terminate();throw error;}
}
