import assert from "node:assert/strict";

import {
  sensaSyncV2WireVersion,
  sensaSyncWireVersion,
  type SensaSyncScope,
} from "@sensa/contracts/sensa";
import {
  cursorPair,
  parseCursor,
  parseSensaSyncBootstrapInput,
  parseSensaSyncPullInput,
  parseSensaSyncPushInput,
  parseSensaSyncV2BootstrapInput,
  parseSensaSyncV2PullInput,
  parseSensaSyncV2PushInput,
  parseV2Cursor,
  v2CursorPair,
} from "../apps/api/src/sensa/sync/protocol.js";
import { SensaSyncError } from "../apps/api/src/sensa/sync/support.js";

const scope: SensaSyncScope = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  learnerUserId: "sync-protocol-smoke-user",
  replicaId: "22222222-2222-4222-8222-222222222222",
};

const v1Cursors = cursorPair(scope, 7, 12, 34);
assert.deepEqual(parseCursor(v1Cursors.mutableCursor, "mutable"), {
  scope,
  wireVersion: sensaSyncWireVersion,
  bootstrapEpoch: 7,
  kind: "mutable",
  sequence: 12,
});
assert.equal(parseCursor(v1Cursors.factCursor, "fact").sequence, 34);
assert.deepEqual(parseSensaSyncBootstrapInput(scope, {
  wireVersion: sensaSyncWireVersion,
  replicaId: scope.replicaId,
}), { scope, wireVersion: sensaSyncWireVersion });
assert.deepEqual(parseSensaSyncPushInput(scope, {
  wireVersion: sensaSyncWireVersion,
  replicaId: scope.replicaId,
  cursors: v1Cursors,
  operations: [],
}).operations, []);
assert.equal(parseSensaSyncPullInput(scope, {
  wireVersion: sensaSyncWireVersion,
  replicaId: scope.replicaId,
  cursors: v1Cursors,
  limit: 50,
}).limit, 50);

const v2Cursors = v2CursorPair(scope, 9, 56, 78);
assert.equal(parseV2Cursor(v2Cursors.mutableCursor, "mutable").sequence, 56);
assert.equal(parseV2Cursor(v2Cursors.factCursor, "fact").sequence, 78);
assert.deepEqual(parseSensaSyncV2BootstrapInput(scope, {
  wireVersion: sensaSyncV2WireVersion,
  replicaId: scope.replicaId,
}), { scope, wireVersion: sensaSyncV2WireVersion });
assert.deepEqual(parseSensaSyncV2PushInput(scope, {
  wireVersion: sensaSyncV2WireVersion,
  replicaId: scope.replicaId,
  cursors: v2Cursors,
  operations: [],
}).operations, []);
assert.equal(parseSensaSyncV2PullInput(scope, {
  wireVersion: sensaSyncV2WireVersion,
  replicaId: scope.replicaId,
  cursors: v2Cursors,
  limit: 100,
}).limit, 100);

assert.throws(
  () => parseCursor(v1Cursors.mutableCursor, "fact"),
  (error) => error instanceof SensaSyncError && error.code === "invalid_cursor",
);
assert.throws(
  () => parseV2Cursor(v1Cursors.mutableCursor, "mutable"),
  (error) => error instanceof SensaSyncError && error.code === "invalid_cursor",
);
assert.throws(
  () => parseSensaSyncV2BootstrapInput(scope, {
    wireVersion: sensaSyncV2WireVersion,
    replicaId: "33333333-3333-4333-8333-333333333333",
  }),
  (error) => error instanceof SensaSyncError && error.code === "replica_scope_mismatch",
);

console.log("Sensa Sync protocol smoke passed.");
