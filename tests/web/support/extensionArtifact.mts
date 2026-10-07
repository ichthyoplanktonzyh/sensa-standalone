import {execFileSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
/** Compile current source without overwriting an installed owner extension.
 * An explicitly supplied release candidate is read-only and never removed. */
export async function extensionArtifact(){
 const supplied=process.env.SENSA_EXTENSION_TEST_DIR;if(supplied)return {path:supplied,close:async()=>{}};
 const directory=await mkdtemp(join(tmpdir(),'sensa-extension-surfaces-')),path=join(directory,'extension');
 try{execFileSync(process.execPath,['build.mjs'],{cwd:resolve('apps/browser-extension'),env:{...process.env,SENSA_EXTENSION_WEB_URL:'https://web.fixture.invalid',SENSA_EXTENSION_API_URL:'https://api.fixture.invalid',SENSA_EXTENSION_OUT_DIR:path},stdio:'pipe'});}
 catch(error){await rm(directory,{recursive:true,force:true});throw error;}
 return {path,close:()=>rm(directory,{recursive:true,force:true})};
}
