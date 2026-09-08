import {canonicalConsumerJson,captureIdentity,intakeViewSchema} from '@sensa/contracts/sensa';
import type {IntakeOperation,IntakeView} from '@sensa/contracts/sensa';
import type {DatabaseExecutor} from '../../database/index.js';
import {ConsumerError} from '../access/auth.js';
type Scope={learner_user_id:string;now:Date};
function view(row:Record<string,any>):IntakeView{return intakeViewSchema.parse({id:row.id,revision:String(row.revision),status:'inbox',snapshot:row.snapshot,savedAt:new Date(row.saved_at).toISOString()});}
export async function saveIntake(db:DatabaseExecutor,a:Scope,op:IntakeOperation){
 const bytes=new TextEncoder().encode(canonicalConsumerJson(captureIdentity(op.payload.snapshot)));
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 const old=(await db.query('SELECT * FROM sensa_consumer.intakes WHERE learner_user_id=$1 AND identity_digest=$2',[a.learner_user_id,digest])).rows[0];
 if(old)return {intake:view(old),alreadySaved:true};
 const row=(await db.query('INSERT INTO sensa_consumer.intakes(id,learner_user_id,identity_digest,snapshot,saved_at) VALUES($1,$2,$3,$4::jsonb,$5) RETURNING *',[crypto.randomUUID(),a.learner_user_id,digest,JSON.stringify(op.payload.snapshot),a.now])).rows[0]!;
 return {intake:view(row),alreadySaved:false};
}
export async function listIntakes(db:DatabaseExecutor,a:Scope){
 const rows=(await db.query('SELECT * FROM sensa_consumer.intakes WHERE learner_user_id=$1 ORDER BY saved_at DESC,id LIMIT 501',[a.learner_user_id])).rows;
 if(rows.length>500)throw new ConsumerError(409,'snapshot_limit_exceeded');return rows.map(view);
}
export async function readIntake(db:DatabaseExecutor,a:Scope,id:string){
 const row=(await db.query('SELECT * FROM sensa_consumer.intakes WHERE learner_user_id=$1 AND id=$2',[a.learner_user_id,id])).rows[0];
 if(!row)throw new ConsumerError(404,'not_found');return view(row);
}
