import {combinedReportUrl} from './report-batches.mjs';
export const reportName=(supplier='',date=new Date())=>'FlowStack '+(supplier? supplier[0].toUpperCase()+supplier.slice(1):'Supplier')+' Audit — Draft — '+new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
// Export only completed runs; failed sources remain in the scoped coverage tab.
// Export errors retain their server-side snapshot so a retry cannot duplicate it.
export async function exportAnalysisReport({result,template,request,onProgress=()=>{}}){
 if(result.stopped||!result.batch_ids?.length)return {skipped:true};
 const reportUrl=combinedReportUrl(result.batch_ids),query=reportUrl.split('?')[1];
 onProgress('Preparing combined draft report…');
 const report=await request('/reports?'+query);
 if(!report.rows.length)return {reportUrl,empty:true};
 onProgress('Saving and verifying your report in Google Drive…');
 const {workbook}=await request('/audit-workbooks',{method:'POST',body:JSON.stringify({name:reportName(template),query,include_drafts:true})});
 return {reportUrl,workbook};
}
