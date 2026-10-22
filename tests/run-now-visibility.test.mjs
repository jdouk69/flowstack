import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('run page puts one scoped live status first and separates saved backlog counts',()=>{
 const source=readFileSync(new URL('../components/AutomationDashboard.jsx',import.meta.url),'utf8');
 for(const token of ['Run invoice check now','bg-blue-700','text-white','font-bold','min-h-12','w-full','sm:w-auto','aria-busy={busy||runLocked}','disabled={busy||runLocked||','onClick={runNow}','date_range','full rescan','paused before completion','stageLabel','Errors from this run','Saved issues','not necessarily from the latest run','checked_at','All run stages finished successfully'])assert.ok(source.includes(token),token);
 assert.ok(source.includes("request('/automation',{method:'POST'"));
 assert.ok(source.includes('advanceManualAudit'));
 assert.ok(source.includes('Resume this run'));
 assert.ok(source.includes('aria-live="polite"'));
 assert.ok(source.includes('The run does not approve invoices'));
 const dashboard=readFileSync(new URL('../screens/Welcome.jsx',import.meta.url),'utf8');
 assert.ok(dashboard.indexOf('<AutomationDashboard/>')<dashboard.indexOf('<details className="audit-collection-tools">'));
});
