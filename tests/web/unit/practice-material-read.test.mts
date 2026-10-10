// @vitest-environment happy-dom
import {expect,test,vi} from 'vitest';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {usePracticeMaterials} from '../../../apps/web/src/experience/usePracticeMaterials';
import {practiceMaterialsRepository} from '../../../apps/web/src/experience/practiceMaterials';

vi.mock('../../../apps/web/src/experience/practiceMaterials',()=>({practiceMaterialsRepository:{page:vi.fn(),subscribe:vi.fn()}}));
vi.mock('../../../apps/web/src/experience/services/previewStorage',()=>({previewStorage:{getItem:()=>null,setItem:vi.fn()}}));

test('listening does not load the material overview; returning to selection reads a fresh overview',async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
 const stop=vi.fn();
 vi.mocked(practiceMaterialsRepository.subscribe).mockReturnValue(stop);
 vi.mocked(practiceMaterialsRepository.page).mockResolvedValue({incarnation:'fixture',revision:1,items:[],ids:[],total:10000});
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
 function View({enabled}:{enabled:boolean}){const materials=usePracticeMaterials('en',enabled);return createElement('output',null,materials.count);}
 const render=(enabled:boolean)=>root.render(createElement(View,{enabled}));
 try{
  await act(async()=>{render(false);});
  expect(practiceMaterialsRepository.page).not.toHaveBeenCalled();
  expect(practiceMaterialsRepository.subscribe).not.toHaveBeenCalled();
  await act(async()=>{render(true);});
  expect(practiceMaterialsRepository.page).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({languageTag:'en',offset:0,limit:4}));
  expect(container.textContent).toBe('10000');
  await act(async()=>{render(false);});
  expect(stop).toHaveBeenCalledOnce();
  expect(practiceMaterialsRepository.page).toHaveBeenCalledTimes(1);
  let finishRead!:(value:Awaited<ReturnType<typeof practiceMaterialsRepository.page>>)=>void;
  const pending=new Promise<Awaited<ReturnType<typeof practiceMaterialsRepository.page>>>(resolve=>{finishRead=resolve;});
  vi.mocked(practiceMaterialsRepository.page).mockReturnValue(pending);
  await act(async()=>{render(true);});
  expect(practiceMaterialsRepository.page).toHaveBeenCalledTimes(2);
  expect(container.textContent).toBe('');
  await act(async()=>{finishRead({incarnation:'fixture',revision:2,items:[],ids:[],total:9999});await pending;});
  expect(container.textContent).toBe('9999');
 }finally{await act(async()=>{root.unmount();});container.remove();vi.clearAllMocks();}
});
