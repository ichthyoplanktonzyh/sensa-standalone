let observer:((work:{cpuMs:number;yieldMs:number;yields:number})=>void)|undefined;
/** Local measurement seam; absent during ordinary application use. */
export function observeCooperativeWork(next:typeof observer):void{observer=next;}
/** Keep large local reconstructions off uninterrupted UI tasks without relaxing validation. */
export async function runCooperatively<T>(steps:Generator<unknown,T>):Promise<T>{
  const measured=observer;let started=measured?performance.now():0,cpuMs=0,yieldMs=0,yields=0;
  let until=performance.now()+8;
  try{for(;;){
    const step=steps.next();if(step.done)return step.value;
    if(performance.now()>=until){
      // A scheduler.yield continuation can outrank timer/other ordinary tasks.
      // Yield through their queue as well, so a long reconstruction is fair.
      const paused=measured?performance.now():0;if(measured)cpuMs+=paused-started;
      await new Promise<void>(resolve=>setTimeout(resolve,0));
      if(measured){started=performance.now();yieldMs+=started-paused;yields++;}
      until=performance.now()+8;
    }
  }}finally{if(measured){cpuMs+=performance.now()-started;measured({cpuMs,yieldMs,yields});}}
}
export function runSynchronously<T>(steps:Generator<unknown,T>):T{
  for(;;){const step=steps.next();if(step.done)return step.value;}
}
