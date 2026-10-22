// Called directly from a click with an already-generated File. Do not fetch or
// generate the PDF here: native sharing requires the click's user activation.
export async function sendReviewFile(file,{navigator,download,open}) {
 if(!file) return 'failed';
 let supported=false;
 try { supported=typeof navigator?.share==='function'&&typeof navigator?.canShare==='function'&&navigator.canShare({files:[file]}); } catch {}
 if(!supported){try{download(file);open();return 'fallback';}catch{return 'failed';}}
 try {await navigator.share({files:[file],title:'FlowStack review PDF'});return 'shared';}
 catch(error){return error?.name==='AbortError'?'cancelled':'failed';}
}
