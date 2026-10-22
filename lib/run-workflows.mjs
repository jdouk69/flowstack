// Execute saved workflows serially; each server job keeps its own durable cursor.
export async function runWorkflows({workflows,invoke,onProgress=()=>{},cancelled=()=>false,mode='full',retryFailed=false}){
 const completed=[];
 const aggregate=current=>{
  const results=[...completed,...(current?.results||[])];const totals={};
  for(const r of results)for(const [k,v] of Object.entries(r))if(typeof v==='number')totals[k]=(totals[k]||0)+v;
  totals.error_details=results.flatMap(r=>r.error_details||[]);
  return {results,totals};
 };
 if(!workflows.length)throw Error('No saved workflows to run.');
 for(const workflow of workflows){
  if(cancelled())return null;
  let data,jobId;
  do{
   const response=await invoke({supplier_id:workflow.id,...(mode!=='full'?{mode}:{}),...(retryFailed?{retry_failed:true}:{}),...(jobId?{job_id:jobId}:{})});data=response.data;jobId=data.job_id;
   if(cancelled())return null;
   onProgress(aggregate(data));
  }while(data.needs_continue);
  completed.push(...data.results);
 }
 return aggregate();
}
