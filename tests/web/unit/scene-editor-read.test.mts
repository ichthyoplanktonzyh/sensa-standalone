// @vitest-environment happy-dom
/** Real editor with controlled read results; not a Chromium or storage test. */
import {expect,test,vi} from 'vitest';
import {act,createElement,type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import {SceneEditorModal} from '../../../apps/web/src/experience/components/SceneEditorModal';
import {personalContentSystem,type PersonalContentSystem,type SenseContextNote} from '../../../apps/web/src/personalContent/system';
import {cardText} from '../../../apps/web/src/i18n/originalCards';
import {uiText} from '../../../apps/web/src/i18n/uiText';

vi.mock('react-i18next',async importOriginal=>({...await importOriginal<typeof import('react-i18next')>(),useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('../../../apps/web/src/personalContent/system',()=>({personalContentSystem:{readScene:vi.fn(),execute:vi.fn()},currentPersonalLearningSceneRevision:vi.fn()}));
vi.mock('../../../apps/web/src/experience/ui/SensaComponents',()=>({
 SensaOverlayLayout:({regions}:{regions:Record<string,ReactNode>})=>createElement('section',{role:'dialog'},...Object.values(regions)),
}));

test('scene editor waits for exact content, retries a failed read and ignores a previous keyed target response before allowing save',async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
 let resolveA!:(value:SenseContextNote)=>void;
 const pendingA=new Promise<SenseContextNote>(resolve=>{resolveA=resolve;});
 const note=(contextId:string):SenseContextNote=>({id:`sense_context:${contextId}`,kind:'sense_context',contextId,senseId:'sense',body:`Stored Context ${contextId}`,media:[],revision:1,createdAt:1,updatedAt:1});
 let failB=true;
 vi.mocked(personalContentSystem.readScene).mockImplementation((async query=>{
  if(query.kind!=='sense_context')throw Error('wrong editor query');
  if(query.contextId==='A')return pendingA;
  if(failB)throw Error('controlled exact read failure');
  return note(query.contextId);
 }) as PersonalContentSystem['readScene']);
 vi.mocked(personalContentSystem.execute).mockResolvedValue('B');
 const onClose=vi.fn(),toast=vi.fn(),container=document.createElement('div');document.body.append(container);
 const root=createRoot(container);
 const render=(contextId:string)=>root.render(createElement(SceneEditorModal,{key:contextId,active:true,senseId:'sense',word:'borrow',senseMeaning:'Temporary borrowing',contextId,onClose,toast}));
 const button=(label:string)=>[...container.querySelectorAll<HTMLButtonElement>('button')].find(row=>row.getAttribute('aria-label')===label||row.textContent===label)!;
 try{
  await act(async()=>{render('A');});
  expect(container.querySelector<HTMLTextAreaElement>('textarea')?.disabled).toBe(true);
  expect(button(cardText('sceneSave')).disabled).toBe(true);
  expect(button(cardText('sceneClose')).disabled).toBe(false);
  expect(personalContentSystem.execute).not.toHaveBeenCalled();
  await act(async()=>{render('B');});
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(button(cardText('sceneSave')).disabled).toBe(true);
  failB=false;await act(async()=>{button(uiText('retry')).click();});
  expect(container.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Stored Context B');
  expect(button(cardText('sceneSave')).disabled).toBe(false);
  await act(async()=>{resolveA(note('A'));await pendingA;});
  expect(container.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Stored Context B');
  await act(async()=>{button(cardText('sceneSave')).click();});
  expect(personalContentSystem.execute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({kind:'save_sense_context',senseId:'sense',contextId:'B',body:'Stored Context B',media:[]}));
  expect(onClose).toHaveBeenCalledTimes(1);
 }finally{await act(async()=>{root.unmount();});container.remove();vi.clearAllMocks();}
});
