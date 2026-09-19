type LeasedPreparation={
 readonly status:string;
 readonly leaseUntil:number;
};

/** Earliest fact boundary that can change a preparation from running to stale. */
export const nextPersonalLearningLeaseExpiry=(tasks:readonly LeasedPreparation[],now:number):number|null=>tasks
 .filter(task=>['generating','reviewing'].includes(task.status)&&task.leaseUntil>now)
 .reduce<number|null>((next,task)=>next===null?task.leaseUntil:Math.min(next,task.leaseUntil),null);
