// The inspected Tournas footer prints its currency as image artwork. Text-only
// extraction misses it. Read that actual image, never infer currency by country.
export const CURRENCY_REGION={left:.727,top:.849,right:.925,bottom:.878};
// Remove long table rules from this tiny OCR crop, never from the stored PDF.
export function cleanCurrencyCrop(canvas){
 const ctx=canvas.getContext('2d'),im=ctx.getImageData(0,0,canvas.width,canvas.height),{data}=im,w=canvas.width,h=canvas.height;
 const dark=(x,y)=>data[(y*w+x)*4]<128&&data[(y*w+x)*4+1]<128&&data[(y*w+x)*4+2]<128;
 const xs=[],ys=[];for(let x=0;x<w;x++){let n=0;for(let y=0;y<h;y++)if(dark(x,y))n++;if(n/h>.75)xs.push(x);}
 for(let y=0;y<h;y++){let n=0;for(let x=0;x<w;x++)if(dark(x,y))n++;if(n/w>.75)ys.push(y);}
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(xs.some(n=>Math.abs(n-x)<=1)||ys.some(n=>Math.abs(n-y)<=1)){const i=(y*w+x)*4;data[i]=data[i+1]=data[i+2]=255;data[i+3]=255;}
 ctx.putImageData(im,0,0);
}
export function currencyFromOcr(data,{page,total}){
 const words=(data?.blocks||[]).flatMap(b=>b.paragraphs||[]).flatMap(p=>p.lines||[]).flatMap(l=>l.words||[]);
 const symbol=words.find(w=>w.text.trim()==='€'&&Number.isFinite(w.confidence)&&w.confidence>=80);
 const digits=s=>String(s??'').replace(/[^0-9]/g,'');
 const amount=words.find(w=>/^[0-9][0-9.,]*$/.test(w.text)&&digits(w.text)===digits(total)&&digits(total).length>=3);
 if(!symbol||!amount)return null;
 return {currency:'EUR',printed:'€',source_page:page,method:'footer-image-ocr',confidence:symbol.confidence,printed_total_ocr:amount.text,region:CURRENCY_REGION,needs_source_review:true};
}
export async function recognizePrintedCurrency(source,page,{pdfjs,createCanvas,recognize,signal,renderScale=2}){
 const {parseTournasPage}=await import('./suppliers/tournas.mjs');
 const parsed=parseTournasPage(page);
 if(!['invoice','service_invoice','retail_receipt'].includes(parsed.document_type)||!parsed.invoice_total||parsed.currency||page.width<590||page.width>600||page.height<835||page.height>845)return null;
 if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
 const viewport=source.getViewport({scale:renderScale});
 const r=CURRENCY_REGION,x=Math.floor(viewport.width*r.left),y=Math.floor(viewport.height*r.top);
 const canvas=createCanvas(Math.ceil(viewport.width*(r.right-r.left)),Math.ceil(viewport.height*(r.bottom-r.top)));
 const render=source.render({canvasContext:canvas.getContext('2d'),viewport,transform:[1,0,0,1,-x,-y],background:'white'});
 const cancel=()=>render.cancel();signal?.addEventListener('abort',cancel,{once:true});
 try{await render.promise;cleanCurrencyCrop(canvas);const data=await recognize(canvas);return currencyFromOcr(data,{page:page.page,total:parsed.invoice_total});}
 finally{signal?.removeEventListener('abort',cancel);canvas.width=0;canvas.height=0;}
}
