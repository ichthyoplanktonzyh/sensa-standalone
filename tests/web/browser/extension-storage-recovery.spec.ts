import {expect,test,chromium,type BrowserContext,type Worker} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {canonicalConsumerJson,sensaBrowserIntakeDeliverySchema} from '@sensa/contracts/sensa';
import {browserCaptureToIntake} from '../../../apps/browser-extension/src/semanticIntakeAdapter';

const root=resolve('.'),extensionRoot=join(root,'apps/browser-extension');
let extensionDirectory='',profileDirectory='';

const browserOptions=()=>({
 headless:true,
 args:[`--disable-extensions-except=${extensionDirectory}`,`--load-extension=${extensionDirectory}`],
 ...(process.env.SENSA_CHROMIUM_PATH?{executablePath:process.env.SENSA_CHROMIUM_PATH}:{channel:'chromium' as const}),
});

async function extensionWorker(context:BrowserContext):Promise<Worker>{
 return context.serviceWorkers()[0]??await context.waitForEvent('serviceworker',{timeout:15000});
}

async function openExtension(){
 const context=await chromium.launchPersistentContext(profileDirectory,browserOptions());
 const worker=await extensionWorker(context),extensionId=new URL(worker.url()).hostname;
 const page=await context.newPage();await page.goto(`chrome-extension://${extensionId}/popup.html`);
 await expect(page.getByRole('status')).not.toHaveText(/Checking|正在检查/u);
 return {context,page};
}

const accountA=randomUUID(),accountB=randomUUID(),libraryId=randomUUID(),clientId=randomUUID();
const capture={sentence:'She took her time.',language:'en',languageSource:'detector' as const,languageConfidence:.9,source:{url:'https://example.org/article',title:'An article',capturedAt:'2026-09-28T00:00:00.000Z'},expression:{text:'took',start:4,end:8}};
const queueEntry=(accountId:string)=>{
 const operationId=randomUUID();
 const request=sensaBrowserIntakeDeliverySchema.parse({contractVersion:'sensa-browser-intake-delivery-v1',libraryId,clientId,intake:browserCaptureToIntake(operationId,capture,null,null)});
 return {accountId,request,digest:createHash('sha256').update(canonicalConsumerJson(request)).digest('hex')};
};
const guestEntry=()=>{
 const operationId=randomUUID(),input={operationId,snapshot:capture,proposal:null,provenance:null};
 return {...input,digest:createHash('sha256').update(canonicalConsumerJson(input)).digest('hex')};
};
const accountStore=(active:string|null)=>({version:1,active,accounts:{
 [accountA]:{accountId:accountA,installationId:clientId,webLibraryId:libraryId,token:'fixture-a',queue:[],recent:[],savedOperations:{}},
 [accountB]:{accountId:accountB,installationId:clientId,webLibraryId:libraryId,token:'fixture-b',queue:[],recent:[],savedOperations:{}},
}});

test.beforeAll(async()=>{
 extensionDirectory=await mkdtemp(join(tmpdir(),'sensa-extension-recovery-build-'));
 profileDirectory=await mkdtemp(join(tmpdir(),'sensa-extension-recovery-profile-'));
 execFileSync(process.execPath,['build.mjs'],{cwd:extensionRoot,env:{...process.env,SENSA_EXTENSION_WEB_URL:'https://extension-recovery.invalid',SENSA_EXTENSION_API_URL:'https://api.extension-recovery.invalid',SENSA_EXTENSION_OUT_DIR:extensionDirectory,SENSA_EXTENSION_NAME:'Sensa recovery acceptance'},stdio:'pipe'});
});

test.afterAll(async()=>{
 await rm(extensionDirectory,{recursive:true,force:true});
 await rm(profileDirectory,{recursive:true,force:true});
});

test('legacy, corrupt, guest and account queues survive restart and require explicit recovery',async()=>{
 const opaque={legacy:'owner queue record',payload:{text:'keep me exactly'}},accountEntry=queueEntry(accountA),localEntry=guestEntry();
 let {context,page}=await openExtension();
 await page.evaluate(async input=>chrome.storage.local.set({sensa:input.store,sensaWebIntake:[input.accountEntry,input.opaque],sensaLocalIntake:[input.localEntry]}),{store:accountStore(null),accountEntry,opaque,localEntry});
 await page.reload();
 await expect(page.getByRole('status')).toContainText(/1 (?:item|项)/u);
 await expect(page.locator('#queue-recovery')).toBeVisible();
 await expect(page.locator('#queue-recovery-body')).toContainText('1');
 const guestStatus=await page.evaluate(async()=>chrome.runtime.sendMessage({kind:'status'}));
 expect(guestStatus.value).toMatchObject({accountId:null,pending:1,recoveryCount:1,errors:['web_queue_recovery_required']});
 const migrated=await page.evaluate(async()=>(await chrome.storage.local.get('sensaWebIntake')).sensaWebIntake) as any;
 expect(migrated).toMatchObject({version:2,pending:[{accountId:accountA}],receipts:[],quarantined:[{value:opaque}]});

 const downloadPromise=page.waitForEvent('download');await page.locator('#queue-recovery-export').click();
 const download=await downloadPromise;expect(download.suggestedFilename()).toBe('sensa-extension-queue-recovery.json');
 const stream=await download.createReadStream();const chunks:Buffer[]=[];for await(const chunk of stream)chunks.push(Buffer.from(chunk));
 const exported=JSON.parse(Buffer.concat(chunks).toString('utf8'));expect(exported.records[0].value).toEqual(opaque);
 await expect(page.getByRole('status')).toContainText(/exported|已导出/u);
 expect((await page.evaluate(async()=>(await chrome.storage.local.get('sensaWebIntake')).sensaWebIntake) as any).quarantined).toHaveLength(1);
 await context.close();

 ({context,page}=await openExtension());
 await expect(page.locator('#queue-recovery')).toBeVisible();
 expect((await page.evaluate(async()=>(await chrome.storage.local.get('sensaWebIntake')).sensaWebIntake) as any).quarantined[0].value).toEqual(opaque);
 await page.evaluate(async store=>chrome.storage.local.set({sensa:store}),accountStore(accountA));await page.reload();
 const accountStatus=await page.evaluate(async()=>chrome.runtime.sendMessage({kind:'status'}));
 expect(accountStatus.value).toMatchObject({accountId:accountA,pending:2,recoveryCount:1});
 page.once('dialog',dialog=>void dialog.accept());await page.locator('#queue-recovery-discard').click();
 await expect(page.locator('#queue-recovery')).toBeHidden();
 const recovered=await page.evaluate(async()=>(await chrome.storage.local.get('sensaWebIntake')).sensaWebIntake) as any;
 expect(recovered.pending).toEqual([accountEntry]);expect(recovered.receipts).toEqual([]);expect(recovered.quarantined).toEqual([]);

 const bounded=[...Array.from({length:40},()=>queueEntry(accountA)),...Array.from({length:60},()=>queueEntry(accountB))];
 await page.evaluate(async input=>chrome.storage.local.set({sensa:input.store,sensaWebIntake:{version:2,pending:input.entries,receipts:[],quarantined:[]}}),{store:accountStore(accountA),entries:bounded});
 expect((await page.evaluate(async()=>chrome.runtime.sendMessage({kind:'status'}))).value.pending).toBe(41);
 await page.evaluate(async store=>chrome.storage.local.set({sensa:store}),accountStore(accountB));
 expect((await page.evaluate(async()=>chrome.runtime.sendMessage({kind:'status'}))).value.pending).toBe(61);
 const finalStored=await page.evaluate(async()=>await chrome.storage.local.get(['sensaWebIntake','sensaLocalIntake'])) as any;
 expect(finalStored.sensaWebIntake.pending).toHaveLength(100);expect(finalStored.sensaLocalIntake).toEqual([localEntry]);
 await context.close();
});
