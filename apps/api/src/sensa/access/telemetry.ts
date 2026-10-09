import type {MiddlewareHandler} from 'hono';
import {failureDiagnostics,type FailureDiagnostics} from '../../server/failureDiagnostics.js';
export type ServiceSurface='account'|'model'|'reading'|'packages'|'sync'|'intake'|'telemetry'|'other';
export type ServiceRequestRecord={event:'sensa.request';requestId:string;method:string;surface:ServiceSurface;component:string;release:string;errorCode:string|null;status:number;durationMs:number}&Partial<FailureDiagnostics>;

const release=()=>/^[a-f0-9]{40}$/u.test(process.env.SENSA_RELEASE_SHA??'')?process.env.SENSA_RELEASE_SHA!:'development';
const safeErrorCode=(value:unknown):string|null=>typeof value==='string'&&/^[a-z][a-z0-9_.-]{0,63}$/u.test(value)?value:null;
export const setTelemetryError=(context:{set:(key:string,value:string)=>void},code:string):void=>context.set('telemetryErrorCode',safeErrorCode(code)??'unclassified');
export const setTelemetryFailure=(context:{set:(key:string,value:FailureDiagnostics)=>void},error:unknown):void=>context.set('telemetryFailure',failureDiagnostics(error));
/** Only bounded operational metadata; never bodies, URLs, tokens, email or model output. */
export function serviceTelemetry(emit:(record:ServiceRequestRecord)=>void=record=>console.info(JSON.stringify(record))):MiddlewareHandler{
 return async(c,next)=>{
  const requestId=crypto.randomUUID(),started=performance.now();
  c.header('X-Request-ID',requestId);c.header('Cache-Control','no-store');
  await next();
  const path=c.req.path;
  const surface:ServiceSurface=path.startsWith('/sensa/account')||path.includes('/access/session')?'account':path.startsWith('/sensa/model/')?'model':path.startsWith('/sensa/reading')?'reading':path.startsWith('/sensa/packages')?'packages':path.startsWith('/sensa/library-sync')?'sync':path.startsWith('/sensa/intake')?'intake':path==='/sensa/browser-events'?'telemetry':'other';
  const method=['GET','POST','OPTIONS','HEAD'].includes(c.req.method)?c.req.method:'OTHER';
  const errorCode=safeErrorCode(c.get('telemetryErrorCode'))??(c.res.status>=500?'unclassified':null);
  const failure=c.get('telemetryFailure') as FailureDiagnostics|undefined;
  try{emit({event:'sensa.request',requestId,method,surface,component:`consumer.${surface}`,release:release(),errorCode,status:c.res.status,durationMs:Math.max(0,Math.round(performance.now()-started)),...failure});}catch{/* Logging must never roll back an accepted operation. */}
 };
}
