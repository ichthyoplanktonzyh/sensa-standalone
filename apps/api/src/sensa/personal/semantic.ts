import {semanticProposalSchema,semanticLookupViewSchema} from '@sensa/contracts/sensa';
import type {SemanticLookupInput,SemanticLookupView} from '@sensa/contracts/sensa';
import type {DatabaseExecutor} from '../../database/index.js';
import type {SemanticResolution} from './semanticResolver.js';
import {contentHash} from '../shared/contentHash.js';
import {ConsumerError} from '../access/auth.js';
type Scope={account_id:string;learner_user_id:string;now:Date;session_id:string};
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
  focus={id:crypto.randomUUID(),constructionId:previous.focus?.constructionId??crypto.randomUUID(),previousLookupId:previous.id,text:input.clarification.text};
 }

 const count=(await db.query('SELECT ((SELECT count(*) FROM sensa_consumer.semantic_lookups WHERE learner_user_id=$1 AND created_at>$3)+(SELECT count(*) FROM sensa_consumer.native_semantic_usage WHERE account_id=$2 AND created_at>$3))::int AS n',[a.learner_user_id,a.account_id,new Date(a.now.getTime()-86400000)])).rows[0]!.n;
 if(process.env.SENSA_UNLIMITED_MODEL_USAGE!=='true'&&count>=30)throw new ConsumerError(409,'semantic_daily_budget');
 const row=(await db.query("INSERT INTO sensa_consumer.semantic_lookups(id,learner_user_id,input_digest,snapshot,status,created_at,expires_at,meaning_focus) VALUES($1,$2,$3,$4::jsonb,'running',$5,$6,$7::jsonb) RETURNING *",[input.id,a.learner_user_id,digest,JSON.stringify(input.snapshot),a.now,new Date(a.now.getTime()+86400000),focus?JSON.stringify(focus):null])).rows[0]!;
 if(focus)await db.query("UPDATE sensa_consumer.semantic_lookups SET status='failed',reason='superseded' WHERE learner_user_id=$1 AND id=$2",[a.learner_user_id,focus.previousLookupId]);
 return {fresh:true,view:lookupView(row)};
}
export async function finishLookup(db:DatabaseExecutor,a:Scope,id:string,result:SemanticResolution|null,failureReason='provider_unavailable'){
 const row=(await db.query('SELECT * FROM sensa_consumer.semantic_lookups WHERE learner_user_id=$1 AND id=$2',[a.learner_user_id,id])).rows[0]!;
 if(row.status!=='running')return lookupView(row);
 let proposal=null,provenance=null,reason=result?'meaning_unresolved':failureReason,status=result?'unresolved':'failed';
 if(a.now.getTime()-row.created_at.getTime()>45000){reason='lookup_timeout';status='failed';}
 else if(result?.proposal){
  const parsed=semanticProposalSchema.safeParse(result.proposal);
  if(!parsed.success||parsed.data.expression.surface!==row.snapshot.expression?.text){reason='invalid_proposal';status='failed';}
  else{proposal=parsed.data;provenance={provider:result.provider,model:result.model,policyVersion:result.policyVersion??(row.meaning_focus?'sensa-semantic-v2':'sensa-semantic-v1'),inputDigest:row.input_digest,outputDigest:await contentHash(proposal)};reason='';status='ready';}
 }
 const saved=(await db.query('UPDATE sensa_consumer.semantic_lookups SET status=$3,proposal=$4::jsonb,provenance=$5::jsonb,reason=$6 WHERE learner_user_id=$1 AND id=$2 RETURNING *',[a.learner_user_id,id,status,proposal?JSON.stringify(proposal):null,provenance?JSON.stringify(provenance):null,reason||null])).rows[0]!;return lookupView(saved);
}
async function expireLookup(db:DatabaseExecutor,a:Scope,id:string){await db.query("UPDATE sensa_consumer.semantic_lookups SET snapshot=NULL,proposal=NULL,provenance=NULL,meaning_focus=NULL,status='failed',reason='lookup_expired' WHERE learner_user_id=$1 AND expires_at<=$2 AND snapshot IS NOT NULL",[a.learner_user_id,a.now]);await db.query("UPDATE sensa_consumer.semantic_lookups SET status='failed',reason='lookup_timeout' WHERE learner_user_id=$1 AND id=$2 AND status='running' AND created_at<$3",[a.learner_user_id,id,new Date(a.now.getTime()-45000)]);}
