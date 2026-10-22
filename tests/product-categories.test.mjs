import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {suggestProductCategory} from '../lib/product-categories.mjs';
import {buildPurchaseHistory} from '../lib/product-history.mjs';
import {parseTournasPage} from '../lib/extraction/suppliers/tournas.mjs';
const suggestion=printed_name=>suggestProductCategory({printed_name,description:printed_name});
test('printed Akron cistern descriptions use plumbing function and explain drywall installation context',()=>{
 for(const name of ['ΚΑΖΑΝΑΚΙ ΓΥΨΟΣΑΝΙΔΑΣ GEBERIT 111.796.00.1 SI','ΚΑΖΑΝΑΚΙ ΕΝΤΙΧΟΙΖΟΜΕΝΟ GROHE 38526000','Concealed cistern for drywall']){
  const result=suggestion(name);assert.equal(result.category,'Waterproofing & Plumbing');assert.equal(result.kind,'unknown');assert.equal(result.ambiguous,false);
  if(name.includes('ΓΥΨΟΣΑΝΙΔΑΣ')||name.includes('drywall')){assert.ok(result.reason.includes('installation context'));assert.ok(result.contextual_terms.length);}
 }
 assert.equal(suggestion('ΓΥΨΟΣΑΝΙΔΑ 12.5mm').category,'Drywall');
 assert.equal(suggestion('Cistern and cement').category,'Other / Needs Review');
 assert.equal(suggestion('Plumbing and drywall materials').ambiguous,true);
});
test('reference categories use explainable original text; disposable tools and PPE are not called reusable',()=>{
 assert.equal(suggestion('NEOPAL SUPER 30 WHITE 10L').category,'Paint & Finishing');
 assert.equal(suggestion('ΠΛΑΣΤΙΚΟ ΧΡΩΜΑ ΛΕΥΚΟ').category,'Paint & Finishing');
 assert.equal(suggestion('Κόλλα πλακιδίων KP300').category,'Tile & Tile Installation');
 assert.equal(suggestion('ΣΙΦΩΝΙ ΔΑΠΕΔΟΥ').category,'Waterproofing & Plumbing');
 assert.equal(suggestion('Structural reinforcing mesh T92').category,'Reinforcing Steel');
 assert.equal(suggestion('Fiberglass mesh insulation').category,'Insulation');
 assert.equal(suggestion('Masking tape 50mm').category,'Paint & Finishing');
 assert.equal(suggestion('Masking tape 50mm').ppe,false);
 assert.equal(suggestion('ΓΑΝΤΙΑ ΝΙΤΡΙΛΙΟΥ').ppe,true);
 assert.equal(suggestion('ΓΑΝΤΙΑ ΝΙΤΡΙΛΙΟΥ').kind,'unknown');
 assert.equal(suggestion('Helmet').kind,'unknown');
 assert.equal(suggestion('Cutting disc for steel').kind,'consumable');
 assert.equal(suggestion('Cutting disc for steel').category,'Tools & Reusable Equipment');
 assert.equal(suggestion('Hammer').kind,'reusable');
 assert.equal(suggestion('Extension-cable reel 50m').kind,'reusable');
 assert.equal(suggestion('ΚΑΡΒΟΥΝΑΚΙΑ').kind,'consumable');
 assert.equal(suggestion('Unrelated unrecognized product').category,'Other / Needs Review');
 assert.equal(suggestion('Unrelated unrecognized product').kind,'unknown');
 const conflict=suggestion('Paint and cement');assert.equal(conflict.category,'Other / Needs Review');assert.equal(conflict.ambiguous,true);assert.deepEqual(conflict.candidates,['Paint & Finishing','Concrete & Masonry']);
});
test('category suggestions remain separate from saved labels, approvals and observed history',async()=>{
 const rows=[{id:'line',invoice_id:'invoice',position:1,supplier_key:'tournas',account_information:'8891',printed_name:'Hammer',description:'Hammer',quantity:'1',unit:'pc',currency:'EUR',audit_status:'not_started',source_document_id:'pdf',source_page:1}];const snapshot=JSON.stringify(rows);
 const [group]=await buildPurchaseHistory(rows);assert.equal(group.category,'');assert.equal(group.category_status,'suggested');assert.equal(group.kind,'unknown');assert.equal(group.findings[0].color,'YELLOW');assert.equal(group.findings[0].evidence[0].source_document_id,'pdf');assert.ok(!group.findings.some(f=>f.color==='ORANGE'));assert.equal(JSON.stringify(rows),snapshot);
 const [saved]=await buildPurchaseHistory(rows,[{key:group.key,category:'Owner custom category',kind:'consumable',revision:3,note:'Checked source and project use'}]);assert.equal(saved.effective_category,'Owner custom category');assert.equal(saved.category_status,'confirmed');assert.equal(saved.kind,'consumable');assert.equal(saved.revision,3);assert.equal(saved.findings.length,0);assert.equal(JSON.stringify(rows),snapshot);
 const approved=rows.map(row=>({...row,audit_status:'approved'}));approved.push({...approved[0],id:'second',invoice_id:'second',source_document_id:'second-pdf'});const [repeat]=await buildPurchaseHistory(approved,[{key:group.key,kind:'reusable',category:'Tools'}]);assert.ok(repeat.findings.some(f=>f.color==='ORANGE'&&f.evidence.length===2));
});
if(process.env.FLOWSTACK_CATEGORY_SOURCE)test('actual retained Tournas item rows preserve formwork vs plumbing and consumable discs',async()=>{
 const document=parseTournasPage(JSON.parse(readFileSync(process.env.FLOWSTACK_CATEGORY_SOURCE,'utf8')));assert.equal(document.line_items.length,5);
 const rows=document.line_items.map(row=>({...row,id:'source-'+row.position,invoice_id:'retained-295',supplier_key:'tournas',source_document_id:'retained-original',audit_status:'not_started'}));
 const groups=await buildPurchaseHistory(rows);assert.equal(groups.length,5);
 for(const group of groups.filter(group=>group.name.includes('THRUTY')))assert.equal(group.effective_category,'Formwork');
 const disc=groups.find(group=>group.product_code==='08.19.193');assert.equal(disc.suggestion.kind,'consumable');assert.equal(disc.suggestion.category,'Tools & Reusable Equipment');assert.equal(disc.rows[0].quantity,'10,00');assert.equal(disc.rows[0].source_page,1);assert.equal(disc.findings.length,0);
 assert.equal(groups.find(group=>group.product_code==='01.00.005').effective_category,'Other / Needs Review');
});
