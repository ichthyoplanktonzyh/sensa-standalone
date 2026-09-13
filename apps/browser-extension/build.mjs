import {build} from 'esbuild';
import {mkdir,writeFile,copyFile} from 'node:fs/promises';
import {sensaBridgeKinds,sensaBridgeMaxRequestIdLength,sensaBridgeRequestChannel,sensaBridgeResponseChannel} from '@sensa/contracts/sensa';
// The page-scoped bridge script carries no schema, so the protocol it speaks is
// injected here instead of imported there: the kinds it may forward, the channels
// it answers on, and the id bound all come from the one declaration in the
// contracts, and the forwarder holds no copy that could drift from it.
const bridge=JSON.stringify({request:sensaBridgeRequestChannel,response:sensaBridgeResponseChannel,maxIdLength:sensaBridgeMaxRequestIdLength,kinds:sensaBridgeKinds});
const web=process.env.SENSA_EXTENSION_WEB_URL||'http://127.0.0.1:3001';
const api=process.env.SENSA_EXTENSION_API_URL||'http://127.0.0.1:8081';
for(const value of [web,api]){const u=new URL(value);if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))throw new Error('HTTPS or loopback required');}
await mkdir('dist',{recursive:true});
await build({entryPoints:['src/background.ts','src/popup.ts','src/content.ts','src/options.ts','src/webBridge.ts'],bundle:true,outdir:'dist',format:'iife',target:'chrome120',define:{SENSA_WEB_URL:JSON.stringify(web),SENSA_API_URL:JSON.stringify(api),SENSA_BRIDGE:bridge}});
await copyFile('popup.html','dist/popup.html');
await copyFile('options.html','dist/options.html');
await writeFile('dist/manifest.json',JSON.stringify({manifest_version:3,name:'Sensa 阅读采集',version:'0.2.2',permissions:['activeTab','scripting','storage','identity'],host_permissions:[new URL(api).origin+'/*'],content_scripts:[{matches:[new URL(web).protocol+'//'+new URL(web).hostname+'/*'],js:['webBridge.js']}],background:{service_worker:'background.js'},action:{default_popup:'popup.html'},options_ui:{page:'options.html',open_in_tab:true},content_security_policy:{extension_pages:"script-src 'self'; object-src 'none'"}},null,2));
