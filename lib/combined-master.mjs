import {googleAccess} from './google-connection.mjs';
import {auditSheetProvider} from './audit-sheet-provider.mjs';
import {sheetsQuotaGate} from './sheets-quota.mjs';
import {MASTER_ID,LINE_HEADERS,ATTENTION_HEADERS,syncTournasInvoice} from './tournas-master-sync.mjs';

// The owner explicitly selected the existing Tournas workbook as the combined
// master. Verify it in place; never create files or change vendor master mappings.
export async function ensureCombinedMaster({owner,db,key,supplier,fetcher=fetch,sheets:injected}){
 const sheets=injected||auditSheetProvider((await googleAccess({owner,db,key,fetcher})).access_token,fetcher,{beforeRequest:sheetsQuotaGate(db,owner)});
 const metadata=await sheets.metadata(MASTER_ID);
 const tabs=[['Line Item Audit',LINE_HEADERS],['Needs Attention',ATTENTION_HEADERS],['Paint & Consumables',ATTENTION_HEADERS]];
 if(metadata.spreadsheetId!==MASTER_ID||tabs.some(([title])=>!metadata.sheets?.some(s=>s.properties.title===title)))throw Error('The selected overall master is unavailable or its tabs changed. No new master was created.');
 const result=await sheets.read(MASTER_ID,tabs.map(([title])=>`'${title}'!A1:J1`));
 if(!tabs.every(([,headers],i)=>JSON.stringify(result.valueRanges?.[i]?.values?.[0])===JSON.stringify(headers)))throw Error('Overall master headers changed. No cells were overwritten.');
 return {vendor_id:supplier.id,spreadsheet_id:MASTER_ID,status:'ready',scope:'overall',name:'Overall audit master (Tournas workbook)',url:`https://docs.google.com/spreadsheets/d/${MASTER_ID}/edit`};
}
export async function syncCombinedInvoice(context){
 const result=await syncTournasInvoice({...context,masterId:MASTER_ID,vendorId:context.supplier.id,combinedSupplier:context.supplier});
 return {...result,master_url:`https://docs.google.com/spreadsheets/d/${MASTER_ID}/edit`};
}
