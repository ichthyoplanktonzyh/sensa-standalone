export * from './capacityBrowserEntry';
const NativeWorker=window.Worker;
window.Worker=class extends NativeWorker{constructor(url:string|URL,options?:WorkerOptions){super(url,options);this.addEventListener('message',event=>{if(event.data?.deltaStage){((window as any).deltaStages??=[]).push(event.data.deltaStage);console.log('DELTA_STAGE '+JSON.stringify(event.data.deltaStage));}});}};
