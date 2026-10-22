import {sourcePageCount} from './source-pages.mjs';
import {extractionCaptureDraft} from './capture-draft.mjs';
import {validatePages} from './suggestions.mjs';
import {analyzePages} from './suppliers/tournas.mjs';
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function documentAnalysis(req,{db,bucket,owner,id}){
 const record=await db.prepare("SELECT * FROM records WHERE id=? AND owner=? AND entity='Document'").bind(id,owner).first();if(!record)return json({error:'Source document not found'},404);
 const source=JSON.parse(record.data);if(source.storage_kind==='drive_reference')return json({error:'Large Drive PDF extraction is not available yet. The original remains in Drive.'},409);if(source.file_type!=='pdf'&&source.mime_type!=='application/pdf')return json({error:'Choose a source PDF'},400);
 const saved=await db.prepare('SELECT * FROM document_analysis WHERE owner=? AND document_id=?').bind(owner,id).first();
 const publicResult=row=>row?{revision:row.revision,pages:JSON.parse(row.pages),analysis:JSON.parse(row.analysis),updated:row.updated}:null;
 if(req.method==='GET'&&new URL(req.url).searchParams.get('capture')==='1'){try{const pages=saved?await sourcePageCount(source,bucket):source.pages;return json({draft:extractionCaptureDraft({...source,pages},saved)});}catch(error){return json({error:error.message},409);}}
 if(req.method==='GET')return json({source:{id,name:source.name,pages:source.pages,size:source.size},result:publicResult(saved)});
 if(req.method!=='POST')return json({error:'Unsupported operation'},405);
 if(Number(req.headers.get('content-length')||0)>4*1024*1024)return json({error:'PDF text is too large.'},413);
 let body;try{body=validatePages(await req.json());}catch(error){return json({error:error.message},400);}
 let actualPages;try{actualPages=await sourcePageCount(source,bucket);}catch(error){return json({error:error.message},422);}
 if(body.pages.length!==actualPages)return json({error:'Read all original PDF pages before saving text.'},400);
 if((saved?.revision??0)!==body.revision)return json({error:'Preview changed in another tab. Refresh before saving.'},409);
 const analysis=analyzePages(body.pages,body.template),marker=crypto.randomUUID(),time=new Date().toISOString();
 const pagesJson=JSON.stringify(body.pages),analysisJson=JSON.stringify(analysis);
 if(new TextEncoder().encode(pagesJson).length>1500000||new TextEncoder().encode(analysisJson).length>1500000)return json({error:'This preview exceeds the storage limit. No partial analysis was saved; use smaller source PDFs.'},413);
 const result=await db.batch([
 db.prepare("INSERT INTO document_analysis(owner,document_id,pages,analysis,revision,marker,created,updated) SELECT ?,?,?,?,1,?,?,? WHERE EXISTS(SELECT 1 FROM records WHERE owner=? AND id=? AND entity='Document') ON CONFLICT(owner,document_id) DO UPDATE SET pages=excluded.pages,analysis=excluded.analysis,revision=document_analysis.revision+1,marker=excluded.marker,updated=excluded.updated WHERE document_analysis.revision=?").bind(owner,id,pagesJson,analysisJson,marker,time,time,owner,id,body.revision),
 db.prepare('INSERT INTO document_analysis_versions(owner,document_id,revision,pages,analysis,created) SELECT owner,document_id,revision,pages,analysis,updated FROM document_analysis WHERE owner=? AND document_id=? AND marker=?').bind(owner,id,marker)
 ]);
 if(!result[0].meta.changes)return json({error:'The preview changed. Refresh before saving.'},409);
 return json({source:{id,name:source.name,pages:source.pages,size:source.size},result:publicResult(await db.prepare('SELECT * FROM document_analysis WHERE owner=? AND document_id=?').bind(owner,id).first())});
}
