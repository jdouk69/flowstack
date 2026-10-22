import {previewCriteria} from './collection-preview.mjs';
export const COLLECTION_OVERLAP_MS=48*60*60*1000;
export function collectionSignature(workflow){
 const criteria=previewCriteria(workflow);
 return JSON.stringify([criteria.query,[...criteria.allowedExtensions].sort(),workflow.drive_folder_name||'']);
}
export function collectionWindow(workflow,mode,started){
 const signature=collectionSignature(workflow),base=previewCriteria(workflow).query;
 const checkpoint=workflow.collection_checkpoint;
 const time=Date.parse(started),previous=Date.parse(checkpoint?.through);
 if(mode!=='incremental'||checkpoint?.criteria_signature!==signature||!Number.isFinite(previous)||previous>time)
  return {query:base,criteria_signature:signature,mode:'full',checkpoint_through:started};
 const after=Math.max(0,Math.floor((previous-COLLECTION_OVERLAP_MS)/1000));
 return {query:`(${base}) after:${after} before:${Math.ceil(time/1000)+1}`,criteria_signature:signature,mode:'incremental',checkpoint_through:started};
}
export function successfulCheckpoint(workflow,job,result){
 if(!job.done||result.errors||result.status!=='completed'||!job.criteria_signature||collectionSignature(workflow)!==job.criteria_signature)return null;
 const through=job.checkpoint_through||job.started;
 if(!Number.isFinite(Date.parse(through)))return null;
 const prior=workflow.collection_checkpoint;
 if(prior?.criteria_signature===job.criteria_signature&&Date.parse(prior.through)>Date.parse(through))return prior;
 return {criteria_signature:job.criteria_signature,through,completed_at:job.completed_at,run_id:job.run_id};
}
