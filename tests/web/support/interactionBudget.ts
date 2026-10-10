/** Release policy for single controlled UI samples, not a statistical estimate
 * of host noise or a claim that a missed product target was met. */
export function assertInteractionBudget(elapsedMs:number,targetMs:number,label:string){
 if(!Number.isFinite(elapsedMs)||elapsedMs<0||!Number.isFinite(targetMs)||targetMs<=0)throw new Error(`${label}: invalid interaction measurement`);
 // A missed single-sample target is reported, not called a target pass. Use
 // both an absolute floor and a relative guardrail for release decisions;
 // a percentage-only boundary is too narrow for sub-second CI operations.
 const warningBandMs=Math.max(100,targetMs*0.20);
 if(!Number.isFinite(targetMs+warningBandMs))throw new Error(`${label}: invalid release limit`);
 const result={label,elapsedMs,targetMs,warningBandMs,status:elapsedMs<=targetMs?'within-target' as const:'warning' as const};
 if(elapsedMs>targetMs+warningBandMs)throw new Error(`${label}: ${elapsedMs}ms exceeds ${targetMs}ms target and ${warningBandMs}ms release warning band`);
 if(result.status==='warning')console.warn('PERFORMANCE_WARNING',JSON.stringify(result));
 return result;
}
