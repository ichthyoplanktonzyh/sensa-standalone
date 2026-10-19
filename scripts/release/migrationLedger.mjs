/** Filename-only legacy ledger: reject unknown migrations and holes, never repair it. */
import {createHash} from 'node:crypto';

export function compareMigrationLedger(files, applied) {
  const expected = [...files].sort();
  const actual = [...applied].sort();
  if (!expected.length || new Set(expected).size !== expected.length
    || new Set(actual).size !== actual.length
    || actual.some((name, index) => name !== expected[index])) {
    throw Error('Migration ledger is not a prefix of this candidate; inspect drift before releasing');
  }
  return {appliedCount: actual.length, pending: expected.slice(actual.length),
    ledgerSha256: createHash('sha256').update(JSON.stringify(actual)).digest('hex'),
    checksumCoverage: 'filenames-only; applied SQL bytes are not attested by the legacy ledger'};
}

export async function readMigrationLedger(client, files) {
  const exists = (await client.query("SELECT to_regclass('public.sensa_schema_migrations') AS ledger")).rows[0]?.ledger;
  if (!exists) {
    const count = (await client.query("SELECT count(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','core','org','sync','content','security','sensa','sensa_consumer') AND c.relkind IN ('r','p','v','m')")).rows[0]?.count;
    if (count !== 0) throw Error('Migration ledger missing in a nonempty application database; reconcile before writing');
  }
  const rows = exists ? (await client.query('SELECT filename FROM public.sensa_schema_migrations ORDER BY filename COLLATE "C"')).rows : [];
  return {...compareMigrationLedger(files, rows.map(row => row.filename)), ledgerExists: !!exists};
}

/** The successful baseline attests old source bytes; the legacy SQL ledger does not. */
export function assertMigrationCompatibility(candidate, previous) {
  if (!previous) return {baseline: 'explicit-bootstrap', rollback: 'forward-only; no automatic database rollback'};
  const count = previous.migrationCount;
  if (!Number.isSafeInteger(count) || count < 1 || count > candidate.migrations.length
    || candidate.migrations[count - 1].path !== previous.latestMigration
    || createHash('sha256').update(JSON.stringify(candidate.migrations.slice(0, count))).digest('hex') !== previous.migrationSetSha256) {
    throw Error('Candidate changes or removes baseline migrations; forward-only release required');
  }
  return {baseline: 'source-prefix-verified', baselineMigrationCount: count,
    rollback: candidate.migrations.length === count ? 'schema unchanged; application/content rollback still requires compatibility verification'
      : 'pending forward migrations; review expand/contract compatibility before execution; never replay old SQL backwards'};
}
