import { defineConfig, loadEnv } from "vite";
import type {Plugin} from 'vite';
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {offlineShell} from './offlineShell';
import {localAgentAssets} from './localAgentAssets';
import {readFileSync,realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  patchSqliteSahPoolInitFailure,
  sqliteSahPoolPreservedInitFailureVersion,
  sqliteSahPoolPreserverVirtualId,
} from './src/data/library/sqliteSahPoolInitPreserver';

const sqliteWasmPackageJson=createRequire(import.meta.url).resolve('@sqlite.org/sqlite-wasm/package.json');
const sqliteWasmVersion=(JSON.parse(readFileSync(sqliteWasmPackageJson,'utf8')) as {version?:unknown}).version;
if(sqliteWasmVersion!==sqliteSahPoolPreservedInitFailureVersion){
  throw new Error(`sqlite_sahpool_preserver_version_unsupported:${String(sqliteWasmVersion)}`);
}

const sqliteSahPoolInitPreserver=(assertSqliteWorkerBuild=false):Plugin=>{
  const virtualModuleId=`\0${sqliteSahPoolPreserverVirtualId}`;
  const helperPath=fileURLToPath(new URL('./src/data/library/sqliteSahPoolInitPreserver.ts',import.meta.url));
  let transformed=false;
  let sqliteWorkerEntry=false;
  return {
    name:'sensa-sqlite-sahpool-init-data-preservation',
    enforce:'pre',
    resolveId(id){return id===sqliteSahPoolPreserverVirtualId?virtualModuleId:null;},
    load(id){return id===virtualModuleId
      ?`export {closeSahPoolHandles as __sensaCloseSahPoolHandles, preserveSahPoolAfterInitFailure as __sensaPreserveSahPoolAfterInitFailure, settleSahPoolAcquisitions as __sensaSettleSahPoolAcquisitions} from ${JSON.stringify(helperPath)};`
      :null;},
    transform(source,id){
      const cleanId=id.split('?')[0]!.replaceAll('\\','/');
      if(cleanId.endsWith('/apps/web/src/data/library/sqliteWorker.ts')
        ||cleanId.endsWith('/src/data/library/sqliteWorker.ts'))sqliteWorkerEntry=true;
      if(!cleanId.endsWith('/@sqlite.org/sqlite-wasm/dist/index.mjs'))return null;
      const actualPackageRoot=dirname(dirname(realpathSync(cleanId)));
      const actualPackageJson=join(actualPackageRoot,'package.json');
      const actualVersion=(JSON.parse(readFileSync(actualPackageJson,'utf8')) as {version?:unknown}).version;
      if(actualVersion!==sqliteSahPoolPreservedInitFailureVersion){
        throw new Error(`sqlite_sahpool_preserver_version_unsupported:${String(actualVersion)}`);
      }
      const code=patchSqliteSahPoolInitFailure(source,String(actualVersion));
      transformed=true;
      return {
        code:`import {__sensaCloseSahPoolHandles,__sensaPreserveSahPoolAfterInitFailure,__sensaSettleSahPoolAcquisitions} from ${JSON.stringify(sqliteSahPoolPreserverVirtualId)};\n${code}`,
        map:null,
      };
    },
    buildEnd(){
      if(assertSqliteWorkerBuild&&sqliteWorkerEntry&&!transformed){
        throw new Error('sqlite_sahpool_preserver_module_not_transformed');
      }
    },
  };
};

export default defineConfig(({ mode }) => {
  const localAcceptance = mode === 'sensa-local';
  const envDirectory = localAcceptance ? '../../.sensa-local/env' : '.';
  const env = loadEnv(mode, envDirectory, "VITE_");
  const release = /^(?:development|[0-9a-f]{7,40})$/u.test(process.env.SENSA_RELEASE_SHA ?? '')
    ? process.env.SENSA_RELEASE_SHA
    : 'development';
  if (localAcceptance) {
    for (const key of ['VITE_SUPABASE_URL', 'VITE_SENSA_API_URL'] as const) {
      const value = process.env[key] ?? env[key];
      let url: URL;
      try { url = new URL(value); } catch { throw new Error(`${key} must be an explicit loopback URL`); }
      if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
        throw new Error(`${key} must remain on loopback in local acceptance mode`);
      }
    }
  }
  return {
    define: { __SENSA_RELEASE__: JSON.stringify(release) },
    envDir: envDirectory,
    publicDir: "public",
    plugins: [sqliteSahPoolInitPreserver(),react(), tailwindcss(),localAgentAssets(),offlineShell()],
    optimizeDeps:{exclude:['@sqlite.org/sqlite-wasm']},
    worker:{plugins:()=>[sqliteSahPoolInitPreserver(true)]},
    server: {
      host: "127.0.0.1",
      port: Number(env.VITE_WEB_PORT ?? 3000),
      strictPort: true,
      proxy: { "/api/prototype/semantic-agent": "http://localhost:5175" },
    },
    preview: {
      host: "127.0.0.1",
      port: Number(env.VITE_WEB_PORT ?? 3000),
      strictPort: true,
    },
  };
});
