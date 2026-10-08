/** Actual hook/listening renderer; only the external Widget events are controlled. */
import {createRoot,type Root} from 'react-dom/client';
import {useRef,useState} from 'react';
import '../../../apps/web/src/i18n/workspaceResources';
import i18n from '../../../apps/web/src/i18n';
import {useYouglishWidget} from '../../../apps/web/src/experience/useYouglishWidget';
import {YouGlishListeningScreen} from '../../../apps/web/src/experience/components/YouGlishListeningScreen';
import {ScreenMemoryProvider} from '../../../apps/web/src/experience/ui/ScreenHost';
import type {PracticeScopeTarget} from '../../../apps/web/src/experience/practiceScope';

type Event=Record<string,string|number>;
const widgets:Array<{events:Record<string,(event:Event)=>void>;calls:Array<{kind:string;args:unknown[]}>}>=[];
let root:Root|undefined,changeQuery:((query:string)=>void)|undefined,replayCurrent:(()=>void)|undefined;
export function installApi(){
 class Widget{
  private record:{events:Record<string,(event:Event)=>void>;calls:Array<{kind:string;args:unknown[]}>};
  constructor(_host:HTMLElement|string,options:unknown){this.record={events:(options as {events:Record<string,(event:Event)=>void>}).events,calls:[]};widgets.push(this.record);}
  private call(kind:string,...args:unknown[]){this.record.calls.push({kind,args});}
  fetch(...args:[string,string,string?]){this.call('fetch',...args);}
  play(){this.call('play');}pause(){this.call('pause');}replay(){this.call('replay');}
  move(seconds:number){this.call('move',seconds);}next(){this.call('next');}previous(){this.call('previous');}
  setSpeed(rate:number){this.call('speed',rate);}close(){this.call('close');}
 }
 window.YG={Widget};
}
function Probe({active}:{active:boolean}){
 const [query,setQuery]=useState('alpha'),mountRef=useRef<HTMLDivElement>(null);changeQuery=setQuery;
 const player=useYouglishWidget({mountRef,query,lang:'english',active});
 replayCurrent=player.replay;
 return <><div ref={mountRef}/><output data-testid="status">{player.status}</output><output data-testid="caption">{player.caption??''}</output><output data-testid="playing">{String(player.isPlaying)}</output><output data-testid="controls-ready">{String(player.controlsReady)}</output><output data-testid="speed">{player.speed}</output><button onClick={()=>player.setSpeed(1.25)}>Request speed</button></>;
}
export async function mountProbe(active=true){await i18n.changeLanguage('zh-CN');root=createRoot(document.getElementById('root')!);root.render(<Probe active={active}/>);}
export function setQuery(query:string){changeQuery?.(query);}
export function replay(){replayCurrent?.();}
export function records(){return widgets.map(widget=>({calls:widget.calls}));}
export function emit(index:number,event:string,payload:Event={}){widgets[index]?.events[event]?.(payload);}
export function dispose(){root?.unmount();root=undefined;}
export async function mountSpanish(){
 await i18n.changeLanguage('zh-CN');
 const target:PracticeScopeTarget={targetId:'fixture-spanish',identity:{kind:'personal_meaning_binding',personalMeaningId:'fixture',personalMeaningRevisionId:'fixture-r1',personalMeaningAlignmentId:'fixture-a1',alignmentRevision:1,alignmentBasisReferenceId:'fixture-basis',senseId:'fixture-sense',senseVersionId:'fixture-sv',bindingId:'fixture-binding',bindingVersionId:'fixture-bv'},expression:{surfaceForm:'banco',languageTag:'es',expressionType:'word',pronunciationVariant:null},sense:{senseId:'fixture-sense',senseVersionId:'fixture-sv',label:'Fixture only'},context:null,capabilities:{expressionForm:true,semanticBinding:true,context:false,pronunciation:false,validatedLearningMaterial:false},provenance:{sourceId:'personal_semantic_world',sourceLabel:'Fixture only'}};
 root=createRoot(document.getElementById('root')!);root.render(<ScreenMemoryProvider><YouGlishListeningScreen active targets={[target]} onBack={()=>{}} toast={()=>{}}/></ScreenMemoryProvider>);
}

function PlayerJourney(){
 const [active,setActive]=useState(true);
 const target={targetId:'fixture-expression',expression:{surfaceForm:'borrow',languageTag:'en'}} as PracticeScopeTarget;
 return <ScreenMemoryProvider>
  {!active&&<button onClick={()=>setActive(true)}>Open listening</button>}
  <YouGlishListeningScreen active={active} targets={[target]} onBack={()=>setActive(false)} toast={()=>{}}/>
 </ScreenMemoryProvider>;
}
/** Navigation controlled, actual listening screen/cleanup; no persisted source. */
export async function mountPlayerJourney(){await i18n.changeLanguage('zh-CN');root=createRoot(document.getElementById('root')!);root.render(<PlayerJourney/>);}
