type BenchmarkMode={
  name:string;
  journal:'DELETE'|'PERSIST'|'WAL';
  synchronous:'FULL'|'NORMAL';
};

type BenchmarkRequest={
  action:'measure'|'verify';
  directory:string;
  modes:BenchmarkMode[];
  transactions:number;
};

const runWorker=(request:BenchmarkRequest):Promise<Array<Record<string,unknown>>>=>new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./sqliteOpfsBenchmarkWorker.ts',import.meta.url),{
    type:'module',
    name:'sensa-sqlite-opfs-benchmark',
  });
  worker.addEventListener('message',(event:MessageEvent<{ok:true;value:Array<Record<string,unknown>>}|{ok:false;error:string}>)=>{
    worker.terminate();
    if(event.data.ok)resolve(event.data.value);
    else reject(new Error(event.data.error));
  },{once:true});
  worker.addEventListener('error',(event)=>{
    worker.terminate();
    reject(new Error(event.message));
  },{once:true});
  worker.postMessage(request);
});

export async function benchmarkSqliteOpfs(){
  const modes:BenchmarkMode[]=[
    {name:'delete-full',journal:'DELETE',synchronous:'FULL'},
    {name:'persist-full',journal:'PERSIST',synchronous:'FULL'},
    {name:'wal-full',journal:'WAL',synchronous:'FULL'},
    {name:'wal-normal',journal:'WAL',synchronous:'NORMAL'},
  ];
  const directory=`/sensa-opfs-benchmark-${crypto.randomUUID()}`;
  const transactions=60;
  const measured=await runWorker({action:'measure',directory,modes,transactions});
  const verified=await runWorker({action:'verify',directory,modes,transactions});
  return {transactions,measured,verified};
}
