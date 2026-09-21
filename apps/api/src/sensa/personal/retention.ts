import type {DatabaseExecutor} from '../../database/index.js';

/** Delete one bounded batch so scheduled maintenance never holds an unbounded transaction. */
export async function purgeExpiredSemanticLookups(
  db: DatabaseExecutor,
  now: Date,
  batchSize = 1_000,
): Promise<number> {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 10_000) {
    throw new Error('invalid_semantic_retention_batch');
  }
  const result = await db.query(`
    WITH expired AS (
      SELECT learner_user_id,id
      FROM sensa_consumer.semantic_lookups
      WHERE expires_at <= $1
      ORDER BY expires_at,learner_user_id,id
      LIMIT $2
      FOR UPDATE SKIP LOCKED
    )
    DELETE FROM sensa_consumer.semantic_lookups AS lookups
    USING expired
    WHERE lookups.learner_user_id=expired.learner_user_id
      AND lookups.id=expired.id
  `, [now, batchSize]);
  return result.rowCount ?? 0;
}
