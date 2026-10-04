/** Keep large local reconstructions off uninterrupted UI tasks without relaxing validation. */
export async function runCooperatively<T>(steps:Generator<unknown,T>):Promise<T>{
  let until=performance.now()+8;
  for(;;){
    const step=steps.next();if(step.done)return step.value;
    if(performance.now()>=until){
      // A scheduler.yield continuation can outrank timer/other ordinary tasks.
      // Yield through their queue as well, so a long reconstruction is fair.
      await new Promise<void>(resolve=>setTimeout(resolve,0));
      until=performance.now()+8;
    }
  }
}
export function runSynchronously<T>(steps:Generator<unknown,T>):T{
  for(;;){const step=steps.next();if(step.done)return step.value;}
}
