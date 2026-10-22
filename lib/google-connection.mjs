import {previewCollection,previewCriteria} from './collection-preview.mjs';
export const GOOGLE_SCOPES=['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/drive.readonly','https://www.googleapis.com/auth/drive.file','https://www.googleapis.com/auth/spreadsheets'];
const origin='https://flowstack.jimdoukakis.chatgpt.site';
export const GOOGLE_CALLBACK=origin+'/api/flow/google/callback';
const encode=bytes=>btoa(String.fromCharCode(...bytes));
const decode=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
const random=()=>encode(crypto.getRandomValues(new Uint8Array(32))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});
const redirect=message=>new Response(null,{status:303,headers:{Location:origin+'/settings?google='+message,'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});
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
  if(!r.ok)throw Error('Google authorization could not be refreshed. Reconnect Google in Settings.');
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
 if(action==='preview'&&req.method==='POST'){
  let criteria;try{const raw=await req.text();if(raw.length>6000)throw Error('Search criteria too large.');criteria=JSON.parse(raw);previewCriteria(criteria);}catch(e){return json({error:e.message||'Invalid search criteria'},400);}
  let tokens;try{tokens=await freshTokens();}catch{return json({error:'Google authorization expired or could not be refreshed. Reconnect Google in Settings.'},502);}
  if(!tokens)return json({error:'Connect Google in Settings before searching this workflow.'},409);
  const signal=AbortSignal.timeout(45000);
  const gmail=async(path)=>{const r=await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/'+path,{headers:{Authorization:'Bearer '+tokens.access_token},signal});if(!r.ok)throw Error(r.status===401?'Gmail authorization expired. Reconnect Google in Settings.':r.status===403?'Gmail denied access. Check Gmail API and granted permissions in your Google Cloud project.':r.status===429?'Gmail rate limit reached. Wait a moment and retry.':'Gmail search failed. Try again.');return r.json();};
  try{const result=await previewCollection(criteria,{
   search:async({query,maxResults,pageToken})=>{const params=new URLSearchParams({q:query,maxResults:String(maxResults)});if(pageToken)params.set('pageToken',pageToken);const response=await gmail('messages?'+params);if(!response||typeof response!=='object'||response.error)throw Error('Invalid Gmail search response.');return {...response,messages:response.messages===undefined?[]:response.messages};},
   read:id=>gmail('messages/'+encodeURIComponent(id)+'?format=full')
  });return json({...result,query:previewCriteria(criteria).query,email:tokens.email,read_only:true});}
  catch(e){return json({error:e.name==='TimeoutError'||signal.aborted?'Gmail search timed out. Narrow this workflow’s search and try again.':e.message},502);}
 }
 if(action==='test'&&req.method==='POST'){
  let tokens=await get('tokens');if(!tokens)return json({error:'Connect Google first.'},409);
  try{if(tokens.expires<Date.now()+60000){const config=await get('config');const refreshed=await tokenRequest({client_id:config.client_id,client_secret:config.client_secret,refresh_token:tokens.refresh_token,grant_type:'refresh_token'});tokens={...tokens,...refreshed,refresh_token:refreshed.refresh_token||tokens.refresh_token,expires:Date.now()+(Number(refreshed.expires_in)||0)*1000};await save('tokens',tokens);}
   const profile=await api('https://gmail.googleapis.com/gmail/v1/users/me/profile',tokens.access_token);const files=await api('https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id),nextPageToken',tokens.access_token);if(files.files!==undefined&&!Array.isArray(files.files))throw Error();const sheet=await api('https://sheets.googleapis.com/v4/spreadsheets/1kWKSJBUTms912f1kZyGmNkpasVNDMX62Iz3HnqkYPCc?fields=spreadsheetId,sheets(properties(title))',tokens.access_token);if(sheet.spreadsheetId!=='1kWKSJBUTms912f1kZyGmNkpasVNDMX62Iz3HnqkYPCc')throw Error();const file=await api('https://www.googleapis.com/drive/v3/files/1kWKSJBUTms912f1kZyGmNkpasVNDMX62Iz3HnqkYPCc?fields=id,capabilities(canEdit)',tokens.access_token);if(file.capabilities?.canEdit!==true)throw Error();return json({ok:true,email:profile.emailAddress,gmail:'verified',drive:'verified',sheets:'read_write_permission_verified',message:'Gmail, Drive, and Tournas master spreadsheet access passed; Google reports that this account can edit the master. No files, emails or spreadsheet rows were changed.'});
  }catch{return json({error:'Google connection test failed. Reconnect Google and check that all requested permissions are granted.'},502);}
 }
 if(action==='disconnect'&&req.method==='POST'){
  const tokens=await get('tokens');let revoked=!tokens;if(tokens){try{const r=await fetcher('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:tokens.refresh_token}),signal:AbortSignal.timeout(20000)});revoked=r.ok;}catch{}}
  await remove('tokens');await remove('state');return json({ok:true,revoked,message:revoked?'Disconnected.':'Local connection removed. Google revocation was not confirmed; remove access in your Google account.'});
 }
 return json({error:'Not found'},404);
}
