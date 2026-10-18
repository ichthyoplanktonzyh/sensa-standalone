import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir, mkdtemp} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import type {Server} from 'node:http';

type Build = (directory:string, env:NodeJS.ProcessEnv)=>Promise<void>;

/** One immutable build per exact configuration in this worker invocation.
 * Not a cross-revision artifact cache and never a production release candidate. */
export function createWebTestBuildCache(build:Build=async(directory,env)=>{
  execFileSync('npm',['run','build','-w','@sensa/web','--','--outDir',directory,'--emptyOutDir'],{env,stdio:'pipe'});
}) {
  const builds=new Map<string,Promise<string>>();
  return async(overrides:Record<string,string>)=>{
    const env={...process.env,...overrides,NODE_ENV:'production'};
    const config=Object.fromEntries(Object.entries(env).filter(([key])=>key.startsWith('VITE_')||key==='SENSA_RELEASE_SHA').sort(([a],[b])=>a.localeCompare(b)));
    const key=JSON.stringify([process.cwd(),config]);
    let pending=builds.get(key);
    const cacheHit=!!pending,started=performance.now();
    if(!pending){
      pending=(async()=>{
        await mkdir(resolve('.tmp'),{recursive:true});
        const output=await mkdtemp(resolve('.tmp/test-web-build-'));
        const directory=join(output,'dist');
        await build(directory,env);
        return directory;
      })();
      builds.set(key,pending);
    }
    const directory=await pending;
    console.info(JSON.stringify({stage:'test_web_build',configDigest:createHash('sha256').update(key).digest('hex'),cacheHit,elapsedMs:Math.round(performance.now()-started)}));
    return directory;
  };
}

export const webTestBuild=createWebTestBuildCache();

// Sequential specs reuse only their ephemeral endpoint numbers, not the server,
// handlers, mutable facts, browser context or OPFS. An occupied port fails closed.
const ports=new Map<string,number>();
export const loopbackTestPort=(role:string)=>ports.get(role)??0;
export function rememberLoopbackTestPort(role:string,server:Pick<Server,'address'>){
  const address=server.address();
  if(!address||typeof address==='string'||address.address!=='127.0.0.1')throw Error('Test server must own an IPv4 loopback endpoint');
  const prior=ports.get(role);
  if(prior!==undefined&&prior!==address.port)throw Error('Test endpoint changed during an invocation');
  ports.set(role,address.port);
  return `http://127.0.0.1:${address.port}`;
}
