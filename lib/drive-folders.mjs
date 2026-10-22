import {driveLink} from './google-provider.mjs';
export const folderNames={root:'FlowStack',suppliers:'Supplier PDFs',merged:'Merged PDFs',shared:'Shared Packages',audit:'Audit Workbooks'};
const mime='application/vnd.google-apps.folder',now=()=>new Date().toISOString();
export async function managedFolder({db,owner,provider},role){
 if(!Object.hasOwn(folderNames,role))throw Error('Unknown FlowStack folder.');
 // A request-local cache avoids redundant API calls; every request rechecks privacy.
 provider.flowstackFolders??=new Map();if(provider.flowstackFolders.has(role))return provider.flowstackFolders.get(role);
 const parent=role==='root'?await provider.root():await managedFolder({db,owner,provider},'root');
 if(!parent?.id||parent.trashed)throw Error('Drive destination is unavailable.');
 const recordId='drive:folder:'+owner+':'+role;
 let row=await db.prepare("SELECT data FROM records WHERE owner=? AND id=? AND entity='DriveFolder'").bind(owner,recordId).first();
 if(!row){const candidates=await provider.managedFolders(role);if(candidates.length>1)throw Error('Multiple app folders match '+folderNames[role]+'. Review them in Drive.');const id=candidates[0]?.id||await provider.generateId();await db.prepare("INSERT INTO records(id,owner,entity,data,created,updated) VALUES(?,?,'DriveFolder',?,?,?) ON CONFLICT(id) DO NOTHING").bind(recordId,owner,JSON.stringify({id,role,parent:parent.id,created:!!candidates[0]}),now(),now()).run();row=await db.prepare("SELECT data FROM records WHERE owner=? AND id=? AND entity='DriveFolder'").bind(owner,recordId).first();}
 const saved=JSON.parse(row.data);let file;
 try{file=await provider.file(saved.id);}catch(error){if(error.providerStatus!==404)throw error;}
 if(!file){if(saved.created)throw Error('The saved '+folderNames[role]+' folder is unavailable. Restore it before retrying.');try{await provider.createFolder({id:saved.id,name:folderNames[role],mimeType:mime,parents:[parent.id],appProperties:{flowstack_folder:role}});}catch(error){if(error.providerStatus!==409)throw error;}file=await provider.file(saved.id);}
 if(file.trashed||file.mimeType!==mime||file.appProperties?.flowstack_folder!==role||!file.parents?.includes(parent.id))throw Error('The saved '+folderNames[role]+' folder was moved, deleted or changed. Restore it in Drive before retrying; no replacement was created.');
 const permissions=await provider.permissions(file.id);
 if(!permissions.length||permissions.some(p=>p.type!=='user'||p.role!=='owner'))throw Error('Keep the '+folderNames[role]+' folder private. Share individual customer copies instead.');
 if(!saved.created){saved.created=true;await db.prepare("UPDATE records SET data=?,updated=? WHERE owner=? AND id=? AND entity='DriveFolder'").bind(JSON.stringify(saved),now(),owner,recordId).run();}
 const result={id:file.id,name:file.name,link:driveLink(file.id)};provider.flowstackFolders.set(role,result);return result;
}
export async function moveVerified(provider,file,destination){
 if(file.parents?.includes(destination.id))return false;
 if(!Array.isArray(file.parents)||file.parents.length!==1)throw Error('The existing parent could not be verified. File was not moved.');
 const before=await provider.permissions(file.id);
 let moveError;try{await provider.move(file.id,destination.id,file.parents);}catch(error){moveError=error;}
 // A lost response is recoverable by inspecting the same file ID.

 const after=await provider.file(file.id),permissions=await provider.permissions(file.id);
 const signature=ps=>JSON.stringify(ps.map(p=>[p.id,p.type,p.role,p.allowFileDiscovery===true]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
 if(after.trashed||after.id!==file.id||after.mimeType!==file.mimeType||after.md5Checksum!==file.md5Checksum||String(after.size||'')!==String(file.size||'')||!after.parents?.includes(destination.id)||signature(before)!==signature(permissions))throw moveError||Error('Drive move could not be fully verified. The original file ID/link is retained; retry to check its location.');
 return true;
}
