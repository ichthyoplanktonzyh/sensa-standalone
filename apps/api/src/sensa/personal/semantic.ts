import {semanticProposalSchema,semanticLookupViewSchema,personalMeaningViewSchema,captureIdentity} from '@sensa/contracts/sensa';
import type {SemanticLookupInput,SemanticAcceptOperation,SemanticLookupView} from '@sensa/contracts/sensa';
import type {DatabaseExecutor} from '../../database/index.js';
import type {SemanticResolution} from './semanticResolver.js';
import {contentHash} from '../curriculum/targets.js';
import {ConsumerError} from '../access/auth.js';
type Scope={learner_user_id:string;now:Date;session_id:string};
function lookupView(row:Record<string,any>):SemanticLookupView{if(!row.snapshot)throw new ConsumerError(404,'lookup_expired');return semanticLookupViewSchema.parse({id:row.id,revision:'1',snapshot:row.snapshot,status:row.status,proposal:row.proposal,reason:row.reason,expiresAt:row.expires_at.toISOString(),provenance:row.provenance});}
export async function readLookup(db:DatabaseExecutor,a:Scope,id:string){await expireLookup(db,a,id);const row=(await db.query('SELECT * FROM sensa_consumer.semantic_lookups WHERE learner_user_id=$1 AND id=$2',[a.learner_user_id,id])).rows[0];if(!row)throw new ConsumerError(404,'not_found');return lookupView(row);}
export async function beginLookup(db:DatabaseExecutor,a:Scope,input:SemanticLookupInput){
 await expireLookup(db,a,input.id);
 const digest=await contentHash(input.snapshot),old=(await db.query('SELECT * FROM sensa_consumer.semantic_lookups WHERE learner_user_id=$1 AND id=$2',[a.learner_user_id,input.id])).rows[0];
 if(old){if(old.input_digest!==digest)throw new ConsumerError(409,'lookup_id_reuse');return {fresh:false,view:lookupView(old)};}
 if(!input.snapshot.expression)throw new ConsumerError(409,'expression_required');
 const count=(await db.query('SELECT count(*)::int AS n FROM sensa_consumer.semantic_lookups WHERE learner_user_id=$1 AND created_at>$2',[a.learner_user_id,new Date(a.now.getTime()-86400000)])).rows[0]!.n;
 if(count>=30)throw new ConsumerError(409,'semantic_daily_budget');
 const row=(await db.query("INSERT INTO sensa_consumer.semantic_lookups(id,learner_user_id,input_digest,snapshot,status,created_at,expires_at) VALUES($1,$2,$3,$4::jsonb,'running',$5,$6) RETURNING *",[input.id,a.learner_user_id,digest,JSON.stringify(input.snapshot),a.now,new Date(a.now.getTime()+86400000)])).rows[0]!;
 return {fresh:true,view:lookupView(row)};
}
export async function finishLookup(db:DatabaseExecutor,a:Scope,id:string,result:SemanticResolution|null){
 const row=(await db.query('SELECT * FROM sensa_consumer.semantic_lookups WHERE learner_user_id=$1 AND id=$2',[a.learner_user_id,id])).rows[0]!;
 if(row.status!=='running')return lookupView(row);
 let proposal=null,provenance=null,reason=result?'meaning_unresolved':'provider_unavailable',status=result?'unresolved':'failed';
 if(a.now.getTime()-row.created_at.getTime()>45000){reason='lookup_timeout';status='failed';}
 else if(result?.proposal){
  const parsed=semanticProposalSchema.safeParse(result.proposal);
  if(!parsed.success||parsed.data.expression.surface!==row.snapshot.expression?.text){reason='invalid_proposal';status='failed';}
  else{proposal=parsed.data;provenance={provider:result.provider,model:result.model,policyVersion:'consumer-semantic-v1',inputDigest:row.input_digest,outputDigest:await contentHash(proposal)};reason='';status='ready';}
 }
 const saved=(await db.query('UPDATE sensa_consumer.semantic_lookups SET status=$3,proposal=$4::jsonb,provenance=$5::jsonb,reason=$6 WHERE learner_user_id=$1 AND id=$2 RETURNING *',[a.learner_user_id,id,status,proposal?JSON.stringify(proposal):null,provenance?JSON.stringify(provenance):null,reason||null])).rows[0]!;return lookupView(saved);
}
function meaningView(row:Record<string,any>){return personalMeaningViewSchema.parse({id:row.id,contextAnchorId:row.context_anchor_id,expressionAnchorId:row.expression_anchor_id,revision:'1',status:'confirmed',snapshot:row.snapshot,proposal:row.proposal,senseId:row.sense_id,senseVersionId:row.sense_version_id,bindingId:row.binding_id,bindingVersionId:row.binding_version_id,alignmentId:row.alignment_id,acceptanceId:row.acceptance_id,acceptedAt:row.accepted_at.toISOString(),acceptanceKind:'direct'});}
export async function listMeanings(db:DatabaseExecutor,a:Scope){const rows=(await db.query('SELECT * FROM sensa_consumer.personal_meanings WHERE learner_user_id=$1 ORDER BY accepted_at DESC,id LIMIT 501',[a.learner_user_id])).rows;if(rows.length>500)throw new ConsumerError(409,'snapshot_limit_exceeded');return rows.map(meaningView);}
export async function acceptSemantic(db:DatabaseExecutor,a:Scope,op:SemanticAcceptOperation){
 const lookup=await readLookup(db,a,op.payload.lookupId);
 if(lookup.status!=='ready'||!lookup.proposal||!lookup.snapshot.expression)throw new ConsumerError(409,'proposal_not_ready');
 const identity=await contentHash(captureIdentity(lookup.snapshot));
 const old=(await db.query('SELECT * FROM sensa_consumer.personal_meanings WHERE learner_user_id=$1 AND identity_digest=$2',[a.learner_user_id,identity])).rows[0];
 if(op.payload.intakeId){const intake=(await db.query('SELECT * FROM sensa_consumer.intakes WHERE learner_user_id=$1 AND id=$2',[a.learner_user_id,op.payload.intakeId])).rows[0];if(!intake||intake.identity_digest!==identity)throw new ConsumerError(409,'intake_mismatch');}
 if(old){await closeInbox(old.id);return {meaning:meaningView(old),alreadySaved:true};}
 if(Date.parse(lookup.expiresAt)<=a.now.getTime())throw new ConsumerError(409,'proposal_expired');
 const semanticDigest=await contentHash({semanticSpec:lookup.proposal.semanticSpec,expression:lookup.proposal.expression});
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[semanticDigest]);
 const shared=(await db.query('SELECT * FROM sensa_consumer.accepted_semantic_identities WHERE digest=$1',[semanticDigest])).rows[0];
 const sid=shared?.sense_id??crypto.randomUUID(),vid=shared?.sense_version_id??crypto.randomUUID(),bid=shared?.binding_id??crypto.randomUUID(),bvid=shared?.binding_version_id??crypto.randomUUID();
 const provenance={sourceKind:'learner_confirmed',sourceReferenceIds:[],generator:{...lookup.provenance,promptVersion:'consumer-semantic-v1'}};
 if(!shared){await db.query('SELECT sensa_consumer.create_accepted_semantic_identity($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10::jsonb)',[sid,vid,crypto.randomUUID(),crypto.randomUUID(),bid,bvid,JSON.stringify(lookup.proposal.semanticSpec),lookup.proposal.expression.surface,lookup.proposal.expression.type,JSON.stringify(provenance)]);await db.query('INSERT INTO sensa_consumer.accepted_semantic_identities(digest,sense_id,sense_version_id,binding_id,binding_version_id) VALUES($1,$2,$3,$4,$5)',[semanticDigest,sid,vid,bid,bvid]);}
 const row=(await db.query('INSERT INTO sensa_consumer.personal_meanings(id,learner_user_id,identity_digest,snapshot,proposal,sense_id,sense_version_id,binding_id,binding_version_id,alignment_id,acceptance_id,accepted_at,lookup_id,operation_id,installation_id,session_id) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *',[crypto.randomUUID(),a.learner_user_id,identity,JSON.stringify(lookup.snapshot),JSON.stringify(lookup.proposal),sid,vid,bid,bvid,crypto.randomUUID(),crypto.randomUUID(),a.now,lookup.id,op.operationId,op.installationId,a.session_id])).rows[0]!;
 await closeInbox(row.id);return {meaning:meaningView(row),alreadySaved:false};
 async function closeInbox(meaningId:string){await db.query('UPDATE sensa_consumer.intakes SET meaning_id=$3,revision=revision+1 WHERE learner_user_id=$1 AND identity_digest=$2 AND meaning_id IS NULL',[a.learner_user_id,identity,meaningId]);}
}

async function expireLookup(db:DatabaseExecutor,a:Scope,id:string){await db.query("UPDATE sensa_consumer.semantic_lookups l SET snapshot=NULL,proposal=NULL,provenance=NULL,status='failed',reason='lookup_expired' WHERE learner_user_id=$1 AND expires_at<=$2 AND snapshot IS NOT NULL AND NOT EXISTS(SELECT 1 FROM sensa_consumer.personal_meanings m WHERE m.learner_user_id=l.learner_user_id AND m.lookup_id=l.id)",[a.learner_user_id,a.now]);await db.query("UPDATE sensa_consumer.semantic_lookups SET status='failed',reason='lookup_timeout' WHERE learner_user_id=$1 AND id=$2 AND status='running' AND created_at<$3",[a.learner_user_id,id,new Date(a.now.getTime()-45000)]);}
