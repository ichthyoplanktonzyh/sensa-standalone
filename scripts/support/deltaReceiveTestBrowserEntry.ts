export * from '../assessment/capacityBrowserEntry';
const NativeWorker=window.Worker;let worker:Worker,counter=0;
const pending=new Map<number,{resolve:(value:any)=>void;reject:(cause:Error)=>void}>();
(window as any).deltaTest=(command:string)=>new Promise((resolve,reject)=>{const id=++counter;pending.set(id,{resolve,reject});worker.postMessage({deltaTest:true,id,command});});
window.Worker=class extends NativeWorker{constructor(url:string|URL,options?:WorkerOptions){super(url,options);worker=this;this.addEventListener('message',event=>{if(event.data?.deltaLostAck)(window as any).deltaLostAck=true;if(event.data?.deltaBarrier)(window as any).deltaBarrier=true;if(typeof event.data?.deltaTest==='number'){const item=pending.get(event.data.deltaTest);pending.delete(event.data.deltaTest);if(event.data.error)item?.reject(Error(event.data.error));else item?.resolve(event.data.result);}});}};
