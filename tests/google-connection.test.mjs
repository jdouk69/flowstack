import test from 'node:test';
import assert from 'node:assert/strict';
import {googleRoute,googleRefreshMessage,seal,unseal,GOOGLE_CALLBACK,GOOGLE_SCOPES} from '../lib/google-connection.mjs';

const key=Buffer.alloc(32,7).toString('base64'),origin='https://flowstack.jimdoukakis.chatgpt.site';
function fixture(){const rows=new Map();const db={prepare(sql){let args;return {bind(...v){args=v;return this;},async first(){const row=rows.get(args[0]);if(!row||row.owner!==args[1])return null;if(sql.startsWith('DELETE')){if(row.data!==args[2])return null;rows.delete(args[0]);return {id:args[0]};}return {data:row.data};},async run(){if(sql.startsWith('INSERT'))rows.set(args[0],{owner:args[1],data:args[2]});else if(rows.get(args[0])?.owner===args[1])rows.delete(args[0]);return {};}};}};let calls=0;const fetcher=async(url)=>{calls++;if(url.includes('/token'))return Response.json({access_token:'fixture-access',refresh_token:'fixture-refresh',scope:GOOGLE_SCOPES.join(' '),expires_in:3600});if(url.includes('/profile'))return Response.json({emailAddress:'jimdoukakis@gmail.com'});if(url.includes('/sheets.googleapis.com/'))return Response.json({spreadsheetId:'1kWKSJBUTms912f1kZyGmNkpasVNDMX62Iz3HnqkYPCc',sheets:[]});if(url.includes('capabilities(canEdit)'))return Response.json({id:'1kWKSJBUTms912f1kZyGmNkpasVNDMX62Iz3HnqkYPCc',capabilities:{canEdit:true}});if(url.includes('/files'))return Response.json({files:[]});if(url.includes('/revoke'))return new Response('');throw Error('unexpected provider');};const send=(action,body,owner='one',method=body?'POST':'GET',provider=fetcher)=>googleRoute(new Request(origin+'/api/flow/google/'+action,{method,headers:{origin,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),{db,key,owner,fetcher:provider});return {rows,send,calls:()=>calls};}
const config={client_id:'123-fixture.apps.googleusercontent.com',client_secret:'fixture-secret-no-real-credential'};
test('encryption binds secret to owner and does not persist plaintext',async()=>{const sealed=await seal(config,key,'one:config');assert.ok(!sealed.includes(config.client_secret));assert.deepEqual(await unseal(sealed,key,'one:config'),config);await assert.rejects(unseal(sealed,key,'two:config'));});
test('configuration, PKCE, owner isolation, wrong state and one-use callback',async()=>{const f=fixture();assert.equal((await f.send('configure',config)).status,200);const other=await(await f.send('status',null,'two')).json();assert.equal(other.configured,false);const auth=new URL((await(await f.send('start',{})).json()).url);assert.equal(auth.searchParams.get('redirect_uri'),GOOGLE_CALLBACK);assert.equal(auth.searchParams.get('code_challenge_method'),'S256');assert.equal(auth.searchParams.get('scope'),GOOGLE_SCOPES.join(' '));const state=auth.searchParams.get('state');assert.equal((await f.send('callback?state=wrong&code=test')).headers.get('Location'),origin+'/settings?google=invalid_state');assert.equal(f.calls(),0);assert.equal((await f.send('callback?state='+state+'&code=test')).headers.get('Location'),origin+'/settings?google=connected');assert.equal((await f.send('callback?state='+state+'&code=test')).headers.get('Location'),origin+'/settings?google=invalid_state');const status=await(await f.send('status')).json();assert.equal(status.connected,true);assert.equal(status.email,'jimdoukakis@gmail.com');assert.ok(!JSON.stringify(status).includes('fixture-access'));assert.ok([...f.rows.values()].every(r=>!r.data.includes('fixture-secret')&&!r.data.includes('fixture-refresh')));assert.equal((await(await f.send('test',{})).json()).ok,true);assert.equal((await(await f.send('disconnect',{})).json()).revoked,true);assert.equal((await(await f.send('status')).json()).connected,false);});
test('partial grants and wrong Google account are never stored as connected',async()=>{for(const mode of ['scopes','account']){const f=fixture();await f.send('configure',config);const auth=new URL((await(await f.send('start',{})).json()).url);const provider=async(url)=>url.includes('/token')?Response.json({access_token:'a',refresh_token:'r',scope:mode==='scopes'?GOOGLE_SCOPES[0]:GOOGLE_SCOPES.join(' ')}):Response.json({emailAddress:'other@example.com'});const r=await f.send('callback?state='+auth.searchParams.get('state')+'&code=test',null,'one','GET',provider);assert.match(r.headers.get('Location'),mode==='scopes'?/missing_permissions/:/wrong_account/);assert.equal((await(await f.send('status')).json()).connected,false);}});
test('expired state is rejected without provider calls',async()=>{const f=fixture();await f.send('configure',config);const auth=new URL((await(await f.send('start',{})).json()).url);const row=f.rows.get('google:state:one');const data=await unseal(row.data,key,'one:state');row.data=await seal({...data,expires:0},key,'one:state');assert.match((await f.send('callback?state='+auth.searchParams.get('state')+'&code=x')).headers.get('Location'),/invalid_state/);assert.equal(f.calls(),0);});

test('callback diagnoses provider failures without reflecting sensitive response content',async()=>{
 for(const error of ['invalid_client','invalid_grant','unauthorized_client','constructor','secret-value']){
  const f=fixture();await f.send('configure',config);const auth=new URL((await(await f.send('start',{})).json()).url);
  const provider=async()=>Response.json({error,error_description:'fixture-access fixture-secret-no-real-credential'},{status:400});
  const response=await f.send('callback?state='+auth.searchParams.get('state')+'&code=test',null,'one','GET',provider);
  const expected=['invalid_client','invalid_grant','unauthorized_client'].includes(error)?error:'token_exchange_failed';
  assert.equal(response.headers.get('Location'),origin+'/settings?google='+expected);
  assert.equal((await(await f.send('status')).json()).connected,false);
  assert.ok(!response.headers.get('Location').includes('fixture-secret'));
 }
});
test('callback separates Gmail access failures from token exchange failures',async()=>{
 const f=fixture();await f.send('configure',config);const auth=new URL((await(await f.send('start',{})).json()).url);
 const provider=async(url)=>url.includes('/token')?Response.json({access_token:'fixture-access',refresh_token:'fixture-refresh',scope:GOOGLE_SCOPES.join(' ')}):Response.json({error:'private provider detail'},{status:403});
 const response=await f.send('callback?state='+auth.searchParams.get('state')+'&code=test',null,'one','GET',provider);
 assert.equal(response.headers.get('Location'),origin+'/settings?google=gmail_access_failed');
 assert.equal((await(await f.send('status')).json()).connected,false);
});

test('Gmail workflow preview uses saved authorization, preserves filters and does not store email data',async()=>{
 const f=fixture();assert.equal((await f.send('preview',{email:'supplier@example.com'})).status,409);
 await f.send('configure',config);const auth=new URL((await(await f.send('start',{})).json()).url);await f.send('callback?state='+auth.searchParams.get('state')+'&code=test');
 const before=new Map([...f.rows].map(([id,r])=>[id,r.data]));const urls=[];
 const provider=async(url,options)=>{urls.push(url);assert.equal(options.headers.Authorization,'Bearer fixture-access');assert.equal(options.method,undefined);if(url.includes('messages?'))return Response.json({messages:[{id:'a/b'},{id:'a/b'}]});return Response.json({payload:{parts:[{filename:'invoice.PDF'},{filename:'not-selected.zip'}],headers:[{name:'Subject',value:'Invoice sample'}]}});};
 const response=await f.send('preview',{search_type:'gmail_search',keyword:'from:vendor after:2026/01/01',file_types:['pdf']},'one','POST',provider);assert.equal(response.status,200);const result=await response.json();assert.equal(result.files_found,1);assert.equal(result.read_only,true);assert.equal(result.query,'(from:vendor after:2026/01/01) has:attachment');assert.ok(urls[1].includes('a%2Fb'));assert.deepEqual(new Map([...f.rows].map(([id,r])=>[id,r.data])),before);
 assert.equal((await f.send('preview',{email:'supplier@example.com'},'two','POST',provider)).status,409);
 assert.equal((await f.send('preview',{email:'supplier@example.com'},'one','POST',async()=>Response.json({error:'private detail'},{status:403}))).status,502);
 const empty=await(await f.send('preview',{email:'supplier@example.com'},'one','POST',async()=>Response.json({resultSizeEstimate:0}))).json();assert.equal(empty.emails_found,0);assert.equal(empty.files_found,0);
});
test('Gmail preview refreshes expired tokens and refuses unsuccessful refresh',async()=>{
 const f=fixture();await f.send('configure',config);f.rows.set('google:tokens:one',{owner:'one',data:await seal({access_token:'expired',refresh_token:'refresh',email:'jimdoukakis@gmail.com',expires:0},key,'one:tokens')});
 let refreshCalls=0;const provider=async(url,options)=>{if(url.includes('/token')){refreshCalls++;assert.equal(new URLSearchParams(options.body).get('grant_type'),'refresh_token');return Response.json({access_token:'renewed',expires_in:3600});}assert.equal(options.headers.Authorization,'Bearer renewed');return Response.json({messages:[]});};
 assert.equal((await f.send('preview',{email:'supplier@example.com'},'one','POST',provider)).status,200);assert.equal(refreshCalls,1);
 const row=f.rows.get('google:tokens:one');const saved=await unseal(row.data,key,'one:tokens');assert.equal(saved.refresh_token,'refresh');row.data=await seal({...saved,expires:0},key,'one:tokens');
 const failed=await f.send('preview',{email:'supplier@example.com'},'one','POST',async()=>Response.json({error:'invalid_grant',error_description:'private provider detail fixture-secret-no-real-credential'},{status:400}));assert.equal(failed.status,502);const failure=await failed.json();assert.match(failure.error,/saved refresh authorization/);assert.match(failure.error,/Reconnect/);assert.ok(!failure.error.includes('private provider detail'));assert.ok(!failure.error.includes('fixture-secret'));
});
test('refresh errors expose only allow-listed Google failure guidance',()=>{
 assert.match(googleRefreshMessage('invalid_client'),/client credentials/);
 assert.match(googleRefreshMessage('unauthorized_client'),/OAuth client/);
 assert.match(googleRefreshMessage('unknown-provider-value'),/Reconnect Google in Settings/);
 assert.ok(!googleRefreshMessage('unknown-provider-value').includes('unknown-provider-value'));
});
test('Google connection test gives safe guidance when the saved refresh grant is rejected',async()=>{
 const f=fixture();await f.send('configure',config);f.rows.set('google:tokens:one',{owner:'one',data:await seal({access_token:'expired',refresh_token:'refresh',email:'jimdoukakis@gmail.com',expires:0},key,'one:tokens')});
 const response=await f.send('test',{},'one','POST',async()=>Response.json({error:'invalid_client',error_description:'private fixture-secret'},{status:401}));assert.equal(response.status,502);const result=await response.json();assert.match(result.error,/client credentials/);assert.ok(!result.error.includes('private fixture-secret'));
});
