// Read every page in the chosen folder before making a fixed selection. Never
// truncate a larger selection silently or collect/change any files here.
export async function selectReadyDocuments({documents,cursor,workflow='',request,isReady,signal}){
 const all=[...documents],seen=new Set();let next=cursor,pages=0;
 while(next){
  if(seen.has(next))throw Error('File pagination repeated. Refresh before selecting files.');seen.add(next);
  const q=new URLSearchParams({page:'1',limit:'100',type:'pdf',cursor:next});if(workflow)q.set('workflow',workflow==='__unassigned__'?'':workflow);
  const page=await request('/documents?'+q,{signal});all.push(...page.documents);next=page.next_cursor;
  if(++pages>=200&&next)throw Error('Too many files in this view. Choose a supplier workflow or use individual selection.');
 }
 const unique=[...new Map(all.map(d=>[d.id,d])).values()],chosen=unique.filter(isReady);
 if(chosen.length>1000)throw Error('More than 1,000 ready originals match. Choose a smaller workflow or select up to 1,000 individual files for this run.');
 return {documents:unique,selected:chosen.map(d=>d.id)};
}
