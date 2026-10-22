import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('dashboard invoice check remains prominent, responsive and uses the existing action',()=>{
 const source=readFileSync(new URL('../components/AutomationDashboard.jsx',import.meta.url),'utf8');
 for(const token of ['Run invoice check now','bg-blue-700','text-white','font-bold','min-h-12','w-full','sm:w-auto','aria-busy={busy||runLocked}','disabled={busy||runLocked||','onClick={runNow}','date_range','full rescan','paused before completion'])assert.ok(source.includes(token),token);
 assert.ok(source.includes("request('/automation',{method:'POST'"));
 assert.ok(source.includes('advanceManualAudit'));
 assert.ok(source.includes('Resume invoice check'));
 assert.ok(source.includes('aria-live="polite"'));
 assert.ok(source.includes('Running does not approve invoices'));
 const dashboard=readFileSync(new URL('../screens/Welcome.jsx',import.meta.url),'utf8');
 assert.ok(dashboard.indexOf('<AutomationDashboard/>')<dashboard.indexOf('<details className="audit-collection-tools">'));
});
