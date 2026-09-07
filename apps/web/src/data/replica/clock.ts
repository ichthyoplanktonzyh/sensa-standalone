import type {ConsumerRun} from '@sensa/contracts/sensa';
type ClockGrant={id:string;issuedAt:string;expiresAt:string;clockSessionId:string};
// Deliberately ephemeral: a reload must obtain a fresh server clock before new input.
export const clockSessionId=crypto.randomUUID();
const untrustedGrants=new Set<string>();
const calibrations=new Map<string,{received:number;offset:number;wall:number}>();
export function calibrateClock(g:ClockGrant|null|undefined,serverTime:string){if(g?.clockSessionId===clockSessionId&&!untrustedGrants.has(g.id)&&!calibrations.has(g.id))calibrations.set(g.id,{received:performance.now(),wall:Date.now(),offset:Math.max(0,Date.parse(serverTime)-Date.parse(g.issuedAt))});}
function elapsed(grantId:string){const c=calibrations.get(grantId);if(!c)return null;const delta=performance.now()-c.received;if(Math.abs(Date.now()-c.wall-delta)>300000){untrustedGrants.add(grantId);calibrations.delete(grantId);return null;}return Math.max(0,Math.floor(c.offset+delta));}
export function canContinueRun(run:ConsumerRun){const g=run.offlineGrant,age=g?elapsed(g.id):null;return !!g&&age!==null&&Date.parse(g.issuedAt)+age<=Date.parse(g.expiresAt);}

export function calibrateRun(run:ConsumerRun,serverTime:string){calibrateClock(run.offlineGrant,serverTime);}
export function clockSample(g:ClockGrant|null|undefined){const age=g?elapsed(g.id):null;if(!g||age===null||Date.parse(g.issuedAt)+age>Date.parse(g.expiresAt))return null;return {occurredAt:new Date(Date.parse(g.issuedAt)+age).toISOString(),clock:{grantId:g.id,sessionId:clockSessionId,elapsedMs:age}};}
