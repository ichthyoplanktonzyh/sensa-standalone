export type FailureDiagnostics={
  failureKind:'database'|'transport'|'runtime-reference'|'runtime-type'|'unexpected';
  failureCode?:string;
};

// Only fixed operational codes may cross the logging boundary. A matching
// shape alone is not permission to log an arbitrary exception property.
// https://www.postgresql.org/docs/current/errcodes-appendix.html
const databaseCodes=new Set([
  '08001','08006','23502','23503','23505','23514','40001','40P01',
  '28000','28P01','3D000','42501','42601','42703','42P01','53300','55P03','57014','57P01','XX000',
]);
const transportCodes=new Set(['ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENOTFOUND','EPIPE','ABORT_ERR']);

/** No messages, names, stacks, nested causes, SQL, identifiers or payloads.
 * Accessors and hostile thrown values cannot make diagnosis fail a request. */
export function failureDiagnostics(error:unknown):FailureDiagnostics{
  try{
    const code=error!==null&&typeof error==='object'
      ?Object.getOwnPropertyDescriptor(error,'code')?.value:undefined;
    if(typeof code==='string'&&code.length<=32){
      if(databaseCodes.has(code))return {failureKind:'database',failureCode:code};
      if(transportCodes.has(code))return {failureKind:'transport',failureCode:code};
    }
    if(error instanceof ReferenceError)return {failureKind:'runtime-reference'};
    if(error instanceof TypeError)return {failureKind:'runtime-type'};
  }catch{/* Diagnostics must never replace the original failure. */}
  return {failureKind:'unexpected'};
}
