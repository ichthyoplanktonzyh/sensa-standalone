/** Backup is an explicit recovery-point contract, not an implemented cloud adapter. */
import assert from 'node:assert/strict';

import {
  sensaAccountBackupContractVersion,
  sensaAccountBackupRecoveryPointSchema,
} from '../../../packages/contracts/src/sensa/accountBackup.ts';

const recoveryPoint={
  manifest:{
    contractVersion:sensaAccountBackupContractVersion,
    backupId:'113ef32a-3dc2-4800-87e3-b38c9f900c4b',
    previousBackupId:null,
    libraryId:'5fe997d5-d731-4745-aeb8-0f99140a6b8c',
    learnerId:'738d2600-f25d-4562-822c-96b20d1dd833',
    librarySchemaVersion:6,
    checkpoint:'library-revision:42',
    createdAt:'2026-09-13T08:00:00.000Z',
    recoveryMode:'account_assisted' as const,
    payloadDigest:'a'.repeat(64),
    payloadBytes:4096,
  },
  storedAt:'2026-09-13T08:00:01.000Z',
  verifiedAt:'2026-09-13T08:00:02.000Z',
};

assert.equal(
  sensaAccountBackupRecoveryPointSchema.parse(recoveryPoint).manifest.recoveryMode,
  'account_assisted',
);
assert.throws(
  ()=>sensaAccountBackupRecoveryPointSchema.parse({...recoveryPoint,manifest:{...recoveryPoint.manifest,payloadBytes:0}}),
  /Too small/,
  'an empty upload cannot become a recovery point',
);
assert.throws(
  ()=>sensaAccountBackupRecoveryPointSchema.parse({...recoveryPoint,verifiedAt:'2026-09-13T07:59:59.000Z'}),
  /verification cannot precede storage/,
  'a recovery point cannot exist before its stored payload was verified',
);

console.log('PASS: the cloud-backup seam names an immutable, non-empty, account-assisted recovery point only after storage verification; no backup adapter is invoked.');
