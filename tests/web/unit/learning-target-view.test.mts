// @vitest-environment happy-dom
/** Controlled read failures exercise the real hook; no learning fact is seeded. */
import {test,expect,vi} from 'vitest';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {learningSystem,type LearningSystem,type LearningTargetDetailProjection} from '../../../apps/web/src/learning/system';
import {contentSupplySystem} from '../../../apps/web/src/contentSupply/system';
import {usePackageLearning} from '../../../apps/web/src/experience/library/usePackageLearning';

vi.mock('react-i18next',async importOriginal=>({...await importOriginal<typeof import('react-i18next')>(),useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('../../../apps/web/src/experience/library/useActiveLanguageContext',async()=>{
 const {defaultSensaLanguageRoute,sensaPinnedLanguageContext}=await import('@sensa/contracts/sensa');
 return {useActiveLanguageContext:()=>sensaPinnedLanguageContext(defaultSensaLanguageRoute)};
});
vi.mock('../../../apps/web/src/learning/system',async importOriginal=>({
 ...await importOriginal<typeof import('../../../apps/web/src/learning/system')>(),
 learningSystem:{read:vi.fn(),execute:vi.fn(),subscribe:vi.fn(()=>()=>{})},
}));
vi.mock('../../../apps/web/src/contentSupply/system',()=>({
 contentSupplySystem:{read:vi.fn(),execute:vi.fn(),subscribe:vi.fn(()=>()=>{})},
}));

test('Target B retries while an initial A read is pending; an old A response cannot overwrite B or absorb a later view retry',async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
 const detail:LearningTargetDetailProjection={target:null,activeRunTargetIds:[],exportPackageKey:null,dailyLimit:20,policyOptions:[]};
 let releaseA!:(detail:LearningTargetDetailProjection)=>void;
 const pendingA=new Promise<LearningTargetDetailProjection>(resolve=>{releaseA=resolve;});
 const reads:string[]=[];let bFails=true;
 vi.mocked(learningSystem.read).mockImplementation((async query=>{
  if(query.kind!=='target')throw new Error('Target view requested a collection projection');
  reads.push(query.targetId);
  if(reads.length===1)return pendingA;
  if(query.targetId==='B'&&bFails)throw new Error('temporary B read failure');
  return detail;
 }) as LearningSystem['read']);
 let controller:ReturnType<typeof usePackageLearning>|null=null;
 const Harness=({targetId}:{targetId:string})=>{controller=usePackageLearning(false,'target',targetId);return null;};
 const root=createRoot(document.createElement('div'));
 try{
  await act(async()=>{root.render(createElement(Harness,{targetId:'A'}));});
  expect(reads).toEqual(['A']);expect(controller!.loadStatus).toBe('loading');
  await act(async()=>{root.render(createElement(Harness,{targetId:'B'}));});
  expect(reads).toEqual(['A','B']);expect(controller!.loadStatus).toBe('unavailable');
  expect(controller!.targets).toEqual([]);expect(controller!.targetExportPackageKey).toBeNull();
  bFails=false;
  await act(async()=>{await controller!.retryInitialLoad();});
  expect(reads).toEqual(['A','B','B']);expect(controller!.loadStatus).toBe('ready');expect(controller!.dailyLimit).toBe(20);
  await act(async()=>{releaseA({...detail,dailyLimit:1});await pendingA;});
  expect(controller!.loadStatus).toBe('ready');expect(controller!.dailyLimit).toBe(20);
  await act(async()=>{root.render(createElement(Harness,{targetId:'A'}));});
  expect(reads).toEqual(['A','B','B','A']);expect(controller!.loadStatus).toBe('ready');
  expect(contentSupplySystem.read).not.toHaveBeenCalled();
  expect(contentSupplySystem.execute).not.toHaveBeenCalled();expect(learningSystem.execute).not.toHaveBeenCalled();
 }finally{await act(async()=>{root.unmount();});vi.clearAllMocks();}
});
