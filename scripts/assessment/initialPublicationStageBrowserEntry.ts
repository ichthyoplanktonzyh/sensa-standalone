export * from './capacityBrowserEntry';
const NativeWorker=window.Worker;
window.Worker=class extends NativeWorker{
 private imports=new Map<number,number>();
 constructor(url:string|URL,options?:WorkerOptions){super(url,options);this.addEventListener('message',event=>{if(event.data?.publicationStage)((window as any).publicationStages??=[]).push(event.data.publicationStage);const at=this.imports.get(event.data?.id);if(at!==undefined){this.imports.delete(event.data.id);((window as any).publicationStages??=[]).push({kind:'importOwnSnapshot',elapsedMs:performance.now()-at,startEpochMs:performance.timeOrigin+at,ok:event.data.ok,report:event.data.value?.report});}});}
 postMessage(message:any,options?:Transferable[]|StructuredSerializeOptions){if(message?.kind==='initializeOwnCloudSnapshot')this.imports.set(message.id,performance.now());if(Array.isArray(options))super.postMessage(message,options);else super.postMessage(message,options);}
};
