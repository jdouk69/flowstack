export function reportBatchIds(params){
 const raw=params.get('batches');if(!raw)return [];
 const ids=raw.split(',');if(ids.length>10||new Set(ids).size!==ids.length||ids.some(id=>!/^[a-zA-Z0-9_-]{1,100}$/.test(id)))throw Error('Invalid analysis report selection.');return ids;
}
export const batchScopeSql=ids=>"i.id IN (SELECT json_extract(item.value,'$.invoice_id') FROM records batch,json_each(batch.data,'$.items') item WHERE batch.owner=i.owner AND batch.entity='InvoiceBatch' AND batch.id IN ("+ids.map(()=>'?').join(',')+"))";
export function combinedReportUrl(batchIds){return '/reports?'+new URLSearchParams({status:'all',batches:batchIds.join(',')});}
