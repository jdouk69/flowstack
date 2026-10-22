import {previewCollection,previewCriteria} from './collection-preview.mjs';
export const GOOGLE_SCOPES=['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/drive.readonly','https://www.googleapis.com/auth/drive.file','https://www.googleapis.com/auth/spreadsheets'];
const origin='https://flowstack.jimdoukakis.chatgpt.site';
export const GOOGLE_CALLBACK=origin+'/api/flow/google/callback';
const encode=bytes=>btoa(String.fromCharCode(...bytes));
const decode=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
const random=()=>encode(crypto.getRandomValues(new Uint8Array(32))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});
const redirect=message=>new Response(null,{status:303,headers:{Location:origin+'/settings?google='+message,'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});
export function googleRefreshMessage(issue){
 if(issue==='invalid_grant')return 'Google rejected the saved refresh authorization. Reconnect Google in Settings. If reconnecting fails, check the OAuth client credentials.';
 if(issue==='invalid_client')return 'Google rejected the OAuth client credentials. Check the client ID and secret in Settings.';
 if(issue==='unauthorized_client')return 'Google says this OAuth client is not authorized to refresh access. Check the OAuth client setup in Google Cloud.';
 return 'Google authorization could not be refreshed. Reconnect Google in Settings.';
}
export async function seal(value,key,aad){const secret=await crypto.subtle.importKey('raw',decode(key),'AES-GCM',false,['encrypt']);const iv=crypto.getRandomValues(new Uint8Array(12));const bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(aad)},secret,new TextEncoder().encode(JSON.stringify(value)));return JSON.stringify({iv:encode(iv),cipher:encode(new Uint8Array(bytes))});}
export async function unseal(value,key,aad){const data=JSON.parse(value),secret=await crypto.subtle.importKey('raw',decode(key),'AES-GCM',false,['decrypt']);const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(data.iv),additionalData:new TextEncoder().encode(aad)},secret,decode(data.cipher));return JSON.parse(new TextDecoder().decode(bytes));}
// Shared server-only access refresh; decrypted credentials never leave the server.
export async function googleAccess({owner,db,key,fetcher=fetch}) {
 if(!key)throw Object.assign(Error('Google connection setup is unavailable.'),{status:503});
 const get=async kind=>{const row=await db.prepare("SELECT data FROM records WHERE id=? AND owner=? AND entity='GooglePrivate'").bind('google:'+kind+':'+owner,owner).first();return row?unseal(row.data,key,owner+':'+kind):null;};
 let tokens=await get('tokens');if(!tokens)throw Object.assign(Error('Connect Google in Settings before running this workflow.'),{status:409});
 if(tokens.expires<Date.now()+60000){
  const config=await get('config');if(!config)throw Error('Reconnect Google in Settings.');
  const r=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.client_id,client_secret:config.client_secret,refresh_token:tokens.refresh_token,grant_type:'refresh_token'}),signal:AbortSignal.timeout(15000)});
  if(!r.ok){const result=await r.json().catch(()=>null);const issue=['invalid_grant','invalid_client','unauthorized_client'].includes(result?.error)?result.error:null;throw Object.assign(Error(googleRefreshMessage(issue)),{status:502,googleIssue:issue||'refresh_failed'});}
  const t=await r.json();if(typeof t.access_token!=='string')throw Error('Google returned no access token.');
  tokens={...tokens,...t,refresh_token:t.refresh_token||tokens.refresh_token,expires:Date.now()+(Number(t.expires_in)||0)*1000};
  await db.prepare("UPDATE records SET data=?,updated=? WHERE id=? AND owner=? AND entity='GooglePrivate'").bind(await seal(tokens,key,owner+':tokens'),new Date().toISOString(),'google:tokens:'+owner,owner).run();
 }
 return tokens;
}
export async function googleRoute(req,{owner,db,key,fetcher=fetch}){
 const url=new URL(req.url),action=url.pathname.split('/').at(-1);
 if(!key)return json({error:'Google connection setup is unavailable.'},503);
 if(req.method!=='GET'&&req.headers.get('origin')!==url.origin)return json({error:'Invalid request origin'},403);
 const recordId=kind=>'google:'+kind+':'+owner;
 const get=async kind=>{const row=await db.prepare("SELECT data FROM records WHERE id=? AND owner=? AND entity='GooglePrivate'").bind(recordId(kind),owner).first();return row?unseal(row.data,key,owner+':'+kind):null;};
 const save=async(kind,data)=>{const now=new Date().toISOString();await db.prepare("INSERT INTO records(id,owner,entity,data,created,updated) VALUES(?,?,'GooglePrivate',?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated WHERE records.owner=excluded.owner").bind(recordId(kind),owner,await seal(data,key,owner+':'+kind),now,now).run();};
 const remove=kind=>db.prepare("DELETE FROM records WHERE id=? AND owner=? AND entity='GooglePrivate'").bind(recordId(kind),owner).run();
 const api=async(endpoint,token,options={})=>{const response=await fetcher(endpoint,{...options,headers:{...options.headers,Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('Google request failed');return response.json();};
 const tokenRequest=async params=>{const r=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(params),signal:AbortSignal.timeout(20000)});if(!r.ok){const result=await r.json().catch(()=>null);const issue=(['invalid_client','unauthorized_client','invalid_grant'].includes(result?.error)?result.error:'token_exchange_failed');throw Object.assign(Error('Google authorization failed'),{googleIssue:issue});}const t=await r.json();if(typeof t.access_token!=='string')throw Error('Google returned no access token');return t;};
 if(action==='status'&&req.method==='GET'){const config=await get('config'),tokens=await get('tokens');const granted=new Set(String(tokens?.scope||'').split(' '));return json({configured:!!config,connected:!!tokens,email:tokens?.email||null,spreadsheet_authorized:granted.has('https://www.googleapis.com/auth/spreadsheets'),callback:GOOGLE_CALLBACK,read_only_test:true});}
 if(action==='configure'&&req.method==='POST'){
  const raw=await req.text();if(raw.length>5000)return json({error:'Invalid credentials'},400);let data;try{data=JSON.parse(raw);}catch{return json({error:'Invalid credentials'},400);}
  if(typeof data.client_id!=='string'||!/^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(data.client_id)||typeof data.client_secret!=='string'||data.client_secret.length<15||data.client_secret.length>300||/[\s\x00-\x1f]/.test(data.client_secret))return json({error:'Paste the complete Google client ID and secret.'},400);
  if(await get('tokens'))return json({error:'Disconnect Google before replacing credentials.'},409);
  await save('config',{client_id:data.client_id,client_secret:data.client_secret});await remove('state');return json({ok:true});
 }
 if(action==='start'&&req.method==='POST'){
  const config=await get('config');if(!config)return json({error:'Save your Google client credentials first.'},409);
  const state=random(),verifier=random(),challenge=encode(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
  await save('state',{state,verifier,expires:Date.now()+10*60*1000});
  const target=new URL('https://accounts.google.com/o/oauth2/v2/auth');target.search=new URLSearchParams({client_id:config.client_id,redirect_uri:GOOGLE_CALLBACK,response_type:'code',scope:GOOGLE_SCOPES.join(' '),state,code_challenge:challenge,code_challenge_method:'S256',access_type:'offline',prompt:'consent',login_hint:'jimdoukakis@gmail.com'}).toString();return json({url:target.toString()});
 }
 if(action==='callback'&&req.method==='GET'){
  const row=await db.prepare("SELECT data FROM records WHERE id=? AND owner=? AND entity='GooglePrivate'").bind(recordId('state'),owner).first();if(!row)return redirect('invalid_state');
  const state=await unseal(row.data,key,owner+':state');if(!url.searchParams.get('state')||state.state!==url.searchParams.get('state')||state.expires<Date.now())return redirect('invalid_state');
  const consumed=await db.prepare("DELETE FROM records WHERE id=? AND owner=? AND data=? RETURNING id").bind(recordId('state'),owner,row.data).first();if(!consumed)return redirect('invalid_state');
  if(url.searchParams.has('error'))return redirect('cancelled');
  const code=url.searchParams.get('code');if(!code||code.length>3000)return redirect('failed');
  let stage='token_exchange_failed';try{const config=await get('config');if(!config)return redirect('failed');const tokens=await tokenRequest({client_id:config.client_id,client_secret:config.client_secret,code,code_verifier:state.verifier,redirect_uri:GOOGLE_CALLBACK,grant_type:'authorization_code'});const scopes=new Set((tokens.scope||'').split(' '));if(!GOOGLE_SCOPES.every(scope=>scopes.has(scope))||typeof tokens.refresh_token!=='string')return redirect('missing_permissions');
   stage='gmail_access_failed';const profile=await api('https://gmail.googleapis.com/gmail/v1/users/me/profile',tokens.access_token);if(profile.emailAddress?.toLowerCase()!=='jimdoukakis@gmail.com')return redirect('wrong_account');
   stage='connection_save_failed';await save('tokens',{...tokens,email:profile.emailAddress,expires:Date.now()+Math.max(0,Number(tokens.expires_in)||0)*1000});return redirect('connected');
  }catch(error){return redirect(error?.googleIssue||stage);}
 }
 const freshTokens=async()=>{try{return await googleAccess({owner,db,key,fetcher});}catch(e){if(e.status===409)return null;throw e;}};
 if(action==='check'&&req.method==='POST'){
  const checkedAt=new Date().toISOString();
  const attention=message=>json({status:'Needs attention',message,checked_at:checkedAt});
  let body;try{const raw=await req.text();if(raw.length>1000)throw Error();body=JSON.parse(raw);if(!body||typeof body!=='object'||Array.isArray(body))throw Error();}catch{return attention('The requested check was invalid. Choose one of the listed connection checks.');}
  const allowed=new Set(['gmail','drive','spreadsheet']);if(!allowed.has(body.kind)||(['drive','spreadsheet'].includes(body.kind)&&!['Tournas','Akron','Ergobeton'].includes(body.supplier)))return attention('The requested check was invalid. Choose one of the listed connection checks.');
  const tokenRow=await get('tokens');if(!tokenRow)return attention('Google is not connected. Connect Google in Settings, then retry this check.');
  if(!tokenRow.access_token||!Number.isFinite(Number(tokenRow.expires))||Number(tokenRow.expires)<=Date.now())return attention('The saved Google access token has expired. Reconnect Google in Settings, then retry this check.');
  const checkFetch=async url=>{let response;try{response=await fetcher(url,{headers:{Authorization:'Bearer '+tokenRow.access_token},signal:AbortSignal.timeout(15000)});}catch{return {error:'Google could not be reached. Check your internet connection and retry.'};}if(response.ok){try{return {data:await response.json()};}catch{return {error:'Google returned an unreadable response. Retry this check.'};}}if(response.status===401)return {error:'Google rejected the saved access token. Reconnect Google in Settings, then retry.'};if(response.status===403)return {error:'Google denied read access to this item. Check the Google permission and retry.'};if(response.status===404)return {error:'Google could not find or open the saved item. Confirm the existing folder or spreadsheet in Drive.'};if(response.status===429)return {error:'Google is temporarily limiting requests. Wait a moment and retry this check.'};return {error:'Google could not complete the read-only check ('+response.status+'). Retry this check.'};};
  try{
   if(body.kind==='gmail'){
    const result=await checkFetch('https://gmail.googleapis.com/gmail/v1/users/me/profile');if(result.error)return attention(result.error);
    if(result.data?.emailAddress?.toLowerCase()!==String(tokenRow.email||'').toLowerCase())return attention('Gmail responded, but the account does not match the connected Google account. Reconnect the intended account.');
    return json({status:'Pass',message:'Gmail access is working for '+result.data.emailAddress+'. No email was opened or changed.',checked_at:checkedAt});
   }
   const rows=(await db.prepare("SELECT id,data FROM records WHERE owner=? AND entity='Supplier' ORDER BY created,id").bind(owner).all()).results||[];
   const pattern={Tournas:/tournas|τουρνα/i,Akron:/akron/i,Ergobeton:/ergobeton/i}[body.supplier];
   const matches=rows.map(row=>({id:row.id,...JSON.parse(row.data)})).filter(row=>pattern.test(String(row.name||'')));
   if(body.kind==='drive'){
    if(matches.length!==1)return attention(matches.length?'More than one matching supplier workflow was found. Review the workflow names before checking a folder.':'No matching supplier workflow was found. Set up the supplier workflow before checking its Drive folder.');
    const folderId=matches[0].drive_folder_id;if(!folderId)return attention('No existing Drive folder ID is saved for '+body.supplier+'. This check did not search for or create a folder.');
    const result=await checkFetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(folderId)+'?fields=id,name,mimeType,trashed&supportsAllDrives=true');if(result.error)return attention(result.error);
    const folder=result.data;if(folder.id!==folderId||folder.mimeType!=='application/vnd.google-apps.folder'||folder.trashed)return attention('The saved '+body.supplier+' Drive reference is not an available folder. No changes were made.');
    return json({status:'Pass',message:'The existing '+body.supplier+' supplier folder “'+String(folder.name||body.supplier).replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,120)+'” is available for read access. No files were listed or changed.',checked_at:checkedAt});
   }
   let spreadsheetId=body.supplier==='Tournas'?'1kWKSJBUTms912f1kZyGmNkpasVNDMX62Iz3HnqkYPCc':null;
   if(matches.length>1)return attention('More than one matching supplier workflow was found. Review the workflow names before checking a master spreadsheet.');
   if(body.supplier!=='Tournas'&&matches.length===1){
    spreadsheetId=matches[0].master_id||null;
    if(!spreadsheetId){const vendorMaster=await db.prepare("SELECT data FROM records WHERE id=? AND owner=? AND entity='VendorMaster'").bind('vendor-master:'+owner+':'+matches[0].id,owner).first();if(vendorMaster)spreadsheetId=JSON.parse(vendorMaster.data).spreadsheet_id||null;}
   }
   if(!spreadsheetId)return attention('No existing master spreadsheet ID is saved for '+body.supplier+'. This check did not create or initialize a spreadsheet.');
   const result=await checkFetch('https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(spreadsheetId)+'?fields=spreadsheetId,properties(title),sheets(properties(title))');if(result.error)return attention(result.error);
   if(result.data.spreadsheetId!==spreadsheetId)return attention('Google returned a different spreadsheet reference. Check the saved '+body.supplier+' master ID.');
   const title=String(result.data.properties?.title||body.supplier+' master spreadsheet').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,120);
   return json({status:'Pass',message:'The existing '+body.supplier+' master spreadsheet “'+title+'” is available. Its tab list was read; no cells or rows were changed.',checked_at:checkedAt});
  }catch{return attention('The read-only check could not be completed. Reconnect Google or verify the saved '+(body.kind==='drive'?'folder':body.kind==='spreadsheet'?'spreadsheet':'Gmail')+' access, then retry.');}
 }
 if(action==='preview'&&req.method==='POST'){
  let criteria;try{const raw=await req.text();if(raw.length>6000)throw Error('Search criteria too large.');criteria=JSON.parse(raw);previewCriteria(criteria);}catch(e){return json({error:e.message||'Invalid search criteria'},400);}
  let tokens;try{tokens=await freshTokens();}catch(error){return json({error:googleRefreshMessage(error?.googleIssue)},502);}
  if(!tokens)return json({error:'Connect Google in Settings before searching this workflow.'},409);
  const signal=AbortSignal.timeout(45000);
  const gmail=async(path)=>{const r=await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/'+path,{headers:{Authorization:'Bearer '+tokens.access_token},signal});if(!r.ok)throw Error(r.status===401?'Gmail authorization expired. Reconnect Google in Settings.':r.status===403?'Gmail denied access. Check Gmail API and granted permissions in your Google Cloud project.':r.status===429?'Gmail rate limit reached. Wait a moment and retry.':'Gmail search failed. Try again.');return r.json();};
  try{const result=await previewCollection(criteria,{
   search:async({query,maxResults,pageToken})=>{const params=new URLSearchParams({q:query,maxResults:String(maxResults)});if(pageToken)params.set('pageToken',pageToken);const response=await gmail('messages?'+params);if(!response||typeof response!=='object'||response.error)throw Error('Invalid Gmail search response.');return {...response,messages:response.messages===undefined?[]:response.messages};},
   read:id=>gmail('messages/'+encodeURIComponent(id)+'?format=full')
  });return json({...result,query:previewCriteria(criteria).query,email:tokens.email,read_only:true});}
  catch(e){return json({error:e.name==='TimeoutError'||signal.aborted?'Gmail search timed out. Narrow this workflow’s search and try again.':e.message},502);}
 }
 if(action==='disconnect'&&req.method==='POST'){
  const tokens=await get('tokens');let revoked=!tokens;if(tokens){try{const r=await fetcher('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:tokens.refresh_token}),signal:AbortSignal.timeout(20000)});revoked=r.ok;}catch{}}
  await remove('tokens');await remove('state');return json({ok:true,revoked,message:revoked?'Disconnected.':'Local connection removed. Google revocation was not confirmed; remove access in your Google account.'});
 }
 return json({error:'Not found'},404);
}
