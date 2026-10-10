/** Fatal physical-connection failures, not ordinary rejected commands. */
export const isFatalSqliteConnectionFailure=(cause:unknown):boolean=>{
  const pending=[cause],seen=new Set<Error>();
  while(pending.length){
    const current=pending.pop();if(!(current instanceof Error)||seen.has(current))continue;
    seen.add(current);
    if(current.message==='sqlite_integrity_failed')return true;
    const code='resultCode' in current?current.resultCode:undefined;
    // Extended SQLite result codes retain the primary result in the low byte:
    // IOERR, CORRUPT and NOTADB. Constraint/BUSY/domain errors do not poison it.
    if(typeof code==='number'&&[10,11,26].includes(code&255))return true;
    if(current instanceof AggregateError)for(const nested of current.errors)pending.push(nested);
    if('cause' in current)pending.push(current.cause);
  }
  return false;
};

/** Retain the command's original message and both causes when rollback fails. */
export const sqliteRollbackFailure=(primary:unknown,rollback:unknown):AggregateError=>new AggregateError([primary,rollback],primary instanceof Error?primary.message:'sqlite_transaction_failed');
