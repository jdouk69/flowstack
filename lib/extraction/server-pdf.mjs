import {textFromItems,MAX_PAGES,MAX_PAGE_TEXT,MAX_TEXT} from './pdf-text.mjs';

export async function serverPages(bytes){
 if(bytes.byteLength>20*1024*1024)throw Error('PDF exceeds the 20 MB automatic text-reading limit. The original is retained for manual review.');
 const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
 // Explicit import bundles the fake-worker handler for Workers deployments.
 // The library's inferred relative worker URL does not exist after bundling.
 const {WorkerMessageHandler}=await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
 globalThis.pdfjsWorker={WorkerMessageHandler};
 const task=pdfjs.getDocument({data:bytes,isEvalSupported:false,stopAtErrors:true,disableWorker:true});
 try{
  const pdf=await task.promise;if(pdf.numPages>MAX_PAGES)throw Error(`PDF exceeds ${MAX_PAGES} pages. The original is retained for manual review.`);
  const pages=[];let total=0;
  for(let pageNo=1;pageNo<=pdf.numPages;pageNo++){
   const page=await pdf.getPage(pageNo),content=await page.getTextContent(),text=textFromItems(content.items),viewport=page.getViewport({scale:1});
   if(text.length>MAX_PAGE_TEXT||(total+=text.length)>MAX_TEXT)throw Error('PDF text exceeds the automatic reading limit. The original is retained for manual review.');
   pages.push({page:pageNo,text,width:viewport.width,height:viewport.height,fragments:content.items.filter(item=>typeof item.str==='string'&&item.str.trim()&&Number.isFinite(item.transform?.[4])&&Number.isFinite(item.transform?.[5])).map(item=>({text:item.str,x:item.transform[4],y:item.transform[5]}))});
   page.cleanup();
  }
  return pages;
 }finally{await task.destroy().catch(()=>{});}
}
