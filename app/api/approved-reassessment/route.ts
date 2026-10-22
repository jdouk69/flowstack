import {env} from 'cloudflare:workers';
import manifest from '@/lib/approved-reassessment-manifest.json';
import {authorizedApproval,reassessmentOperation} from '@/lib/approved-reassessment.mjs';
export const dynamic='force-dynamic';
// Owner-private Sites boundary plus an expiring, high-entropy, server-only approval capability.
// No shared Google credentials, caller-selected owner, IDs or assessment values are accepted.
const security={token_sha256:'63113db75d994070f1e9fc37ab1cc5ed157e6c3fe4488075e4f056f94ea04028',expires_at:'2026-10-09T23:59:00.000Z'};
async function route(req:Request){
 if(!await authorizedApproval(req,security))return Response.json({error:'Approved batch access required.'},{status:403});
 return reassessmentOperation(req,{db:(env as any).DB,bucket:(env as any).BUCKET,manifest});
}
export const GET=route;
export const POST=route;
