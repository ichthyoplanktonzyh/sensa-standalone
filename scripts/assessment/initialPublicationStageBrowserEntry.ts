export * from './capacityBrowserEntry';
const NativeWorker=window.Worker;
window.Worker=class extends NativeWorker{constructor(url:string|URL,options?:WorkerOptions){super(url,options);this.addEventListener('message',event=>{if(event.data?.publicationStage)((window as any).publicationStages??=[]).push(event.data.publicationStage);});}};
