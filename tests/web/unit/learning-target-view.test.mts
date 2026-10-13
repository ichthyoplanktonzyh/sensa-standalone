// @vitest-environment happy-dom
/** Controlled read failures exercise the real hook; no learning fact is seeded. */
import {test,expect,vi} from 'vitest';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {learningSystem,type LearningSystem,type LearningTargetDetailProjection} from '../../../apps/web/src/learning/system';
import {contentSupplySystem} from '../../../apps/web/src/contentSupply/system';
import {usePackageLearning} from '../../../apps/web/src/experience/library/usePackageLearning';
import {learningLibrarySelection,type LearningLibraryItem} from '../../../apps/web/src/experience/library/learningTargetBrowsing';

vi.mock('react-i18next',async importOriginal=>({...await importOriginal<typeof import('react-i18next')>(),useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('../../../apps/web/src/experience/library/useActiveLanguageContext',async()=>{
 const {defaultSensaLanguageRoute,sensaPinnedLanguageContext}=await import('@sensa/contracts/sensa');
 return {useActiveLanguageContext:()=>sensaPinnedLanguageContext(defaultSensaLanguageRoute)};
});

test('World controller stays idle until an explicit start reads the saved quantity through preferences',async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
 const reads:string[]=[];
 vi.mocked(learningSystem.read).mockImplementation((async query=>{
  reads.push(query.kind);if(query.kind!=='preferences')throw Error('World requested a collection projection');
  return {dailyLimit:5,policyOptions:[]};
 }) as LearningSystem['read']);
 vi.mocked(learningSystem.execute).mockResolvedValue(true);
 let controller:ReturnType<typeof usePackageLearning>|null=null;
 const Harness=()=>{controller=usePackageLearning(false,'inactive');return null;};
 const root=createRoot(document.createElement('div'));
 try{
  await act(async()=>root.render(createElement(Harness)));
  expect(reads).toEqual([]);expect(learningSystem.execute).not.toHaveBeenCalled();expect(contentSupplySystem.read).not.toHaveBeenCalled();expect(contentSupplySystem.execute).not.toHaveBeenCalled();
  await act(async()=>{expect(await controller!.start('personal-target',20)).toBe(true);});
  expect(reads).toEqual(['preferences']);
  expect(learningSystem.execute).toHaveBeenCalledWith(expect.objectContaining({kind:'start',targetId:'personal-target',dailyLimit:5}));
  vi.mocked(learningSystem.read).mockRejectedValueOnce(Error('localFlow.progressReadFailed'));
  await act(async()=>{expect(await controller!.start('personal-target',20)).toBeNull();});
  expect(learningSystem.execute).toHaveBeenCalledTimes(1);
 }finally{await act(async()=>root.unmount());vi.clearAllMocks();}
});

test('Learning list keeps distinct targets with the same expression, separates paused from due, and sorts actual due instants',()=>{
 const item=(id:string,group:LearningLibraryItem['group'],nextReviewAt:string|null):LearningLibraryItem=>({id,targetId:id,enrollmentId:null,expression:'same expression',meaning:`meaning ${id}`,sourceLabel:'verified Book',state:group,group,nextReviewAt});
 const items=[item('B','due','2026-10-11T01:00:00+09:00'),item('A','due','2026-10-10T19:00:00Z'),item('C','paused','2026-10-01T00:00:00Z'),item('D','new',null)];
 expect(learningLibrarySelection(items,'','all','expression','en').map(value=>value.id)).toEqual(['A','B','C','D']);
 expect(learningLibrarySelection(items,'','due','due','en').map(value=>value.id)).toEqual(['B','A']);
 expect(learningLibrarySelection(items,'','paused','due','en').map(value=>value.id)).toEqual(['C']);
 expect(learningLibrarySelection(items,'meaning D','new','due','en').map(value=>value.id)).toEqual(['D']);
 expect(learningLibrarySelection(items,'verified Book','all','due','en')).toHaveLength(4);
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
