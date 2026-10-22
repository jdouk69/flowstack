import {PDFDocument} from 'pdf-lib';
// Collection may leave page metadata unknown. Confirm the preserved original,
// rather than accepting a submitted preview's length as the PDF page count.
export async function sourcePageCount(source,bucket){
 if(Number.isInteger(source.pages)&&source.pages>0)return source.pages;
 if(!bucket||!source.key)throw Error('Original PDF page count could not be verified. The source remains stored; no draft was prepared.');
 const object=await bucket.get(source.key);
 if(!object)throw Error('The preserved original PDF is unavailable. No draft was prepared.');
 if(object.size>10*1024*1024)throw Error('Page verification supports originals up to 10 MB.');
 try{return (await PDFDocument.load(await object.arrayBuffer())).getPageCount();}
 catch{throw Error('The preserved PDF is encrypted or unreadable. No draft was prepared.');}
}
