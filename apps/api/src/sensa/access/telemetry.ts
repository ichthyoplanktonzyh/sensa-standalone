import type {MiddlewareHandler} from 'hono';
export type ServiceRequestRecord={event:'sensa.request';requestId:string;method:string;surface:'account'|'model'|'reading'|'packages'|'sync'|'other';status:number;durationMs:number};
/** Only bounded operational metadata; never bodies, URLs, tokens, email or model output. */
export function serviceTelemetry(emit:(record:ServiceRequestRecord)=>void=record=>console.info(JSON.stringify(record))):MiddlewareHandler{
 return async(c,next)=>{
  const requestId=crypto.randomUUID(),started=performance.now();
  c.header('X-Request-ID',requestId);c.header('Cache-Control','no-store');
  await next();
  const path=c.req.path;
  const surface=path.startsWith('/sensa/account')||path.includes('/access/session')?'account':path.startsWith('/sensa/model/')?'model':path.startsWith('/sensa/reading')?'reading':path.startsWith('/sensa/packages')?'packages':path.startsWith('/sensa/sync')?'sync':'other';
  const method=['GET','POST','OPTIONS','HEAD'].includes(c.req.method)?c.req.method:'OTHER';
  try{emit({event:'sensa.request',requestId,method,surface,status:c.res.status,durationMs:Math.max(0,Math.round(performance.now()-started))});}catch{/* Logging must never roll back an accepted operation. */}
 };
}
