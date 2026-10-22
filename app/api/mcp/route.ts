import {env} from 'cloudflare:workers';
import {runDailyAutomation,automationStatus} from '@/lib/automation-runner.mjs';

export const dynamic='force-dynamic';
const version='2026-07-28';
const toolList=[
 {name:'flowstack_run_invoice_audit',description:'Run FlowStack’s saved supplier Gmail collection, secure original storage, duplicate checks, supported invoice extraction, existing audit rules, review queue update, and configured Google Sheets sync. This does not approve invoices or replace previous review decisions.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
 {name:'flowstack_automation_status',description:'Read the latest unattended FlowStack run, collection and analysis totals, outstanding reviews, sheet sync result, and failures.',inputSchema:{type:'object',properties:{},additionalProperties:false}}
];
const result=(id:any,value:any)=>Response.json({jsonrpc:'2.0',id,result:value},{headers:{'Cache-Control':'private, no-store'}});
const rpcError=(id:any,code:number,message:string)=>Response.json({jsonrpc:'2.0',id,error:{code,message}},{headers:{'Cache-Control':'private, no-store'}});
export async function POST(request:Request){
 let body:any;try{body=await request.json();}catch{return rpcError(null,-32700,'Invalid JSON-RPC request.');}
 const id=body?.id??null,method=body?.method;
 if(!method)return rpcError(id,-32600,'Invalid JSON-RPC request.');
 if(method==='initialize')return result(id,{protocolVersion:version,capabilities:{tools:{}},serverInfo:{name:'FlowStack Invoice Audit',version:'1.0.0'}});
 if(method==='notifications/initialized')return new Response(null,{status:202});
 if(method==='server/discover')return result(id,{supportedVersions:[version],capabilities:{tools:{}}});
 if(method==='tools/list')return result(id,{tools:toolList});
 if(method!=='tools/call')return rpcError(id,-32601,'Unknown MCP method.');
 const userId=request.headers.get('oai-authenticated-user-id'),email=request.headers.get('oai-authenticated-user-email');
 if(!userId||!email)return rpcError(id,-32001,'Authenticated Site owner identity is required.');
 const name=body?.params?.name,args=body?.params?.arguments||{};
 if(args&&typeof args==='object'&&Object.keys(args).length)return result(id,{content:[{type:'text',text:'This tool does not accept caller-supplied settings.'}],isError:true});
 try{
  if(name==='flowstack_automation_status'){
   const status=await automationStatus({owner:userId,db:(env as any).DB});
   return result(id,{content:[{type:'text',text:JSON.stringify(status)}],structuredContent:status});
  }
  if(name==='flowstack_run_invoice_audit'){
   const run=await runDailyAutomation({owner:userId,db:(env as any).DB,bucket:(env as any).BUCKET,key:(env as any).GOOGLE_TOKEN_ENCRYPTION_KEY,reason:'scheduled'});
   return result(id,{content:[{type:'text',text:JSON.stringify(run)}],structuredContent:run,isError:['failed','completed_with_errors','already_running'].includes(run.status)});
  }
  return result(id,{content:[{type:'text',text:'Unknown FlowStack tool.'}],isError:true});
 }catch(error:any){return result(id,{content:[{type:'text',text:String(error?.message||'FlowStack automation failed.')}],isError:true});}
}
