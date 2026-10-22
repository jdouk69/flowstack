export function deletionConfirmation(document){
 const shared=document.customer_share&&document.customer_share.status!=='revoked';
 return `Delete ${document.name} from FlowStack?${shared?' Its customer link will be revoked first.':''} Original invoices and existing Drive copies will remain.`;
}
export async function deleteStoredDocument(document,{request,invoke}){
 if(document.customer_share&&document.customer_share.status!=='revoked')await invoke('shareDocument',{document_id:document.id,action:'revoke'});
 await request('/documents/'+encodeURIComponent(document.id),{method:'DELETE'});
}
