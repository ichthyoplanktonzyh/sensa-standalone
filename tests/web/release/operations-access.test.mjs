import {test,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {operationsConnection,configureOperations} from '../../../scripts/release/operationsAccess.mjs';
const project='abcdefghijklmnopqrst',base=`postgresql://backend.${project}:old@aws-0.example.pooler.supabase.com:5432/postgres?sslmode=verify-full`,password='a'.repeat(43);
test('operational credentials preserve TLS and bind only the approved project and role',()=>{
 const url=new URL(operationsConnection(base,project,'monitor',password));
 expect(url.username).toBe(`sensa_operational_monitor.${project}`);expect(url.password).toBe(password);expect(url.searchParams.get('sslmode')).toBe('verify-full');
 for(const [connection,kind,secret] of [[base.replace(project,'wrong'),'monitor',password],[base,'admin',password],[base,'monitor',"'unsafe"]])expect(()=>operationsConnection(connection,project,kind,secret)).toThrow();
});
test('monitor receives only selected metadata; retention cannot alter active heads or learning facts',async()=>{
 const sql=[];const db={query:async text=>{sql.push(text);return {rows:[]};}};
 await configureOperations(db,{project,base,monitorPassword:password,retentionPassword:password});
 const statements=sql.join('\n');expect(statements).toContain('NOBYPASSRLS');expect(statements).toContain('default_transaction_read_only=on');
 expect(statements).not.toMatch(/GRANT ALL|GRANT .* ON ALL TABLES|GRANT pg_read_all_stats|GRANT backend_app/);
 expect(statements).toContain('SELECT (execution_started_at,state,completed_at)');
 expect(statements).not.toMatch(/GRANT (?:DELETE|UPDATE).*TO sensa_operational_monitor/);
 expect(statements).not.toMatch(/GRANT .*library_cloud_heads|GRANT .*library_cloud_commits|GRANT .*library_cloud_conflict/);
 expect(statements).toContain('REVOKE ALL ON FUNCTION sensa_consumer.operational_lock_wait_count() FROM PUBLIC,anon,authenticated');
 expect(statements).toContain("reference_kind='retired' AND expires_at<=now()");
 expect(statements).toContain("r.reference_kind='head' OR r.expires_at>now()");
 expect(statements).toContain('WITH CHECK (response IS NULL AND response_expires_at IS NULL)');
 expect(statements).toContain('ALTER TABLE sensa_consumer.semantic_lookups ENABLE ROW LEVEL SECURITY');
 expect(sql.at(-1)).toBe('COMMIT');
});
test('unexpected existing privileges fail closed before credential rotation',async()=>{
 const sql=[];const db={query:async text=>{sql.push(text);return {rows:text.startsWith('SELECT rolname')?[{rolsuper:true}]:[]};}};
 await expect(configureOperations(db,{project,base,monitorPassword:password,retentionPassword:password})).rejects.toThrow('drift');
 expect(sql).not.toEqual(expect.arrayContaining([expect.stringMatching(/ALTER ROLE/)]));expect(sql.at(-1)).toBe('ROLLBACK');
});
test('operational setup is a scoped configuration workflow, not application deployment',async()=>{
 const workflow=await readFile(new URL('../../../.github/workflows/sensa-operations-setup.yml',import.meta.url),'utf8');
 expect(workflow).toContain('refs/heads/main');expect(workflow).toContain('owner_accepted');
 expect(workflow).not.toMatch(/functions deploy|wrangler .*deploy|db:migrate|restore-pitr/);
 const monitor=await readFile(new URL('../../../.github/workflows/sensa-web-monitor.yml',import.meta.url),'utf8');
 expect(monitor).toContain('vars.SENSA_OPERATIONS_DATABASE_TARGET');
 expect(monitor).not.toMatch(/secrets\.(?:SENSA_RUNTIME_DATABASE_URL|MIGRATION_DATABASE_URL)/);
});
