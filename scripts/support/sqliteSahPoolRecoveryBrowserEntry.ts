import RecoveryWorker from './sqliteSahPoolRecoveryWorker.ts?worker';

export type RecoveryPoolInput=Readonly<{
  directory:string;
  name:string;
  databaseFile:string;
  initialCapacity:number;
}>;

type RecoveryWorkerRequest=RecoveryPoolInput&Readonly<{
  requestId:string;
  action:'createSentinel'|'initExpectedConflict'|'openAndRead'|'openAbruptly'|'holdSlots'|'probeSlots'|'releaseSlots';
  sentinelKey?:string;
  sentinelValue?:string;
  slotCount?:number;
}>;

export type RecoveryWorkerResponse=Readonly<{
  requestId:string;
  ok:boolean;
  value?:unknown;
  error?:Readonly<{name:string;message:string;stack?:string}>;
}>;

const workerTimeoutMs=30_000;
const activeWorkers=new Map<string,Worker>();

const terminate=(workerId:string):boolean=>{
  const worker=activeWorkers.get(workerId);
  if(!worker)return false;
  activeWorkers.delete(workerId);
  worker.terminate();
  return true;
};

const requestWorker=(worker:Worker,command:Omit<RecoveryWorkerRequest,'requestId'>):Promise<RecoveryWorkerResponse>=>{
  const requestId=crypto.randomUUID();
  return new Promise((resolve,reject)=>{
    let timeout:ReturnType<typeof setTimeout>|undefined;
    const cleanup=()=>{
      if(timeout)clearTimeout(timeout);
      worker.removeEventListener('message',onMessage);
      worker.removeEventListener('error',onError);
    };
    const onMessage=(event:MessageEvent<RecoveryWorkerResponse>)=>{
      if(event.data.requestId!==requestId)return;
      cleanup();
      resolve(event.data);
    };
    const onError=(event:ErrorEvent)=>{
      cleanup();
      reject(event.error instanceof Error?event.error:new Error(event.message||'sqlite_sahpool_recovery_worker_error'));
    };
    worker.addEventListener('message',onMessage);
    worker.addEventListener('error',onError);
    timeout=setTimeout(()=>{
      cleanup();
      reject(new Error(`sqlite_sahpool_worker_request_timeout:${command.action}:${workerTimeoutMs}`));
    },workerTimeoutMs);
    worker.postMessage({...command,requestId} satisfies RecoveryWorkerRequest);
  });
};

const runOneShot=async(command:Omit<RecoveryWorkerRequest,'requestId'>):Promise<RecoveryWorkerResponse>=>{
  const worker=new RecoveryWorker();
  const workerId=crypto.randomUUID();
  activeWorkers.set(workerId,worker);
  try{return await requestWorker(worker,command);}
  finally{terminate(workerId);}
};

const openAbruptly=async(command:Omit<RecoveryWorkerRequest,'requestId'|'action'>):Promise<Readonly<{
  workerId:string;
  response:RecoveryWorkerResponse;
}>>=>{
  const worker=new RecoveryWorker();
  const workerId=crypto.randomUUID();
  activeWorkers.set(workerId,worker);
  try{
    const response=await requestWorker(worker,{...command,action:'openAbruptly'});
    if(!response.ok)terminate(workerId);
    return {workerId,response};
  }catch(error){
    terminate(workerId);
    throw error;
  }
};

const initExpectedConflict=async(command:RecoveryPoolInput):Promise<Readonly<{
  workerId:string;
  response:RecoveryWorkerResponse;
}>>=>{
  const worker=new RecoveryWorker();
  const workerId=crypto.randomUUID();
  activeWorkers.set(workerId,worker);
  try{
    const response=await requestWorker(worker,{...command,action:'initExpectedConflict'});
    return {workerId,response};
  }catch(error){
    terminate(workerId);
    throw error;
  }
};

const holdSlots=async(command:Omit<RecoveryWorkerRequest,'requestId'|'action'>&Readonly<{
  slotCount:number;
}>):Promise<Readonly<{workerId:string;response:RecoveryWorkerResponse}>>=>{
  const worker=new RecoveryWorker();
  const workerId=crypto.randomUUID();
  activeWorkers.set(workerId,worker);
  try{
    const response=await requestWorker(worker,{...command,action:'holdSlots'});
    if(!response.ok)terminate(workerId);
    return {workerId,response};
  }catch(error){
    terminate(workerId);
    throw error;
  }
};

const releaseSlots=async(input:Readonly<{workerId:string;pool:RecoveryPoolInput}>):Promise<RecoveryWorkerResponse>=>{
  const {workerId}=input;
  const worker=activeWorkers.get(workerId);
  if(!worker)throw new Error('sqlite_sahpool_holder_worker_missing');
  try{return await requestWorker(worker,{...input.pool,action:'releaseSlots'});}
  finally{terminate(workerId);}
};

const terminateWorker=(input:Readonly<{workerId:string}>):Readonly<{terminated:boolean}>=>({
  terminated:terminate(input.workerId),
});

export const sqliteSahPoolRecoveryApi=Object.freeze({
  createSentinel:(command:Omit<RecoveryWorkerRequest,'requestId'|'action'>&Readonly<{
    sentinelKey:string;
    sentinelValue:string;
  }>)=>runOneShot({...command,action:'createSentinel'}),
  holdSlots,
  initExpectedConflict,
  openAndRead:(command:RecoveryPoolInput&Readonly<{sentinelKey:string}>)=>runOneShot({...command,action:'openAndRead'}),
  openAbruptly,
  probeSlots:(command:RecoveryPoolInput)=>runOneShot({...command,action:'probeSlots'}),
  releaseSlots,
  terminateWorker,
  terminateAll:(_input:Readonly<Record<string,never>>)=>{
    let terminated=0;
    for(const workerId of [...activeWorkers.keys()])if(terminate(workerId))terminated++;
    return {terminated};
  },
});

declare global{
  interface Window{
    __sqliteSahPoolRecovery?:typeof sqliteSahPoolRecoveryApi;
  }
}

window.__sqliteSahPoolRecovery=sqliteSahPoolRecoveryApi;
