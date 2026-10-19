export type FailureDiagnostics={
  failureKind:'database'|'transport'|'runtime-reference'|'runtime-type'|'unexpected';
  failureCode?:string;
  failurePhase?:'connect'|'synthesis'|'audio';
  upstreamStatus?:number;
  upstreamCloseCode?:number;
};

// Only fixed operational codes may cross the logging boundary. A matching
// shape alone is not permission to log an arbitrary exception property.
// https://www.postgresql.org/docs/current/errcodes-appendix.html
const databaseCodes=new Set([
  '08001','08006','23502','23503','23505','23514','40001','40P01',
  '28000','28P01','3D000','42501','42601','42703','42P01','53300','55P03','57014','57P01','XX000',
]);
const transportCodes=new Set(['ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENOTFOUND','EPIPE','ABORT_ERR']);
const speechCodes=new Set(['EDGE_TTS_HANDSHAKE_TIMEOUT','EDGE_TTS_HANDSHAKE_REJECTED','EDGE_TTS_EMPTY_AUDIO','EDGE_TTS_TIMEOUT','EDGE_TTS_CANCELLED','EDGE_TTS_SEND_FAILED','EDGE_TTS_AUDIO_LIMIT','EDGE_TTS_INVALID_AUDIO','EDGE_TTS_TLS_FAILED','EDGE_TTS_CONNECTION_FAILED','EDGE_TTS_CONNECTION_CLOSED']);
const speechPhases=new Set(['connect','synthesis','audio']);
const ownValue=(error:object,key:string):unknown=>Object.getOwnPropertyDescriptor(error,key)?.value;
function transportDetails(error:object,code:string):FailureDiagnostics{
  const result:FailureDiagnostics={failureKind:'transport',failureCode:code};
  const phase=ownValue(error,'failurePhase');
  if(typeof phase==='string'&&speechPhases.has(phase))result.failurePhase=phase as FailureDiagnostics['failurePhase'];
  const status=ownValue(error,'upstreamStatus'),closeCode=ownValue(error,'upstreamCloseCode');
  if(code==='EDGE_TTS_HANDSHAKE_REJECTED'&&typeof status==='number'&&Number.isInteger(status)&&status>=100&&status<=599)result.upstreamStatus=status;
  if(code==='EDGE_TTS_CONNECTION_CLOSED'&&typeof closeCode==='number'&&Number.isInteger(closeCode)&&closeCode>=1000&&closeCode<=4999)result.upstreamCloseCode=closeCode;
  return result;
}


/** No messages, names, stacks, nested causes, SQL, identifiers or payloads.
 * Accessors and hostile thrown values cannot make diagnosis fail a request. */
export function failureDiagnostics(error:unknown):FailureDiagnostics{
  try{
    const code=error!==null&&typeof error==='object'
      ?Object.getOwnPropertyDescriptor(error,'code')?.value:undefined;
    if(typeof code==='string'&&code.length<=32){
      if(databaseCodes.has(code))return {failureKind:'database',failureCode:code};
      if(transportCodes.has(code)||speechCodes.has(code))return transportDetails(error as object,code);
    }
    if(error instanceof ReferenceError)return {failureKind:'runtime-reference'};
    if(error instanceof TypeError)return {failureKind:'runtime-type'};
  }catch{/* Diagnostics must never replace the original failure. */}
  return {failureKind:'unexpected'};
}
