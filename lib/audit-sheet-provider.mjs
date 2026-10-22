export function auditSheetProvider(token,fetcher=fetch,{beforeRequest=async()=>{},sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 const request=async(path,options={})=>{
  for(let attempt=0;;attempt++){
  await beforeRequest(options.method||'GET');
  const response=await fetcher('https://sheets.googleapis.com/v4/spreadsheets/'+path,{...options,headers:{...options.headers,Authorization:'Bearer '+token},signal:AbortSignal.timeout(options.method==='POST'?60000:20000)});
  if(!response.ok){
   const body=await response.json().catch(()=>null),googleError=body?.error||{},details=Array.isArray(googleError.details)?googleError.details:[],reasons=[...new Set(details.map(detail=>detail?.reason).filter(reason=>typeof reason==='string'&&/^[A-Za-z0-9_]{1,60}$/.test(reason)))],disabled=reasons.includes('SERVICE_DISABLED'),message=typeof googleError.message==='string'?googleError.message.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,240):'',status=typeof googleError.status==='string'&&/^[A-Z0-9_]{1,60}$/.test(googleError.status)?googleError.status:null;
   // Reads are safe to retry. Never replay an append or other write after an
   // error: its outcome can be uncertain; the next sync reads and deduplicates.
   if(!options.method&&attempt<3&&(response.status===429||reasons.includes('RATE_LIMIT_EXCEEDED')||response.status>=500)){
    const retryAfter=Number(response.headers.get('retry-after'));
    await sleep(Math.min(30000,Math.max(1000,retryAfter>0?retryAfter*1000:(response.status===429||reasons.includes('RATE_LIMIT_EXCEEDED')?10000:1000)*2**attempt)));
    continue;
   }
   let explanation;
   if(disabled)explanation='Enable Google Sheets API in your Google Cloud project, then retry this saved export.';
   else if(response.status===401)explanation='Reconnect Google in Settings, then retry this export.';
   else if(response.status===403)explanation='Google Sheets denied access'+(status?' ('+status+')':'')+(reasons.length?' [reason: '+reasons.join(', ')+']':'')+(message?': '+message:'')+'. Check the indicated permission or sheet protection, then retry.';
   else explanation='Google Sheets request failed ('+response.status+')'+(status?' '+status:'')+(reasons.length?' [reason: '+reasons.join(', ')+']':'')+(message?': '+message:'')+'. Retry this saved export.';
   throw Object.assign(Error(explanation),{providerStatus:response.status,googleStatus:status,googleReasons:reasons});
  }
  return response.json();
  }
 };
 return {
  metadata:id=>request(encodeURIComponent(id)+'?fields=spreadsheetId,spreadsheetUrl,sheets(properties(sheetId,title,gridProperties),conditionalFormats)'),
  write:(id,requests)=>request(encodeURIComponent(id)+':batchUpdate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requests})}),
  read:(id,ranges)=>{const params=new URLSearchParams({valueRenderOption:'UNFORMATTED_VALUE'});for(const range of ranges)params.append('ranges',range);return request(encodeURIComponent(id)+'/values:batchGet?'+params);},
  append:(id,range,values)=>request(encodeURIComponent(id)+'/values/'+encodeURIComponent(range)+':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS&includeValuesInResponse=true&responseValueRenderOption=UNFORMATTED_VALUE',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({majorDimension:'ROWS',values})})
 };
}
