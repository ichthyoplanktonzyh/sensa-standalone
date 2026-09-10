import type {DatabaseExecutor} from '../../database/index.js';
import {ConsumerError,type ConsumerPrincipal} from './auth.js';

/** Registration is enabled by deployment policy; revocation always wins. */
export async function ensureAdmission(db:DatabaseExecutor,identity:ConsumerPrincipal,initializing:boolean){
  const policy=process.env.SENSA_REGISTRATION_POLICY??'invited';
  if(!['invited','registered'].includes(policy))throw new ConsumerError(503,'registration_not_configured');
  // Serialize first-account creation without granting permission to re-enable revocations.
  if(initializing)await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify([identity.issuer,identity.subject])]);
  if(initializing&&policy==='registered'&&!identity.installationId&&identity.email){
    await db.query('INSERT INTO sensa_consumer.invitations(issuer,subject) VALUES($1,$2) ON CONFLICT(issuer,subject) DO NOTHING',[identity.issuer,identity.subject]);
  }
  const row=(await db.query('SELECT revoked FROM sensa_consumer.invitations WHERE issuer=$1 AND subject=$2',[identity.issuer,identity.subject])).rows[0];
  if(!row||row.revoked)throw new ConsumerError(403,'invite_required');
}
