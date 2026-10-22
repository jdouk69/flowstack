// Personal FlowStack owner calendar; avoids UTC rolling the filename into tomorrow.
export function mergedFilename(supplier, {date = new Date(), part} = {}) {
 const calendar = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Los_Angeles', year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
 const value = type => calendar.find(p=>p.type===type).value;
 const day = `${value('year')}-${value('month')}-${value('day')}`;
 const label = String(supplier||'Documents').replace(/["\x00-\x1f/\\]/g,'_').trim().slice(0,100)||'Documents';
 return `Merged ${label} ${day}${part?' Part '+String(part).padStart(2,'0'):''}.pdf`;
}
