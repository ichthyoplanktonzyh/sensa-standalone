import {semanticProposalSchema,semanticLookupViewSchema,personalMeaningViewSchema,captureIdentity} from '@sensa/contracts/sensa';
import type {SemanticLookupInput,SemanticAcceptOperation,SemanticLookupView} from '@sensa/contracts/sensa';
import type {DatabaseExecutor} from '../../database/index.js';
import type {SemanticResolution} from './semanticResolver.js';
import {contentHash} from '../curriculum/targets.js';
import {ConsumerError} from '../access/auth.js';
type Scope={learner_user_id:string;now:Date;session_id:string};
function lookupView(row:Record<string,any>):SemanticLookupView{if(!row.snapshot)throw new ConsumerError(404,'lookup_expired');return semanticLookupViewSchema.parse({id:row.id,revision:'1',snapshot:row.snapshot,focus:row.meaning_focus??null,status:row.status,proposal:row.proposal,reason:row.reason,expiresAt:row.expires_at.toISOString(),provenance:row.provenance});}
export async function readLookup(db:DatabaseExecutor,a:Scope,id:string){await expireLookup(db,a,id);const row=(await db.query('SELECT * FROM sensa_consumer.semantic_lookups WHERE learner_user_id=$1 AND id=$2',[a.learner_user_id,id])).rows[0];if(!row)throw new ConsumerError(404,'not_found');return lookupView(row);}
export async function beginLookup(db:DatabaseExecutor,a:Scope,input:SemanticLookupInput){
 await expireLookup(db,a,input.id);
 const digest=await contentHash(input.clarification?{snapshot:input.snapshot,clarification:input.clarification}:input.snapshot),old=(await db.query('SELECT * FROM sensa_consumer.semantic_lookups WHERE learner_user_id=$1 AND id=$2',[a.learner_user_id,input.id])).rows[0];
 if(old){if(old.input_digest!==digest)throw new ConsumerError(409,'lookup_id_reuse');return {fresh:false,view:lookupView(old)};}
 if(!input.snapshot.expression)throw new ConsumerError(409,'expression_required');
 let focus=null;
 if(input.clarification){
  const previous=await readLookup(db,a,input.clarification.previousLookupId);
  if(previous.reason==='superseded'||previous.status==='running')throw new ConsumerError(409,'clarification_not_allowed');
  if(await contentHash(previous.snapshot)!==await contentHash(input.snapshot))throw new ConsumerError(409,'clarification_context_mismatch');
  const accepted=(await db.query('SELECT id FROM sensa_consumer.personal_meanings WHERE learner_user_id=$1 AND identity_digest=$2',[a.learner_user_id,await contentHash(captureIdentity(input.snapshot))])).rows[0];
  if(accepted)throw new ConsumerError(409,'meaning_already_confirmed');
  focus={id:crypto.randomUUID(),constructionId:previous.focus?.constructionId??crypto.randomUUID(),previousLookupId:previous.id,text:input.clarification.text};
 }

 const count=(await db.query('SELECT count(*)::int AS n FROM sensa_consumer.semantic_lookups WHERE learner_user_id=$1 AND created_at>$2',[a.learner_user_id,new Date(a.now.getTime()-86400000)])).rows[0]!.n;
 if(count>=30)throw new ConsumerError(409,'semantic_daily_budget');
 const row=(await db.query("INSERT INTO sensa_consumer.semantic_lookups(id,learner_user_id,input_digest,snapshot,status,created_at,expires_at,meaning_focus) VALUES($1,$2,$3,$4::jsonb,'running',$5,$6,$7::jsonb) RETURNING *",[input.id,a.learner_user_id,digest,JSON.stringify(input.snapshot),a.now,new Date(a.now.getTime()+86400000),focus?JSON.stringify(focus):null])).rows[0]!;
 if(focus)await db.query("UPDATE sensa_consumer.semantic_lookups SET status='failed',reason='superseded' WHERE learner_user_id=$1 AND id=$2",[a.learner_user_id,focus.previousLookupId]);
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
  else{proposal=parsed.data;provenance={provider:result.provider,model:result.model,policyVersion:row.meaning_focus?'consumer-semantic-v2':'consumer-semantic-v1',inputDigest:row.input_digest,outputDigest:await contentHash(proposal)};reason='';status='ready';}
 }
 const saved=(await db.query('UPDATE sensa_consumer.semantic_lookups SET status=$3,proposal=$4::jsonb,provenance=$5::jsonb,reason=$6 WHERE learner_user_id=$1 AND id=$2 RETURNING *',[a.learner_user_id,id,status,proposal?JSON.stringify(proposal):null,provenance?JSON.stringify(provenance):null,reason||null])).rows[0]!;return lookupView(saved);
}
export function meaningView(row:Record<string,any>){return personalMeaningViewSchema.parse({id:row.id,contextAnchorId:row.context_anchor_id,expressionAnchorId:row.expression_anchor_id,revision:String(row.revision),status:row.removed_at?'removed':'confirmed',focus:row.meaning_focus??null,anchorUseGrantId:row.anchor_use_grant_id??null,snapshot:row.snapshot,proposal:row.proposal,senseId:row.sense_id,senseVersionId:row.sense_version_id,bindingId:row.binding_id,bindingVersionId:row.binding_version_id,alignmentId:row.alignment_id,acceptanceId:row.acceptance_id,acceptedAt:row.accepted_at.toISOString(),acceptanceKind:'direct'});}
export async function listMeanings(db:DatabaseExecutor,a:Scope){const rows=(await db.query('SELECT * FROM sensa_consumer.personal_meanings WHERE learner_user_id=$1 ORDER BY accepted_at DESC,id LIMIT 501',[a.learner_user_id])).rows;if(rows.length>500)throw new ConsumerError(409,'snapshot_limit_exceeded');return rows.map(meaningView);}
export async function acceptSemantic(db:DatabaseExecutor,a:Scope,op:SemanticAcceptOperation){
 const lookup=await readLookup(db,a,op.payload.lookupId);
 if(lookup.status!=='ready'||!lookup.proposal||!lookup.snapshot.expression)throw new ConsumerError(409,'proposal_not_ready');
 const identity=await contentHash(captureIdentity(lookup.snapshot));
 const old=(await db.query('SELECT * FROM sensa_consumer.personal_meanings WHERE learner_user_id=$1 AND identity_digest=$2',[a.learner_user_id,identity])).rows[0];
 if(op.payload.intakeId){const intake=(await db.query('SELECT * FROM sensa_consumer.intakes WHERE learner_user_id=$1 AND id=$2',[a.learner_user_id,op.payload.intakeId])).rows[0];if(!intake||intake.removed_at||intake.identity_digest!==identity)throw new ConsumerError(409,'intake_mismatch');}
 if(old?.removed_at)throw new ConsumerError(409,'meaning_removed');
 const removedIntake=(await db.query('SELECT id FROM sensa_consumer.intakes WHERE learner_user_id=$1 AND identity_digest=$2 AND removed_at IS NOT NULL',[a.learner_user_id,identity])).rows[0];if(removedIntake)throw new ConsumerError(409,'intake_removed');
 if(old){await closeInbox(old.id);return {meaning:meaningView(old),alreadySaved:true};}
 if(Date.parse(lookup.expiresAt)<=a.now.getTime())throw new ConsumerError(409,'proposal_expired');
 const semanticDigest=await contentHash({semanticSpec:lookup.proposal.semanticSpec,expression:lookup.proposal.expression});
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[semanticDigest]);
 const shared=(await db.query('SELECT * FROM sensa_consumer.accepted_semantic_identities WHERE digest=$1',[semanticDigest])).rows[0];
 const sid=shared?.sense_id??crypto.randomUUID(),vid=shared?.sense_version_id??crypto.randomUUID(),bid=shared?.binding_id??crypto.randomUUID(),bvid=shared?.binding_version_id??crypto.randomUUID();
 const provenance={sourceKind:'learner_confirmed',sourceReferenceIds:[],generator:{...lookup.provenance,promptVersion:lookup.provenance?.policyVersion??'consumer-semantic-v1'}};
 if(!shared){await db.query('SELECT sensa_consumer.create_accepted_semantic_identity($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10::jsonb)',[sid,vid,crypto.randomUUID(),crypto.randomUUID(),bid,bvid,JSON.stringify(lookup.proposal.semanticSpec),lookup.proposal.expression.surface,lookup.proposal.expression.type,JSON.stringify(provenance)]);await db.query('INSERT INTO sensa_consumer.accepted_semantic_identities(digest,sense_id,sense_version_id,binding_id,binding_version_id) VALUES($1,$2,$3,$4,$5)',[semanticDigest,sid,vid,bid,bvid]);}
 const row=(await db.query('INSERT INTO sensa_consumer.personal_meanings(id,learner_user_id,identity_digest,snapshot,proposal,sense_id,sense_version_id,binding_id,binding_version_id,alignment_id,acceptance_id,accepted_at,lookup_id,operation_id,installation_id,session_id,meaning_focus) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb) RETURNING *',[crypto.randomUUID(),a.learner_user_id,identity,JSON.stringify(lookup.snapshot),JSON.stringify(lookup.proposal),sid,vid,bid,bvid,crypto.randomUUID(),crypto.randomUUID(),a.now,lookup.id,op.operationId,op.installationId,a.session_id,lookup.focus?JSON.stringify(lookup.focus):null])).rows[0]!;
 await closeInbox(row.id);return {meaning:meaningView(row),alreadySaved:false};
 async function closeInbox(meaningId:string){await db.query('UPDATE sensa_consumer.intakes SET meaning_id=$3,revision=revision+1 WHERE learner_user_id=$1 AND identity_digest=$2 AND meaning_id IS NULL',[a.learner_user_id,identity,meaningId]);}
}

async function expireLookup(db:DatabaseExecutor,a:Scope,id:string){await db.query("UPDATE sensa_consumer.semantic_lookups l SET snapshot=NULL,proposal=NULL,provenance=NULL,meaning_focus=NULL,status='failed',reason='lookup_expired' WHERE learner_user_id=$1 AND expires_at<=$2 AND snapshot IS NOT NULL AND NOT EXISTS(SELECT 1 FROM sensa_consumer.personal_meanings m WHERE m.learner_user_id=l.learner_user_id AND m.lookup_id=l.id)",[a.learner_user_id,a.now]);await db.query("UPDATE sensa_consumer.semantic_lookups SET status='failed',reason='lookup_timeout' WHERE learner_user_id=$1 AND id=$2 AND status='running' AND created_at<$3",[a.learner_user_id,id,new Date(a.now.getTime()-45000)]);}
