import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {captureSnapshotSchema,captureIdentity,captureSourceLink} from '../packages/contracts/src/sensa/consumer/intake.ts';
const base={sentence:'😀 She was tactful.',language:'en',source:{url:'https://example.org/article',title:'Original',capturedAt:'2026-09-09T00:00:00Z'},expression:{text:'tactful',start:10,end:17}};
const cases:any[]=[base,{...base,expression:null}];
for(const expression of [{text:'tactful',start:11,end:18},{text:'She',start:2,end:5},{text:'',start:0,end:0},{text:'tactful',start:10.5,end:17},{text:'tactful',start:-1,end:17}])cases.push({...base,expression});
for(const sentence of ['', ' ', 'x'.repeat(12001), '😀'.repeat(6001)])cases.push({...base,sentence,expression:null});
for(const language of ['zh-CN','EN',''])cases.push({...base,language});
for(const url of [null,'https://example.org:8443/a?b=1#part','https://user:pass@example.org','file:///private/x','javascript:alert(1)','not-url','https://例子.中国/'])cases.push({...base,source:{...base.source,url}});
for(const capturedAt of ['invalid','2026-09-09T00:00:00Z','2026-09-09T08:00:00+08:00'])cases.push({...base,source:{...base.source,capturedAt}});
for(const url of ['https://www.youtube.com/watch?v=abcdefghijk','https://m.youtube.com/shorts/abcdefghijk','https://www.youtube-nocookie.com/embed/abcdefghijk','https://example.org/watch?v=abcdefghijk','https://youtube.com/watch?v=wrong'])for(const endMs of [900,2500,86400001])cases.push({...base,source:{...base.source,url,video:{platform:'youtube',videoId:'abcdefghijk',startMs:1540,endMs}}});
for(const field of ['expression','language','source']){const c:any=structuredClone(base);delete c[field];cases.push(c);}
const withoutUrl:any=structuredClone(base);delete withoutUrl.source.url;cases.push(withoutUrl);
cases.push({...base,userConfirmed:true},{...base,expression:{text:' ',start:1,end:2}});
const expected=cases.map(c=>{try{const p=captureSnapshotSchema.safeParse(c);return p.success?{accepted:true,identity:captureIdentity(p.data),sourceLink:captureSourceLink(p.data.source)}:{accepted:false};}catch{return {accepted:false};}});
const result=spawnSync('cargo',['run','--quiet','--locked','-p','sensa-library','--example','personal_contract'],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:4*1024*1024});
assert.equal(result.status,0,result.stderr);const actual=JSON.parse(result.stdout);
for(let i=0;i<cases.length;i++)assert.deepEqual(actual[i],expected[i],`Capture parity case ${i}: ${JSON.stringify(cases[i])}`);
console.log(`Native intake capture parity: ${cases.length} exact TS/Rust cases passed`);
