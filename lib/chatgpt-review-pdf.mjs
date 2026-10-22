import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';
import {reviewInstructions} from './chatgpt-review.mjs';
export async function reviewPdf(batch,files){
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);let page,y;
 const add=()=>{page=pdf.addPage([595,842]);y=800;};
 const text=value=>{for(const paragraph of String(value).replace(/[^\x20-\x7e\n]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')).split('\n')){for(let start=0;start<paragraph.length||start===0;start+=88){if(!page||y<45)add();page.drawText(paragraph.slice(start,start+88),{x:35,y,size:10,font,color:rgb(.1,.15,.25)});y-=15;}}};
 text('FLOWSTACK - REVIEW WITH CHATGPT');text('Instructions and original invoice pages follow.');text(reviewInstructions(batch));let total=0;
 for(const source of batch.sources){const bytes=files.get(source.document_id);if(!bytes)throw Error('A source PDF could not be loaded.');const original=await PDFDocument.load(bytes);total+=original.getPageCount();if(total>150)throw Error('This review exceeds 150 source pages. Choose fewer PDFs.');add();text('SOURCE DOCUMENT ID: '+source.document_id);text('Original filename: '+source.name);if(source.review_context?.resubmitted){text('RESENT FOR REVIEW - PREVIOUSLY SKIPPED');text('Previous document type: '+(source.review_context.previous_document_kind||'unknown'));text('Previous skip reason: '+source.review_context.previous_reason);text('Recheck the original. Explain whether the previous skip was correct and what to do next.');}text('The next '+original.getPageCount()+' pages are this source. Number them starting at 1.');for(const copied of await pdf.copyPages(original,original.getPageIndices()))pdf.addPage(copied);page=null;}
 pdf.setTitle('FlowStack ChatGPT review '+batch.id);pdf.setCreator('FlowStack');return pdf.save();
}
