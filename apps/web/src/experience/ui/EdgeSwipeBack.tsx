import {useEffect,useRef,useState,type PointerEvent as ReactPointerEvent} from 'react';

const INTENT_DISTANCE=10;
const MIN_COMMIT_DISTANCE=72;
const MAX_COMMIT_DISTANCE=120;
const SPRING_RESPONSE_SECONDS=0.28;

export interface EdgeSwipeSample{
 readonly deltaX:number;
 readonly deltaY:number;
 readonly velocityX:number;
 readonly viewportWidth:number;
}

export interface EdgeSwipeDecision{
 readonly horizontal:boolean;
 readonly progress:number;
 readonly commit:boolean;
 readonly threshold:number;
}

const clamp=(value:number,min:number,max:number)=>Math.min(max,Math.max(min,value));

/** Apple's exponential projection with a deliberately quick navigation decay. */
const project=(velocity:number,decelerationRate=0.99)=>(velocity/1000)*decelerationRate/(1-decelerationRate);

export function resolveEdgeSwipeBack(sample:EdgeSwipeSample):EdgeSwipeDecision{
 const deltaX=Math.max(0,sample.deltaX);
 const horizontal=deltaX>=INTENT_DISTANCE&&deltaX>Math.abs(sample.deltaY)*1.15;
 const threshold=clamp(sample.viewportWidth*0.24,MIN_COMMIT_DISTANCE,MAX_COMMIT_DISTANCE);
 const projected=deltaX+project(Math.max(0,sample.velocityX));
 return {
  horizontal,
  progress:horizontal?clamp(projected/threshold,0,1):0,
  commit:horizontal&&projected>=threshold,
  threshold,
 };
}

type SpringController={cancel:()=>number};

function springScreen(
 element:HTMLElement,
 from:number,
 to:number,
 initialVelocity:number,
 complete:()=>void,
):SpringController{
 if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){
  element.style.transform=`translate3d(${to}px,0,0)`;
  queueMicrotask(complete);
  return {cancel:()=>to};
 }
 let frame=0,current=from,velocity=initialVelocity,last=performance.now(),cancelled=false;
 const omega=2*Math.PI/SPRING_RESPONSE_SECONDS;
 const step=(now:number)=>{
  if(cancelled)return;
  const delta=Math.min(0.032,Math.max(0.001,(now-last)/1000));last=now;
  const acceleration=-2*omega*velocity-omega*omega*(current-to);
  velocity+=acceleration*delta;
  current+=velocity*delta;
  element.style.transform=`translate3d(${current}px,0,0)`;
  if(Math.abs(current-to)<0.5&&Math.abs(velocity)<5){
   current=to;element.style.transform=`translate3d(${to}px,0,0)`;complete();return;
  }
  frame=requestAnimationFrame(step);
 };
 frame=requestAnimationFrame(step);
 return {cancel:()=>{cancelled=true;cancelAnimationFrame(frame);return current;}};
}

const hapticThreshold=()=>{
 if(document.visibilityState==='visible'&&typeof navigator.vibrate==='function'){
  try{navigator.vibrate(8);}catch{/* Haptics are an optional device capability. */}
 }
};

const installedOnCoarsePointer=()=>{
 const standalone=window.matchMedia('(display-mode: standalone)').matches
  ||Boolean((navigator as Navigator&{standalone?:boolean}).standalone);
 return standalone&&window.matchMedia('(pointer: coarse)').matches;
};

type Gesture={
 pointerId:number;
 startX:number;
 startY:number;
 baseOffset:number;
 locked:boolean;
 haptic:boolean;
 slot:HTMLElement;
 history:Array<{x:number;at:number}>;
};

/**
 * Installed-mobile enhancement for the existing Sheet Stack. It never replaces
 * visible Back controls and never runs during a learning flow or modal.
 */
export function EdgeSwipeBack({enabled,onBack}:{readonly enabled:boolean;readonly onBack:()=>void}){
 const [available,setAvailable]=useState(false);
 const gesture=useRef<Gesture|null>(null);
 const spring=useRef<SpringController|null>(null);
 const indicator=useRef<HTMLDivElement>(null);
 const onBackRef=useRef(onBack);onBackRef.current=onBack;

 useEffect(()=>{
  const display=window.matchMedia('(display-mode: standalone)');
  const pointer=window.matchMedia('(pointer: coarse)');
  const update=()=>setAvailable(installedOnCoarsePointer());
  update();display.addEventListener('change',update);pointer.addEventListener('change',update);
  return()=>{display.removeEventListener('change',update);pointer.removeEventListener('change',update);};
 },[]);

 useEffect(()=>()=>{spring.current?.cancel();},[]);

 const resetIndicator=()=>{
  const node=indicator.current;if(!node)return;
  delete node.dataset.active;delete node.dataset.ready;
  node.style.removeProperty('--sensa-edge-swipe-indicator-x');
  node.style.removeProperty('--sensa-edge-swipe-progress');
 };
 const cleanSlot=(slot:HTMLElement)=>{
  delete slot.dataset.sensaEdgeSwipeScreen;slot.style.removeProperty('transform');slot.style.removeProperty('will-change');
 };
 const animateBack=(current:Gesture,commit:boolean,velocity:number)=>{
  const raw=current.baseOffset+Math.max(0,(current.history.at(-1)?.x??current.startX)-current.startX);
  current.slot.dataset.sensaEdgeSwipeScreen=commit?'commit':'cancel';
  const target=commit?window.innerWidth:0;
  spring.current=springScreen(current.slot,raw,target,velocity,()=>{
   spring.current=null;cleanSlot(current.slot);resetIndicator();
   if(commit)onBackRef.current();
  });
 };
 const cancelGesture=(velocity=0)=>{
  const current=gesture.current;if(!current)return;
  gesture.current=null;animateBack(current,false,velocity);
 };
 const velocity=(current:Gesture)=>{
  const end=current.history.at(-1);if(!end)return 0;
  const start=[...current.history].reverse().find(point=>end.at-point.at>=45)??current.history[0];
  const seconds=Math.max(0.001,(end.at-start.at)/1000);
  return (end.x-start.x)/seconds;
 };
 const updateIndicator=(deltaX:number,progress:number,ready:boolean)=>{
  const node=indicator.current;if(!node)return;
  node.dataset.active='';
  if(ready)node.dataset.ready='';else delete node.dataset.ready;
  node.style.setProperty('--sensa-edge-swipe-indicator-x',`${Math.min(28,deltaX*0.22)}px`);
  node.style.setProperty('--sensa-edge-swipe-progress',String(Math.max(0.18,progress)));
 };
 const onPointerDown=(event:ReactPointerEvent<HTMLDivElement>)=>{
  if(!enabled||event.pointerType!=='touch'||!event.isPrimary)return;
  const slot=document.querySelector<HTMLElement>('[data-sensa-screen-phase="current"]');if(!slot)return;
  const baseOffset=spring.current?.cancel()??0;spring.current=null;
  event.currentTarget.setPointerCapture(event.pointerId);
  slot.dataset.sensaEdgeSwipeScreen='tracking';slot.style.willChange='transform';
  gesture.current={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,baseOffset,locked:false,haptic:false,slot,history:[{x:event.clientX,at:event.timeStamp}]};
  updateIndicator(0,0,false);
 };
 const onPointerMove=(event:ReactPointerEvent<HTMLDivElement>)=>{
  const current=gesture.current;if(!current||current.pointerId!==event.pointerId)return;
  const deltaX=current.baseOffset+Math.max(0,event.clientX-current.startX),deltaY=event.clientY-current.startY;
  current.history.push({x:event.clientX,at:event.timeStamp});
  if(current.history.length>6)current.history.shift();
  if(!current.locked){
   if(Math.abs(deltaY)>=INTENT_DISTANCE&&Math.abs(deltaY)>=deltaX){cancelGesture();return;}
   if(deltaX<INTENT_DISTANCE||deltaX<=Math.abs(deltaY)*1.15)return;
   current.locked=true;
  }
  current.slot.style.transform=`translate3d(${deltaX}px,0,0)`;
  const decision=resolveEdgeSwipeBack({deltaX,deltaY,velocityX:velocity(current),viewportWidth:window.innerWidth});
  if(decision.commit&&!current.haptic){current.haptic=true;hapticThreshold();}
  updateIndicator(deltaX,decision.progress,decision.commit);
 };
 const finish=(event:ReactPointerEvent<HTMLDivElement>)=>{
  const current=gesture.current;if(!current||current.pointerId!==event.pointerId)return;
  current.history.push({x:event.clientX,at:event.timeStamp});
  gesture.current=null;
  const speed=velocity(current),deltaX=current.baseOffset+Math.max(0,event.clientX-current.startX),deltaY=event.clientY-current.startY;
  const decision=resolveEdgeSwipeBack({deltaX,deltaY,velocityX:speed,viewportWidth:window.innerWidth});
  animateBack(current,decision.commit,speed);
 };

 if(!available||!enabled)return null;
 return <div aria-hidden="true" data-sensa-edge-swipe-zone onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={finish} onPointerCancel={()=>cancelGesture()}>
  <div ref={indicator} data-sensa-edge-swipe-indicator><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m14.5 6-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
 </div>;
}
