// Category names recovered from the owner's read-only category workbook.
// These are transparent text suggestions, never extracted invoice facts or project-use decisions.
export const CATEGORY_VERSION='text-categories-v3';
export const PRODUCT_CATEGORIES=['Paint & Finishing','Tile & Tile Installation','Waterproofing & Plumbing','Insulation','Reinforcing Steel','Formwork','Concrete & Masonry','Drywall','Electrical','Safety & PPE','Hardware & Fasteners','Tools & Reusable Equipment','Other / Needs Review'];
const text=value=>String(value??'').normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('el').replaceAll('ς','σ').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
// Unicode word starts prevent e.g. 'mask' matching 'masking tape'. Greek stems allow inflection.
const starts=(s,term)=>{const folded=text(term),greek=/[α-ω]/u.test(folded);return s.split(' ').some(word=>greek?word.startsWith(folded):word===folded||word===folded+'s'||word===folded+'es');};
const phrase=(s,term)=>{const words=s.split(' '),parts=text(term).split(' '),greek=/[α-ω]/u.test(term);return words.some((_,i)=>parts.every((part,n)=>words[i+n]&&(greek||n===parts.length-1?words[i+n].startsWith(part):words[i+n]===part)));};
const rules=[
 ['Paint & Finishing',['paint','primer','masking tape','protective plastic','roller','finishing compound','neopal','ασταρ','χρωμα','ρολο βαφη','πλαστικο χρωμα']],
 ['Tile & Tile Installation',['tile adhesive','tile spacer','kp300','kp500','κολλα πλακιδ','σταυρο πλακιδ','πλακιδ']],
 ['Waterproofing & Plumbing',['waterproof','waterproofing','floor drain','silicone','plumbing','cistern','στεγαν','υδραυλικ','σιφων','σιλικον','καζανακ']],
 ['Insulation',['insulation','fiberglass mesh','low expansion foam','μονωσ','θερμομον','υαλοπλεγ']],
 ['Reinforcing Steel',['reinforcing','rebar','tie wire','structural reinforcing mesh','reinforcing steel','οπλισμ','σιδηροπλισ','πλεγμα δομ','συρμα δεσι']],
 ['Formwork',['formwork','thruty','ξυλοτυπ','καλουπ']],
 ['Concrete & Masonry',['cement','lime','sand','gravel','brick','τσιμεντ','ασβεστ','αμμο','χαλικ','τουβλ','σκυροδεμ']],
 ['Drywall',['drywall','γυψοσαν']],
 ['Electrical',['electrical extension','extension cable','cable reel','ηλεκτρολογ','μπαλαντεζ','καρουλι καλωδ']],
 ['Safety & PPE',['glove','mask','helmet','safety vest','work vest','γαντ','μασκα','κρανο','γιλεκο εργασ','γιλεκο ασφαλ']],
 ['Hardware & Fasteners',['screw','nail','fastener','βιδ','καρφι','παξιμαδ','ροδελ']],
 ['Tools & Reusable Equipment',['blade','pencil','drill bit','carbon brush','cutting disc','hatchet','hammer','tool apron','spatula','trowel','λεπιδ','μολυβ','τρυπαν','καρβουνακ','δισκο κοπη','τσεκουρ','σφυρ','ποδια εργαλει','σπατουλ','μυστρ']]
];
const matches=(s,terms)=>terms.filter(term=>text(term).includes(' ')?phrase(s,term):starts(s,term));
const durable=['hammer','hatchet','tool apron','cable reel','extension cable','electrical extension','trowel','spatula','σφυρ','τσεκουρ','ποδια εργαλει','μπαλαντεζ','σπατουλ','μυστρ'];
const wear=['blade','cutting disc','carbon brush','λεπιδ','δισκο κοπη','καρβουνακ'];
export function legacyProductCategory(row){return categorySuggestion(row,true);}
export function suggestProductCategory(row){return categorySuggestion(row,false);}
function categorySuggestion(row,legacy){
 const s=text([row.printed_name,row.description].filter(Boolean).join(' '));
 // A filler is a material applied with a spatula, not the spatula itself.
 // ΓΑΝΤΖΟΣ (hook) and ΓΑΝΤΙΑ (gloves) are different Greek words.
 const filler=!legacy&&matches(s,['στοκο','filler']).length>0;
 const hook=!legacy&&matches(s,['γαντζο','conduit hook']).length>0;
 const handle=!legacy&&matches(s,['στυλιαρι','tool handle']).length>0;
 const rawHits=rules.map(([category,terms])=>({category,terms:matches(s,legacy?terms:terms.filter(term=>term!=='γαντ').concat(category==='Safety & PPE'?['γαντι']:category==='Paint & Finishing'?['στοκο','filler']:category==='Electrical'?['conduit hook','γαντζο']:category==='Tools & Reusable Equipment'?['σκεπαρνι','ποδια δερμ']:[]))})).filter(hit=>hit.terms.length).filter(hit=>!filler||hit.category==='Paint & Finishing');
 // A cistern is a plumbing product; drywall in its description identifies installation context.
 // Keep other conflicts reviewable instead of giving all plumbing keywords blanket priority.
 const cistern=matches(s,['cistern','καζανακ']);
 const contextualTerms=cistern.length?rawHits.find(hit=>hit.category==='Drywall')?.terms||[]:[];
 const hits=contextualTerms.length?rawHits.filter(hit=>hit.category!=='Drywall'):rawHits;
 const categories=[...new Set(hits.map(hit=>hit.category))];
 const category=categories.length===1?categories[0]:'Other / Needs Review';
 const reusable=matches(s,legacy?durable:durable.concat(['σκεπαρνι','ποδια δερμ'])).filter(()=>!filler&&!hook&&!handle),consumable=matches(s,wear).concat(filler?['filler material']:[]);
 const kind=reusable.length&&!consumable.length?'reusable':consumable.length&&!reusable.length?'consumable':'unknown';
 const ambiguous=categories.length>1||Boolean(reusable.length&&consumable.length);
 const contextReason=contextualTerms.length?' Drywall terms ('+contextualTerms.join(', ')+') describe installation context for the cistern, not its product category.':'';
 return {version:legacy?'text-categories-v2':CATEGORY_VERSION,category,kind,ambiguous,candidates:categories,matched_terms:[...new Set(hits.flatMap(hit=>hit.terms))],contextual_terms:contextualTerms,reason:(!hits.length?'No supported category terms matched the original description. Choose a category after checking the source.':ambiguous?'Terms suggest more than one category or product type. Check the source before assigning a label.':'Matched original-description terms: '+[...new Set(hits.flatMap(hit=>hit.terms))].join(', ')+'. This is a suggestion, not a confirmed classification.')+contextReason,ppe:categories.includes('Safety & PPE')};
}
