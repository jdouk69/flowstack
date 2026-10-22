// Existing app-managed destinations in integration fixtures. Production uses Drive APIs.
export function withManagedFolders(provider){
 const dirs=new Map(['root','suppliers','merged','shared','audit'].map(role=>['managed-'+role,{id:'managed-'+role,name:role,mimeType:'application/vnd.google-apps.folder',parents:[role==='root'?'root':'managed-root'],appProperties:{flowstack_folder:role}}]));
 const file=provider.file?.bind(provider),permissions=provider.permissions?.bind(provider),folder=provider.folder?.bind(provider);
 provider.root=async()=>({id:'root',mimeType:'application/vnd.google-apps.folder'});
 provider.managedFolders=async role=>[dirs.get('managed-'+role)];
 provider.file=async id=>dirs.get(id)||file(id);
 provider.permissions=async id=>dirs.has(id)?[{id:'owner',type:'user',role:'owner'}]:permissions?permissions(id):[{id:'owner',type:'user',role:'owner'}];
 provider.folder=async id=>dirs.get(id)||(folder?folder(id):provider.file(id));
 provider.mergedFiles=async workflow=>provider.files?(await provider.files('managed-merged')).filter(f=>f.appProperties?.flowstack_workflow===workflow):[];
 return provider;
}
