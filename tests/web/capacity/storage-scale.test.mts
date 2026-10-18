/** Explicit 10k capacity lane; never selected by npm test / the fast suite. */
import {test,afterAll} from 'vitest';
import {checkWorldReadScale} from '../support/worldReadScale.mts';
import {checkLearnerProjectionScale} from '../support/learnerProjectionScale.mts';
import {defaultSensaLanguageRoute,sensaPinnedLanguageContext} from '@sensa/contracts/sensa';
import {portablePackageFixture} from '../../../scripts/support/portablePackageFixture.mts';
import {useNodeLearningCapacityStorage} from '../../../scripts/support/nodeLearningCapacity.mts';
import {openLibrary,readLibrary} from '../../../apps/web/src/data/library/store';
import {contentSupplySystem} from '../../../apps/web/src/contentSupply/system';
import {learningSystem} from '../../../apps/web/src/learning/system';
import type {LocalLearningTarget} from '../../../apps/web/src/learning/runtime/localProtocol';

Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined});
const storage=await useNodeLearningCapacityStorage();afterAll(()=>storage.close());
test('10k World facts page/search without reading source rows or transporting private details/media',()=>checkWorldReadScale(10000),180_000);
test('synthetic 10k read-projection stress keeps list payload bounded, opens one exact target, rebuilds metadata without rewriting facts, and rolls back a failed derived write',async()=>{
 const id=()=>crypto.randomUUID(),context=sensaPinnedLanguageContext(defaultSensaLanguageRoute);
 await openLibrary();const fixture=portablePackageFixture({packageId:id(),expression:'borrow'});
 const pack=await contentSupplySystem.execute({kind:'install_portable_package',bytes:fixture.bytes,expectedArchiveDigest:fixture.archiveDigest});
 const targetId=(await learningSystem.execute({kind:'enroll_package',operationId:id(),packageKey:pack.key,languageContext:context}))[0]!;
 await learningSystem.execute({kind:'start',operationId:id(),targetId,languageContext:context,dailyLimit:20});
 let runId='';
 for(const action of [{kind:'reveal'} as const,{kind:'rate',rating:'good'} as const]){
  const runtime=(await learningSystem.read({kind:'runtime',languageContext:context})).runtime!;
  runId=runtime.runId;
  await learningSystem.execute({kind:'act',operationId:id(),runId:runtime.runId,expectedRevision:runtime.revision,action});
 }
 await learningSystem.execute({kind:'finish',operationId:id(),runId});
 await learningSystem.execute({kind:'set_declared_mastery',operationId:id(),targetId,active:true,languageContext:context});
 const seed=(await readLibrary(tx=>tx.get<LocalLearningTarget>('learningTargets',targetId)))!;
 await checkLearnerProjectionScale(seed,10000);
},120_000);
