import { z } from 'zod';
import { canonicalConsumerJson, catalogTargetSchema, targetViewSchema, sensaLightweightInitialMaterializationContentSchema } from '@sensa/contracts/sensa';
import type { CatalogTarget, TargetView, TargetOperation } from '@sensa/contracts/sensa';
import type { DatabaseExecutor } from '../../database/index.js';
import {bytesDigest} from '../media/consumer.js';
import { ConsumerError } from '../access/auth.js';

type Scope={learner_user_id:string;account_id:string};
export async function contentHash(value:unknown){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalConsumerJson(value)))),b=>b.toString(16).padStart(2,'0')).join('');}
export async function learnerScope(db:DatabaseExecutor,a:Scope){
  let row=(await db.query('SELECT workspace_id FROM sensa_consumer.learner_scopes WHERE learner_user_id=$1',[a.learner_user_id])).rows[0];
  if(!row){
    const id=crypto.randomUUID();await db.query("INSERT INTO org.workspaces(workspace_id,name) VALUES($1,'Sensa learner scope')",[id]);
    await db.query('INSERT INTO org.workspace_members(workspace_id,learner_user_id) VALUES($1,$2)',[id,a.learner_user_id]);
    await db.query('INSERT INTO sensa_consumer.learner_scopes(learner_user_id,workspace_id) VALUES($1,$2)',[a.learner_user_id,id]);row={workspace_id:id};
  }
  await db.query("SELECT set_config('app.user_id',$1,true),set_config('app.workspace_id',$2,true)",[a.learner_user_id,row.workspace_id]);return row.workspace_id as string;
}
function candidate(row:Record<string,any>):CatalogTarget{return catalogTargetSchema.parse({candidateId:row.id,senseId:row.sense_id,senseVersionId:row.sense_version_id,bindingId:row.binding_id,bindingVersionId:row.binding_version_id,expression:row.expression,meaning:row.meaning,targetLanguageTag:row.target_language,familiarLanguageTag:row.familiar_language,learnerLocale:row.learner_locale,source:row.source,admission:row.admission});}
async function candidateRow(db:DatabaseExecutor,id:string){
  const row=(await db.query('SELECT * FROM sensa_consumer.catalog_candidates WHERE id=$1',[id])).rows[0];
  if(!row)throw new ConsumerError(404,'target_not_found');return row;
}
export async function listCatalog(db:DatabaseExecutor,input:{q?:string;cursor?:string;limit?:number;sourceId?:string}){
  const limit=input.limit??30;
  const rows=(await db.query(`SELECT * FROM sensa_consumer.catalog_candidates WHERE ($1::text IS NULL OR expression ILIKE '%'||$1||'%' OR meaning ILIKE '%'||$1||'%')
    AND ($2::uuid IS NULL OR id>$2) AND ($3::text IS NULL OR source->>'id'=$3) ORDER BY id LIMIT $4`,[input.q??null,input.cursor??null,input.sourceId??null,limit+1])).rows;
  return {items:rows.slice(0,limit).map(candidate),nextCursor:rows.length>limit?rows[limit-1]!.id:null};
}
export async function targetView(db:DatabaseExecutor,a:Scope,id:string,byCandidate=false):Promise<TargetView>{
  await learnerScope(db,a);
  const member=(await db.query(`SELECT m.*,p.id AS plan_id,p.revision AS plan_revision,p.readiness,p.reason,p.retry_allowed,p.materialization_id
    FROM sensa_consumer.target_memberships m JOIN sensa_consumer.target_plans p ON p.membership_id=m.id
    WHERE m.learner_user_id=$1 AND ${byCandidate?'m.retention_target_id IN (SELECT r.retention_target_id FROM sensa.retention_targets r JOIN sensa_consumer.catalog_candidates c ON c.sense_id=r.sense_id AND c.binding_id=r.sense_expression_binding_id WHERE c.id=$2)':'m.learning_target_id=$2'}`,[a.learner_user_id,id])).rows[0];
  if(!member&&!byCandidate)throw new ConsumerError(404,'target_not_found');
  const c=candidate(await candidateRow(db,byCandidate?id:member!.candidate_id));
  if(!member)return targetViewSchema.parse({candidate:c,learningTarget:null,retentionTarget:null,membership:null,declaredMastery:{active:false,revision:'0'},plan:null,phase:'new',dueAt:null});
  const l=(await db.query('SELECT * FROM sensa.learning_targets WHERE learning_target_id=$1 AND learner_user_id=$2',[member.learning_target_id,a.learner_user_id])).rows[0]!;
  const r=(await db.query('SELECT * FROM sensa.retention_targets WHERE retention_target_id=$1 AND learner_user_id=$2',[member.retention_target_id,a.learner_user_id])).rows[0]!;
  const sources=(await db.query('SELECT c.source FROM sensa_consumer.target_sources s JOIN sensa_consumer.catalog_candidates c ON c.id=s.candidate_id WHERE s.membership_id=$1 ORDER BY c.id',[member.id])).rows.map(x=>x.source);
  const mastery=(await db.query('SELECT active,revision FROM sensa_consumer.declared_masteries WHERE retention_target_id=$1',[member.retention_target_id])).rows[0];
  const runtime=(await db.query('SELECT r.status,m.due_at FROM sensa_consumer.runs r LEFT JOIN sensa_consumer.retention_memory m ON m.retention_target_id=r.retention_target_id WHERE r.retention_target_id=$1',[member.retention_target_id])).rows[0];
  const contractVersion='sensa-learning-connection-v2';
  return targetViewSchema.parse({candidate:c,learningTarget:{contractVersion,learningTargetId:l.learning_target_id,learnerUserId:l.learner_user_id,senseId:l.sense_id,senseVersionId:l.sense_version_id,senseExpressionBindingId:l.sense_expression_binding_id,bindingVersionId:l.binding_version_id,familiarLanguageTag:l.familiar_language_tag,targetLanguageTag:l.target_language_tag,learnerLocale:l.learner_locale,curriculumProvenance:l.curriculum_provenance,createdByOperationId:l.created_by_operation_id,createdAt:l.created_at.toISOString()},
    retentionTarget:{contractVersion,retentionTargetId:r.retention_target_id,learningTargetId:l.learning_target_id,learnerUserId:r.learner_user_id,senseId:r.sense_id,senseExpressionBindingId:r.sense_expression_binding_id,retentionScopeKey:r.retention_scope_key,status:r.status,revision:Number(r.revision),createdAt:r.created_at.toISOString(),updatedAt:r.updated_at.toISOString()},
    membership:{id:member.id,revision:String(member.revision),status:member.status,provenances:sources},declaredMastery:{active:mastery?.active??false,revision:String(mastery?.revision??0)},
    plan:{id:member.plan_id,revision:String(member.plan_revision),purpose:'initial_learning',readiness:member.readiness,reason:member.reason,retryAllowed:member.retry_allowed,materializationId:member.materialization_id,policyId:'lightweight',policyVersion:'v1'},phase:runtime?.status==='completed'?'retaining':runtime?'acquiring':'new',dueAt:runtime?.due_at?.toISOString()??null});
}
export async function listTargets(db:DatabaseExecutor,a:Scope){
  const rows=(await db.query('SELECT learning_target_id FROM sensa_consumer.target_memberships WHERE learner_user_id=$1 ORDER BY id LIMIT 501',[a.learner_user_id])).rows;
  if(rows.length>500)throw new ConsumerError(409,'snapshot_limit_exceeded');
  const views:TargetView[]=[];for(const row of rows)views.push(await targetView(db,a,row.learning_target_id));return views;
}
async function validateAdmission(db:DatabaseExecutor,row:Record<string,any>){
  if(row.admission!=='available')throw new ConsumerError(409,'target_unavailable');
  const binding=(await db.query(`SELECT ev.surface_form,e.language_tag,sv.semantic_spec->>'coreMeaningFocus' AS meaning FROM sensa.sense_expression_binding_versions bv
    JOIN sensa.sense_expression_bindings b ON b.sense_expression_binding_id=bv.sense_expression_binding_id
    JOIN sensa.expression_versions ev ON ev.expression_version_id=bv.expression_version_id
    JOIN sensa.expressions e ON e.expression_id=ev.expression_id
    JOIN sensa.sense_versions sv ON sv.sense_version_id=bv.sense_version_id
    WHERE bv.binding_version_id=$1 AND bv.sense_expression_binding_id=$2 AND bv.sense_version_id=$3 AND b.sense_id=$4
    AND bv.semantic_review_status='reviewed' AND sv.semantic_review_status='reviewed' AND b.relation='realizes' AND bv.semantic_coverage='exact'`,[row.binding_version_id,row.binding_id,row.sense_version_id,row.sense_id])).rows[0];
  if(!binding||binding.meaning!==row.meaning||binding.surface_form!==row.expression||binding.language_tag!==row.target_language||row.familiar_language===row.target_language)throw new ConsumerError(409,'invalid_binding');
}
async function prepare(db:DatabaseExecutor,a:Scope,member:Record<string,any>,workspaceId:string){
  const row=await candidateRow(db,member.candidate_id);
  const parsed=sensaLightweightInitialMaterializationContentSchema.safeParse(row.content);
  let reason:string|null=null;
  if(!parsed.success||await contentHash(row.content)!==row.content_digest)reason='material_invalid';
  if(parsed.success&&!reason){
    for(const resource of parsed.data.resources){if(await contentHash(resource.contentPayload)!==resource.contentDigest)reason='material_invalid';}
    if(parsed.data.resources.find(x=>x.materialRoleKey==='target_expression')?.contentPayload.surface!==row.expression||parsed.data.resources.find(x=>x.materialRoleKey==='sense_confirmation')?.contentPayload.meaning!==row.meaning)reason='material_invalid';
    for(const resource of parsed.data.resources){
      if(resource.materialRoleKey!=='pronunciation'||!resource.contentPayload.audioUrl)continue;
      const reference=String(resource.contentPayload.audioUrl).match(/^sensa-media:([0-9a-f]{64})$/u);
      const media=reference?(await db.query('SELECT source_text_digest FROM sensa_consumer.published_media WHERE digest=$1',[reference[1]])).rows[0]:null;
      if(!reference)reason='material_invalid';
      else if(!media||media.source_text_digest!==await bytesDigest(new TextEncoder().encode(row.expression)))reason='media_missing';
    }
  }
  let materialId:string|null=null;
  if(!reason){
    materialId=crypto.randomUUID();await db.query(`INSERT INTO sensa.learning_materializations(learning_materialization_id,workspace_id,learner_user_id,learning_target_id,protocol_purpose,provisioning_path,content_schema_version,content_payload,content_digest,validation_status,validator_version,provenance)
      VALUES($1,$2,$3,$4,'initial_learning','published','lightweight-initial-materialization-v1',$5::jsonb,$6,'validated','consumer-published-text-v1',$7::jsonb)`,[materialId,workspaceId,a.learner_user_id,member.learning_target_id,JSON.stringify(row.content),row.content_digest,JSON.stringify({candidateId:row.id,reviewReference:row.review_reference})]);
  }
  await db.query('UPDATE sensa_consumer.target_plans SET revision=revision+1,readiness=$2,reason=$3,retry_allowed=$5,materialization_id=$4 WHERE membership_id=$1',[member.id,reason?'blocked':'ready',reason,materialId,reason==='media_missing']);
}
export async function applyTargetOperation(db:DatabaseExecutor,a:Scope,op:TargetOperation){
  const workspaceId=await learnerScope(db,a);
  const study=(await db.query('SELECT * FROM sensa_consumer.plans WHERE learner_user_id=$1 FOR UPDATE',[a.learner_user_id])).rows[0];
  if(!study)throw new ConsumerError(409,'onboarding_required');
  if(study.policy_key!=='lightweight-v1')throw new ConsumerError(409,'unsupported_policy');
  if(op.kind==='declared_mastery.set'){
    if((await db.query("SELECT id FROM sensa_consumer.runs WHERE learner_user_id=$1 AND retention_target_id=$2 AND status='active'",[a.learner_user_id,op.payload.retentionTargetId])).rows.length)throw new ConsumerError(409,'pending_result');
    const member=(await db.query('SELECT learning_target_id FROM sensa_consumer.target_memberships WHERE retention_target_id=$1 AND learner_user_id=$2',[op.payload.retentionTargetId,a.learner_user_id])).rows[0];
    if(!member)throw new ConsumerError(404,'target_not_found');
    const view=await targetView(db,a,member.learning_target_id);
    if(view.declaredMastery.revision!==op.payload.expectedRevision)throw new ConsumerError(409,'revision_conflict');
    await db.query('INSERT INTO sensa_consumer.declared_masteries(retention_target_id,active,revision) VALUES($1,$2,1) ON CONFLICT(retention_target_id) DO UPDATE SET active=EXCLUDED.active,revision=sensa_consumer.declared_masteries.revision+1',[op.payload.retentionTargetId,op.payload.active]);
    await db.query('UPDATE sensa_consumer.target_memberships SET revision=revision+1 WHERE retention_target_id=$1',[op.payload.retentionTargetId]);
    await db.query('UPDATE sensa_consumer.plans SET scope_revision=scope_revision+1,revision=revision+1 WHERE learner_user_id=$1',[a.learner_user_id]);
    return {target:await targetView(db,a,member.learning_target_id)};
  }
  if(op.kind==='learning.retry_preparation'){
    const view=await targetView(db,a,op.payload.learningTargetId);
    if(view.plan?.revision!==op.payload.expectedPlanRevision)throw new ConsumerError(409,'revision_conflict');
    if(!view.plan.retryAllowed)throw new ConsumerError(409,'retry_not_allowed');
    const member=(await db.query('SELECT * FROM sensa_consumer.target_memberships WHERE id=$1',[view.membership!.id])).rows[0]!;
    await prepare(db,a,member,workspaceId);return {target:await targetView(db,a,op.payload.learningTargetId)};
  }
  const row=await candidateRow(db,op.payload.candidateId);await validateAdmission(db,row);
  if(canonicalConsumerJson(row.source)!==canonicalConsumerJson(op.payload.source))throw new ConsumerError(409,'invalid_source');
  if(study.id!==op.payload.planId)throw new ConsumerError(409,'revision_conflict');
  const old=await targetView(db,a,row.id,true);
  if(old.membership){
    if(old.retentionTarget?.status!=='active')throw new ConsumerError(409,'target_unavailable');
    if(old.declaredMastery.active)throw new ConsumerError(409,'declared_mastery_active');
    const l=old.learningTarget!;
    if(l.senseVersionId!==row.sense_version_id||l.bindingVersionId!==row.binding_version_id||l.familiarLanguageTag!==row.familiar_language||l.targetLanguageTag!==row.target_language||l.learnerLocale!==row.learner_locale)throw new ConsumerError(409,'target_version_conflict');
    const added=await db.query('INSERT INTO sensa_consumer.target_sources(membership_id,candidate_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[old.membership.id,row.id]);
    if(added.rowCount)await db.query('UPDATE sensa_consumer.target_memberships SET revision=revision+1 WHERE id=$1',[old.membership.id]);
    return {disposition:'already_in_scope' as const,target:await targetView(db,a,l.learningTargetId)};
  }
  if(String(study.scope_revision)!==op.payload.expectedScopeRevision)throw new ConsumerError(409,'revision_conflict');
  const retentionId=crypto.randomUUID(),targetId=crypto.randomUUID();
  await db.query('INSERT INTO sensa.retention_targets(retention_target_id,workspace_id,learner_user_id,sense_id,sense_expression_binding_id) VALUES($1,$2,$3,$4,$5)',[retentionId,workspaceId,a.learner_user_id,row.sense_id,row.binding_id]);
  await db.query(`INSERT INTO sensa.learning_targets(learning_target_id,workspace_id,learner_user_id,retention_target_id,sense_id,sense_version_id,sense_expression_binding_id,binding_version_id,familiar_language_tag,target_language_tag,learner_locale,curriculum_provenance,created_by_operation_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)`,[targetId,workspaceId,a.learner_user_id,retentionId,row.sense_id,row.sense_version_id,row.binding_id,row.binding_version_id,row.familiar_language,row.target_language,row.learner_locale,JSON.stringify(row.source),op.operationId]);
  await db.query('INSERT INTO sensa_consumer.canonical_targets(retention_target_id,learning_target_id,learner_user_id,sense_id,binding_id) VALUES($1,$2,$3,$4,$5)',[retentionId,targetId,a.learner_user_id,row.sense_id,row.binding_id]);
  const member=(await db.query('INSERT INTO sensa_consumer.target_memberships(learner_user_id,retention_target_id,learning_target_id,candidate_id) VALUES($1,$2,$3,$4) RETURNING *',[a.learner_user_id,retentionId,targetId,row.id])).rows[0]!;
  await db.query('INSERT INTO sensa_consumer.target_sources(membership_id,candidate_id) VALUES($1,$2)',[member.id,row.id]);
  await db.query("INSERT INTO sensa_consumer.target_plans(membership_id,readiness) VALUES($1,'preparing')",[member.id]);
  await prepare(db,a,member,workspaceId);
  await db.query('UPDATE sensa_consumer.plans SET scope_revision=scope_revision+1,revision=revision+1 WHERE learner_user_id=$1',[a.learner_user_id]);
  return {disposition:'accepted' as const,target:await targetView(db,a,targetId)};
}
export async function materialView(db:DatabaseExecutor,a:Scope,id:string){
  await learnerScope(db,a);
  const row=(await db.query(`SELECT m.content_payload,m.content_digest FROM sensa.learning_materializations m
    JOIN sensa_consumer.target_plans p ON p.materialization_id=m.learning_materialization_id
    JOIN sensa_consumer.target_memberships t ON t.id=p.membership_id
    WHERE m.learning_materialization_id=$1 AND m.learner_user_id=$2 AND t.learner_user_id=$2 AND p.readiness='ready'`,[id,a.learner_user_id])).rows[0];
  if(!row)throw new ConsumerError(404,'material_not_found');
  return {id,digest:row.content_digest,content:sensaLightweightInitialMaterializationContentSchema.parse(row.content_payload)};
}
export const catalogQuerySchema=z.object({q:z.string().max(200).optional(),sourceId:z.string().max(200).optional(),cursor:z.string().uuid().optional(),limit:z.coerce.number().int().min(1).max(100).optional()}).strict();

export async function authorizeMedia(db:DatabaseExecutor,a:Scope,materialId:string,digest:string){
  const material=await materialView(db,a,materialId);
  if(!material.content.resources.some(r=>r.materialRoleKey==='pronunciation'&&r.contentPayload.audioUrl==='sensa-media:'+digest))throw new ConsumerError(404,'material_not_found');
  const media=(await db.query('SELECT * FROM sensa_consumer.published_media WHERE digest=$1',[digest])).rows[0];
  if(!media)throw new ConsumerError(503,'media_unavailable');return media;
}
