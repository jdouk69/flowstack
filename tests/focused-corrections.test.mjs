import test from 'node:test';
import assert from 'node:assert/strict';
import {suggestProductCategory,legacyProductCategory} from '../lib/product-categories.mjs';
import {buildPurchaseHistory} from '../lib/product-history.mjs';
import {contractorQuestions} from '../lib/contractor-questions.mjs';
import {findingExplanation} from '../lib/finding-display.mjs';
import {buildAuditReport,auditReportTabs} from '../lib/audit-report.mjs';
import {buildWorkspace} from '../lib/findings-workspace.mjs';
const names=['ΣΤΟΚΟΣ ΣΠΑΤΟΥΛ FILL & FINISH LIGHT 20kg','ΣΤΟΚΟΣ ΣΠΑΤΟΥΛΑΡΙΣΜΑΤΟΣ 20kg','ΓΑΝΤΖΟΣ 3/4" ΓΙΑ ΣΩΛΗΝΑ ΔΕΗ & ΟΤΕ'];
test('specific Greek nouns override tool context; gloves and conduit hooks stay distinct',()=>{
 for(const printed_name of names.slice(0,2)){const r=suggestProductCategory({printed_name});assert.equal(r.category,'Paint & Finishing');assert.equal(r.kind,'consumable');assert.equal(r.ppe,false);assert.equal(legacyProductCategory({printed_name}).kind,'reusable');}
 const hook=suggestProductCategory({printed_name:names[2]});assert.equal(hook.category,'Electrical');assert.equal(hook.ppe,false);assert.notEqual(hook.kind,'reusable');assert.equal(legacyProductCategory({printed_name:names[2]}).ppe,true);
 assert.equal(suggestProductCategory({printed_name:'ΓΑΝΤΙΑ ΝΙΤΡΙΛΙΟΥ'}).ppe,true);
 assert.equal(suggestProductCategory({printed_name:'ΣΚΕΠΑΡΝΙ ΚΤΙΣΤΩΝ "ΙΟΡΔΑΝΗ"'}).kind,'reusable');
 assert.equal(suggestProductCategory({printed_name:'ΣΤΥΛΙΑΡΙ ΣΚΕΠΑΡΝΙΩΝ ΞΥΛΙΝΟ'}).kind,'unknown');
 assert.equal(suggestProductCategory({printed_name:'ΠΟΔΙΑ ΔΕΡΜ Α/Τ ΜΕ 4 ΤΣΕΠΕΣ ΜΕΓΑΛΗ'}).kind,'reusable');
});
test('newly captured products use corrected category rules without rewriting pre-correction findings',async()=>{
 const rows=names.map((printed_name,n)=>({printed_name,invoice_created:'2026-10-10T00:00:00.000Z',invoice_id:'future',position:n+1,supplier_key:'tournas'}));
 const groups=await buildPurchaseHistory(rows);assert.ok(groups.every(g=>g.findings.length===0));
});
test('corrected suggestions retain v2 historical assessments and do not introduce adze/apron findings',async()=>{
 const rows=[...names,'ΣΚΕΠΑΡΝΙ ΚΤΙΣΤΩΝ "ΙΟΡΔΑΝΗ"','ΠΟΔΙΑ ΔΕΡΜ Α/Τ ΜΕ 4 ΤΣΕΠΕΣ ΜΕΓΑΛΗ'].map((printed_name,n)=>({printed_name,invoice_id:'i',id:'l'+n,position:n+1,supplier_key:'tournas',source_document_id:'pdf',audit_status:'needs_review'}));const before=JSON.stringify(rows);const g=await buildPurchaseHistory(rows);assert.equal(g.length,5);assert.equal(g.flatMap(x=>x.findings).length,3);assert.ok(g.slice(3).every(x=>x.findings.length===0));assert.equal(g[0].suggestion.kind,'consumable');assert.equal(g[0].findings[0].reason,'The description suggests a reusable tool or equipment. Confirm the product type, ownership, location and project use. This suggestion does not establish an unrelated purchase.');assert.equal(JSON.stringify(rows),before);
});
test('questions identify item, invoice, dates and evidence without mutating historic identities or assessments',()=>{
 for(const item of [...names,'ΜΠΑΛΑΝΤΕΖΑ ΚΑΡΟΥΛΙ 3x1.5 50m','ΣΠΑΤΟΥΛΑ ΞΥΛ.ΛΑΒΗ ΒΕΝΜΑΝ 60','ΓΑΝΤΙΑ ΝΙΤΡΙΛΙΟΥ']){const f={id:'same',kind:'product',item,invoice_id:'i',invoice_number:'363',date:'2026-05-29',color:'YELLOW',reason:'Original saved reason',questions:['Original saved question'],evidence:[{invoice_id:'i',quantity:'1',unit:'Τεμ.'},{invoice_id:'prior',invoice_number:'354',invoice_date:'2024-10-25',quantity:'1',unit:'Τεμ.',account_information:'8655'}]};const before=JSON.stringify(f),q=contractorQuestions(f).join(' ');assert.ok(q.includes('#363'));assert.ok(q.includes('2026-05-29'));assert.ok(!/theft|fraud|loss established/i.test(q));if(item.startsWith("ΣΠΑΤΟΥΛΑ ΞΥΛ"))assert.ok(q.includes('#354'));findingExplanation(f);assert.equal(JSON.stringify(f),before);}
});
test('both report types retain original findings and include every active Yellow purchasing prompt',()=>{
 const f={id:'p',kind:'product',key:'product',invoice_id:'i',invoice_number:'363',date:'2026-05-29',supplier:'tournas',item:names[0],color:'YELLOW',amount:'35,08',currency:null,reason:'Original reason',questions:['Original question'],evidence:[],unresolved:true};const capture={...f,id:'c',kind:'invoice',key:['i','line_calculation'],color:'ORANGE'};const before=JSON.stringify([f,capture]);const w=buildWorkspace([f,capture],[],new URLSearchParams('category=purchase&status=active'));const r=buildAuditReport(w,'investigation','https://test.local','');assert.deepEqual(r.findings.map(x=>x.id),['p']);assert.ok(r.questions[0].question.includes('consumable'));assert.ok(auditReportTabs(r).find(t=>t.name==='Findings').rows[1].includes('Original reason'));assert.equal(JSON.stringify([f,capture]),before);
});
