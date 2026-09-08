import type {AnchorUseOperation} from '@sensa/contracts/sensa';
import type {DatabaseExecutor} from '../../database/index.js';
import {ConsumerError} from '../access/auth.js';
import {contentHash} from '../curriculum/targets.js';
import {replaceMeaningTasks} from '../provisioning/tasks.js';
import {meaningView} from './semantic.js';
type Scope={learner_user_id:string;account_id:string;epoch:string;now:Date};
/** Revocation changes future preparation; immutable runs and their history remain readable. */
export async function revokeAnchorUse(db:DatabaseExecutor,a:Scope,row:Record<string,any>){
 if(!row.anchor_use_grant_id)return [];
 await db.query('UPDATE sensa_consumer.anchor_use_grants SET revoked_at=$3 WHERE id=$1 AND learner_user_id=$2 AND revoked_at IS NULL',[row.anchor_use_grant_id,a.learner_user_id,a.now]);
 await db.query('UPDATE sensa_consumer.personal_meanings SET anchor_use_grant_id=NULL WHERE id=$1 AND learner_user_id=$2',[row.id,a.learner_user_id]);
 return replaceMeaningTasks(db,a,row.id);
}
export async function setAnchorUse(db:DatabaseExecutor,a:Scope,op:AnchorUseOperation){
 const row=(await db.query('SELECT * FROM sensa_consumer.personal_meanings WHERE learner_user_id=$1 AND id=$2 FOR UPDATE',[a.learner_user_id,op.payload.meaningId])).rows[0];
 if(!row)throw new ConsumerError(404,'not_found');
 if(row.removed_at)throw new ConsumerError(409,'meaning_removed');
 if(String(row.revision)!==op.payload.expectedRevision)throw new ConsumerError(409,'revision_conflict');
 if(Boolean(row.anchor_use_grant_id)===op.payload.enabled)return {meaning:meaningView(row),alreadySaved:true,targetIds:[]};
 let targetIds:string[];
 if(op.payload.enabled){
  const grantId=crypto.randomUUID();
  await db.query("INSERT INTO sensa_consumer.anchor_use_grants(id,learner_user_id,meaning_id,context_anchor_id,context_version,purpose,provider,policy_version,granted_at) VALUES($1,$2,$3,$4,$5,'learning_content','deepseek','original-context-v1',$6)",[grantId,a.learner_user_id,row.id,row.context_anchor_id,await contentHash({anchorId:row.context_anchor_id,sentence:row.snapshot.sentence}),a.now]);
  await db.query('UPDATE sensa_consumer.personal_meanings SET anchor_use_grant_id=$3 WHERE id=$1 AND learner_user_id=$2',[row.id,a.learner_user_id,grantId]);
  targetIds=await replaceMeaningTasks(db,a,row.id);
 }else targetIds=await revokeAnchorUse(db,a,row);
 const saved=(await db.query('UPDATE sensa_consumer.personal_meanings SET revision=revision+1 WHERE id=$1 AND learner_user_id=$2 RETURNING *',[row.id,a.learner_user_id])).rows[0]!;
 return {meaning:meaningView(saved),alreadySaved:false,targetIds};
}
