const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// D1 reservations survive individual HTTP requests and Worker isolates.
// Reads and writes have separate Google per-user quotas; leave headroom in both.
export function sheetsQuotaGate(db,owner,{clock=Date.now,sleep=pause,gap=1600}={}){
 return async(method='GET')=>{
  const time=clock(),id=`sheets-quota:${owner}:${method==='GET'?'read':'write'}`,stamp=new Date(time).toISOString();
  const row=await db.prepare("INSERT INTO records(id,owner,entity,data,created,updated) VALUES(?,?,'SheetsQuota',?,?,?) ON CONFLICT(id) DO UPDATE SET data=json_object('next',MAX(CAST(json_extract(records.data,'$.next') AS INTEGER),?)+?),updated=excluded.updated WHERE records.owner=excluded.owner AND records.entity='SheetsQuota' RETURNING data").bind(id,owner,JSON.stringify({next:time+gap}),stamp,stamp,time,gap).first();
  if(!row)throw Error('Google Sheets request pacing is unavailable. Retry shortly.');
  const wait=Math.max(0,JSON.parse(row.data).next-gap-clock());
  if(wait>45000)throw Error('Google Sheets request queue is busy. Retry the saved sync shortly.');
  if(wait)await sleep(wait);
 };
}
