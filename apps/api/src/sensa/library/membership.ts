import type {DatabaseExecutor} from '../../database/core.js';

export type LibraryCloudOwnerKind='row'|'log'|'snapshot'|'staging';

/** Exact owner identities are stored once; every reachability edge remains a
 * row with account-scoped foreign keys. Callers hold the account transaction. */
export async function pinLibraryCloudBlocks(db:DatabaseExecutor,account:string,pins:readonly {kind:LibraryCloudOwnerKind;owner:string;hashes:readonly string[]}[]):Promise<void>{
 const rows=pins.filter(pin=>pin.hashes.length).map(pin=>({kind:pin.kind,owner:pin.owner,hashes:[...new Set(pin.hashes)]}));
 if(!rows.length)return;
 const json=JSON.stringify(rows);
 // A second statement sees owners inserted by the first without redundant
 // UPDATEs of the hot staging owner or a same-statement CTE visibility trap.
 await db.query(`INSERT INTO sensa_consumer.library_cloud_owners(account_id,owner_kind,owner)
  SELECT DISTINCT $1,p.kind,p.owner FROM jsonb_to_recordset($2::jsonb) p(kind text,owner text)
  ON CONFLICT(account_id,owner_kind,owner) DO NOTHING`,[account,json]);
 // LEFT JOIN deliberately feeds NULL to the edge's NOT NULL constraint if a
 // requested block is absent; a missing reference must never silently vanish.
 await db.query(`INSERT INTO sensa_consumer.library_cloud_membership(account_id,owner_id,block_id)
  SELECT $1,o.id,b.block_id FROM jsonb_to_recordset($2::jsonb) p(kind text,owner text,hashes jsonb)
  JOIN sensa_consumer.library_cloud_owners o ON o.account_id=$1 AND o.owner_kind=p.kind AND o.owner=p.owner
  CROSS JOIN LATERAL jsonb_array_elements_text(p.hashes) h(hash)
  LEFT JOIN sensa_consumer.library_cloud_blocks b ON b.account_id=$1 AND b.hash=h.hash
  ON CONFLICT DO NOTHING`,[account,json]);
}

/** Removing an empty identity never cascades pins or consumes an unbounded
 * cleanup budget. The composite FK also refuses an accidentally live owner. */
export async function retireEmptyLibraryCloudOwners(db:DatabaseExecutor,account:string,kind:LibraryCloudOwnerKind,owners:readonly string[]):Promise<void>{
 if(!owners.length)return;
 await db.query(`DELETE FROM sensa_consumer.library_cloud_owners o WHERE o.account_id=$1 AND o.owner_kind=$2 AND o.owner=ANY($3::text[])
  AND NOT EXISTS(SELECT 1 FROM sensa_consumer.library_cloud_membership m WHERE m.account_id=o.account_id AND m.owner_id=o.id)`,[account,kind,owners]);
}

/** Only identities touched by an already bounded pin DELETE are considered. */
export async function retireEmptyLibraryCloudOwnerIds(db:DatabaseExecutor,account:string,ids:readonly string[]):Promise<void>{
 if(!ids.length)return;
 await db.query(`DELETE FROM sensa_consumer.library_cloud_owners o WHERE o.account_id=$1 AND o.id=ANY($2::bigint[])
  AND NOT EXISTS(SELECT 1 FROM sensa_consumer.library_cloud_membership m WHERE m.account_id=o.account_id AND m.owner_id=o.id)`,[account,ids]);
}
