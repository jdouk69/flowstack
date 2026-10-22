const MB=1024*1024;
export function planPdfParts(files,{targetBytes=18*MB,maxFiles=20,maxFileBytes=10*MB}={}){
 if(!Array.isArray(files)||!files.length||files.length>2000)throw Error('Choose between 1 and 2,000 filtered original PDFs.');
 const seen=new Set(),parts=[];let current=[];
 const flush=()=>{if(current.length){parts.push(current);current=[];}};
 for(const f of files){
  const size=Number(f.size);if(!f.id||seen.has(f.id))throw Error('Refresh the folder: duplicate or missing source IDs.');seen.add(f.id);
  if(!Number.isSafeInteger(size)||size<=0||typeof f.md5_checksum!=='string'||!f.md5_checksum)throw Error('Refresh the folder: PDF size or checksum is unavailable for '+f.name+'.');
  if(size>maxFileBytes||size>targetBytes)throw Error(f.name+' exceeds the 10 MB per-original import limit. No batch was started; use a Drive reference or select smaller originals.');
  if(current.length>=maxFiles||current.reduce((n,item)=>n+item.size,0)+size>targetBytes)flush();
  current.push({id:f.id,name:f.name,size,md5:f.md5_checksum});
 }
 flush();
 const last=parts.at(-1),previous=parts.at(-2);
 if(last?.length===1&&previous?.length>=3&&previous.at(-1).size+last[0].size<=targetBytes)last.unshift(previous.pop());
 return {parts:parts.map((items,index)=>({number:index+1,items,size:items.reduce((n,f)=>n+f.size,0),kind:items.length===1?'original':'merge'})),source_count:files.length,total_bytes:files.reduce((n,f)=>n+Number(f.size),0),target_bytes:targetBytes};
}
export async function runMergeParts({parts,start=0,execute,onResult=()=>{},shouldStop=()=>false}){
 let index=start;
 for(;index<parts.length;index++){
  if(shouldStop())break;
  try{const result=await execute(parts[index]);await onResult(result,index);}catch(error){error.part_index=index;throw error;}
 }
 return {next_index:index,complete:index===parts.length,stopped:index<parts.length};
}
