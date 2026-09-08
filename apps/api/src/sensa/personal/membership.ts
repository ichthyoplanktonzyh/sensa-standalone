import type {ContentMembershipOperation} from '@sensa/contracts/sensa';
import type {DatabaseExecutor} from '../../database/index.js';
import {ConsumerError} from '../access/auth.js';
import {meaningView} from './semantic.js';
import {intakeView} from './intake.js';
/** Recoverable personal-list membership only. Learning identity/history are independent. */
export async function setContentMembership(db:DatabaseExecutor,a:{learner_user_id:string;now:Date},op:ContentMembershipOperation){
 const table=op.payload.entity==='meaning'?'personal_meanings':'intakes';
 const row=(await db.query(`SELECT * FROM sensa_consumer.${table} WHERE learner_user_id=$1 AND id=$2 FOR UPDATE`,[a.learner_user_id,op.payload.id])).rows[0];
 if(!row)throw new ConsumerError(404,'not_found');
 if(String(row.revision)!==op.payload.expectedRevision)throw new ConsumerError(409,'revision_conflict');
 if(op.payload.entity==='intake'&&row.meaning_id)throw new ConsumerError(409,'meaning_membership_required');
 const changed=Boolean(row.removed_at)===op.payload.active;
 const saved=changed?(await db.query(`UPDATE sensa_consumer.${table} SET removed_at=$3,revision=revision+1 WHERE learner_user_id=$1 AND id=$2 RETURNING *`,[a.learner_user_id,row.id,op.payload.active?null:a.now])).rows[0]!:row;
 return op.payload.entity==='meaning'?{meaning:meaningView(saved),alreadySaved:!changed}:{intake:intakeView(saved),alreadySaved:!changed};
}
