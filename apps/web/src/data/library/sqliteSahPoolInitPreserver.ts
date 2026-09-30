export const sqliteSahPoolPreservedInitFailureVersion='3.53.4-build1';
export const sqliteSahPoolPreserverVirtualId='virtual:sensa-sqlite-sahpool-init-preserver';

export type SahPoolInitFailureHandle=Readonly<{
  pauseVfs:()=>unknown;
}>;

export type SahPoolPreservationResult=
  |Readonly<{preserved:true}>
  |Readonly<{preserved:false;cause:unknown}>;

export const settleSahPoolAcquisitions=async<T>(
  acquisitions:readonly Promise<T>[],
  onFailure:(cause:unknown)=>void,
):Promise<T[]>=>{
  const results=await Promise.allSettled(acquisitions);
  const failed=results.find((result):result is PromiseRejectedResult=>result.status==='rejected');
  if(failed){
    onFailure(failed.reason);
    throw failed.reason;
  }
  return results.map(result=>(result as PromiseFulfilledResult<T>).value);
};

/** Attempt every close before surfacing the first failure to the caller. */
export const closeSahPoolHandles=(handles:Iterable<Readonly<{close:()=>void}>>):void=>{
  let failed=false;
  let firstFailure:unknown;
  for(const handle of handles){
    try{handle.close();}
    catch(cause){if(!failed){failed=true;firstFailure=cause;}}
  }
  if(failed)throw firstFailure;
};

/** Retain pool files while returning any partially acquired OPFS handles. */
export const preserveSahPoolAfterInitFailure=(pool:SahPoolInitFailureHandle):SahPoolPreservationResult=>{
  try{
    pool.pauseVfs();
    return {preserved:true};
  }catch(cause){
    return {preserved:false,cause};
  }
};

export const patchSqliteSahPoolInitFailure=(source:string,version:string):string=>{
  if(version!==sqliteSahPoolPreservedInitFailureVersion){
    throw new Error(`sqlite_sahpool_preserver_version_unsupported:${version}`);
  }
  const acquisitionStart='async acquireAccessHandles(clearFiles = false) {';
  const acquisitionEndMarker='Given an SAH, returns the client-specified name of';
  if(source.split(acquisitionStart).length-1!==1||source.split(acquisitionEndMarker).length-1!==1){
    throw new Error('sqlite_sahpool_preserver_acquisition_method_mismatch');
  }
  const methodStart=source.indexOf(acquisitionStart);
  const endMarkerIndex=source.indexOf(acquisitionEndMarker,methodStart);
  const methodEnd=source.lastIndexOf('}',source.lastIndexOf('/**',endMarkerIndex));
  if(methodEnd<methodStart||source.slice(methodEnd+1,source.lastIndexOf('/**',endMarkerIndex)).trim()!==''){
    throw new Error('sqlite_sahpool_preserver_acquisition_method_mismatch');
  }
  const oldMethod=source.slice(methodStart,methodEnd+1);
  if(!oldMethod.includes('return Promise.all(files.map(async ([name, h]) => {')
    ||!oldMethod.includes('this.releaseAccessHandles();')){
    throw new Error('sqlite_sahpool_preserver_acquisition_method_mismatch');
  }
  const safeMethod=[
    'async acquireAccessHandles(clearFiles = false) {',
    '\tconst files = [];',
    '\tfor await (const [name, h] of this.#dhOpaque) if ("file" === h.kind) files.push([name, h]);',
    '\treturn __sensaSettleSahPoolAcquisitions(',
    '\t\tfiles.map(async ([name, h]) => {',
    '\t\t\tconst ah = await h.createSyncAccessHandle();',
    '\t\t\tthis.#mapSAHToName.set(ah, name);',
    '\t\t\tif (clearFiles) {',
    '\t\t\t\tah.truncate(HEADER_OFFSET_DATA);',
    '\t\t\t\tthis.setAssociatedPath(ah, "", 0);',
    '\t\t\t} else {',
    '\t\t\t\tconst path = this.getAssociatedPath(ah);',
    '\t\t\t\tif (path) this.#mapFilenameToSAH.set(path, ah);',
    '\t\t\t\telse this.#availableSAH.add(ah);',
    '\t\t\t}',
    '\t\t}),',
    '\t\t(cause) => {',
    '\t\t\tthis.storeErr(cause);',
    '\t\t},',
    '\t);',
    '}',
  ].join('\n');
  let transformed=source.slice(0,methodStart)+safeMethod+source.slice(methodEnd+1);

  const releaseStart='releaseAccessHandles() {';
  const releaseEnd='\n\t\t\t\t}\n\t\t\t\t/**';
  const closeLine='for (const ah of this.#mapSAHToName.keys()) ah.close();';
  const clearSuffix='this.#availableSAH.clear();\n\t\t\t\t}';
  if(transformed.split(releaseStart).length-1!==1
    ||transformed.split(closeLine).length-1!==1
    ||transformed.split(clearSuffix).length-1!==1
    ||!transformed.includes('this.#mapSAHToName.clear();\n\t\t\t\t\tthis.#mapFilenameToSAH.clear();\n\t\t\t\t\tthis.#availableSAH.clear();')){
    throw new Error('sqlite_sahpool_preserver_release_method_mismatch');
  }
  const safeRelease='try { __sensaCloseSahPoolHandles(this.#mapSAHToName.keys()); } finally {';
  transformed=transformed.replace(closeLine,safeRelease)
    .replace(clearSuffix, 'this.#availableSAH.clear();\n\t\t\t\t}\n\t\t\t\t}');
  const releaseIndex=transformed.indexOf(releaseStart);
  const releaseMethodEnd=transformed.indexOf(releaseEnd,releaseIndex);
  if(releaseIndex<0||releaseMethodEnd<0){
    throw new Error('sqlite_sahpool_preserver_release_method_mismatch');
  }

  const pauseStart='pauseVfs() {';
  const pauseAnchor='sqlite3.SQLite3Error.toss(capi.SQLITE_MISUSE, "Cannot pause VFS"';
  const pauseEndMarker='Returns true if this pool is currently paused else false.';
  if(transformed.split(pauseAnchor).length-1!==1||transformed.split(pauseEndMarker).length-1!==1){
    throw new Error('sqlite_sahpool_preserver_pause_method_mismatch');
  }
  const pauseAnchorIndex=transformed.indexOf(pauseAnchor);
  const pauseMethodStart=transformed.lastIndexOf(pauseStart,pauseAnchorIndex);
  const pauseDocStart=transformed.lastIndexOf('/**',pauseMethodStart);
  const pauseMarkerIndex=transformed.indexOf(pauseEndMarker,pauseMethodStart);
  const pauseBoundary=transformed.lastIndexOf('/**',pauseMarkerIndex);
  const pauseMethodEnd=transformed.lastIndexOf('}',pauseBoundary);
  if(pauseDocStart<0||pauseMarkerIndex<0||pauseBoundary<0||pauseMethodEnd<pauseMethodStart
    ||transformed.slice(pauseMethodEnd+1,pauseBoundary).trim()!==''){
    throw new Error('sqlite_sahpool_preserver_pause_method_mismatch');
  }
  const oldPauseMethod=transformed.slice(pauseMethodStart,pauseMethodEnd+1);
  if(!oldPauseMethod.includes('if (this.#mapS3FileToOFile_.size > 0)')
    ||!oldPauseMethod.includes('if (this.#mapSAHToName.size > 0) {')
    ||!oldPauseMethod.includes('capi.sqlite3_vfs_unregister(this.vfsName);')
    ||!oldPauseMethod.includes('this.releaseAccessHandles();')){
    throw new Error('sqlite_sahpool_preserver_pause_method_mismatch');
  }
  const safePauseMethod=[
    'pauseVfs() {',
    '\t\t\t\t\tif (this.#mapS3FileToOFile_.size > 0) sqlite3.SQLite3Error.toss(capi.SQLITE_MISUSE, "Cannot pause VFS", this.vfsName, "because it has opened files.");',
    '\t\t\t\t\tif (capi.sqlite3_vfs_find(this.vfsName) === this.#cVfs.pointer) capi.sqlite3_vfs_unregister(this.#cVfs.pointer);',
    '\t\t\t\t\tif (this.#mapSAHToName.size > 0) this.releaseAccessHandles();',
    '\t\t\t\t\treturn this;',
    '\t\t\t\t}',
  ].join('\n');
  transformed=transformed.slice(0,pauseMethodStart)+safePauseMethod+transformed.slice(pauseMethodEnd+1);

  const removeCall='await thePool.removeVfs().catch(() => {});';
  const removeOccurrences=transformed.split(removeCall).length-1;
  if(removeOccurrences!==1)throw new Error(`sqlite_sahpool_preserver_source_mismatch:${removeOccurrences}`);
  const removeIndex=transformed.indexOf(removeCall);
  const lineStart=transformed.lastIndexOf('\n',removeIndex)+1;
  const indentation=transformed.slice(lineStart,removeIndex);
  const preserveBranch=[
    'const preservation = __sensaPreserveSahPoolAfterInitFailure(thePool);',
    'if (!preservation.preserved) sqlite3.config.error(vfsName, "SAH pool initialization failed; data was preserved but VFS pause could not be confirmed:", preservation.cause);',
  ].join(`\n${indentation}`);
  return transformed.slice(0,removeIndex)+preserveBranch+transformed.slice(removeIndex+removeCall.length);
};
