import {test,expect} from 'vitest';
import {SqliteSnapshotSource} from '../../../apps/web/src/data/library/sqliteSnapshotSource';
import type {SnapshotSourceFence} from '../../../apps/web/src/data/library/sqliteSnapshotSource';

/** Faults occur after BEGIN, before any file pointer or memory allocation. */
function source(fault:'select'|'rollback'|'reset'){
 let transaction=false,queryOnly=false,writes=0;const quarantined:Error[]=[],calls:string[]=[];
 const db={pointer:1,selectValue(sql:string){return sql.includes('journal_mode')?'wal':sql.includes('locking_mode')?'exclusive':queryOnly?1:0;},exec(input:string|{sql:string}){const sql=typeof input==='string'?input:input.sql;calls.push(sql);if(sql.includes('wal_checkpoint'))return [{busy:0,log:4,checkpointed:4}];if(sql==='PRAGMA query_only=ON'){queryOnly=true;return;}if(sql==='BEGIN'){transaction=true;return;}if(sql.startsWith('SELECT count'))throw Error('injected_select_failure');if(sql==='ROLLBACK'){if(fault==='rollback')throw Error('injected_rollback_failure');transaction=false;return;}if(sql==='PRAGMA query_only=OFF'){if(fault==='reset')throw Error('injected_reset_failure');queryOnly=false;return;}if(sql.startsWith('INSERT')){if(queryOnly||quarantined.length)throw Error('write_blocked');writes++;}},changes(){return 0;}};
 const sqlite={capi:{sqlite3_get_autocommit(){return transaction?0:1;}},wasm:{}};
 const dependencies={match(){return {};},assert(){}};
 const fence={signoutEpoch:undefined} as SnapshotSourceFence;
 const copy=new SqliteSnapshotSource(sqlite as any,db as any,dependencies as any,key=>key==='cloud-sync'?'["object",[["status",["string","synced"]]]]':null,()=>{if(quarantined.length)throw Error('connection_quarantined');},error=>quarantined.push(error));
 return {copy,fence,db,calls,quarantined,state:()=>({transaction,queryOnly,writes})};
}
test('a failed initial SELECT releases its owned read transaction and restores writes',()=>{
 const fixture=source('select');expect(()=>fixture.copy.request({action:'begin',fence:fixture.fence})).toThrow('injected_select_failure');expect(fixture.state()).toEqual({transaction:false,queryOnly:false,writes:0});fixture.db.exec('INSERT');expect(fixture.state().writes).toBe(1);expect(fixture.quarantined).toHaveLength(0);
});
test('failed rollback keeps write protection and quarantines the connection',()=>{
 const fixture=source('rollback');expect(()=>fixture.copy.request({action:'begin',fence:fixture.fence})).toThrow('sqlite_snapshot_source_recovery');expect(fixture.state()).toEqual({transaction:true,queryOnly:true,writes:0});expect(fixture.calls).not.toContain('PRAGMA query_only=OFF');expect(fixture.quarantined).toHaveLength(1);expect(()=>fixture.db.exec('INSERT')).toThrow('write_blocked');
});
test('failed query-only reset also quarantines a rolled-back connection',()=>{
 const fixture=source('reset');expect(()=>fixture.copy.request({action:'begin',fence:fixture.fence})).toThrow('sqlite_snapshot_source_recovery');expect(fixture.state()).toEqual({transaction:false,queryOnly:true,writes:0});expect(fixture.quarantined).toHaveLength(1);expect(()=>fixture.db.exec('INSERT')).toThrow('write_blocked');
});
test('an initiating signout epoch mismatch is refused before BEGIN',()=>{
 const fixture=source('select');expect(()=>fixture.copy.request({action:'begin',fence:{...fixture.fence,signoutEpoch:'stale-session'}})).toThrow('account_changed');expect(fixture.calls).not.toContain('BEGIN');expect(fixture.state()).toEqual({transaction:false,queryOnly:false,writes:0});
});
import {nativeSnapshotArtifactFailure} from '../../../apps/web/src/data/library/cloudNativeSnapshot';

test('only an explicit artifact rejection permits same-H refs recovery',()=>{
 for(const code of ['library_sync_hash','library_sync_format','library_sync_missing_block','sqlite_snapshot_envelope','sqlite_snapshot_native_relations'])expect(nativeSnapshotArtifactFailure(Error(code))).toBe(true);
 for(const code of ['sqlite_snapshot_connection_restriction','sqlite_snapshot_cleanup_unconfirmed','sqlite_snapshot_connection_failed','library_sync_cancelled','account_changed','library_sync_head_changed','library_sync_local_changed','library_sync_network'])expect(nativeSnapshotArtifactFailure(Error(code))).toBe(false);
});
