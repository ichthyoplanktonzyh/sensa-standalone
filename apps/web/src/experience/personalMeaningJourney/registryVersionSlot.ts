/** Issued version numbers are unique. A private edit uses an immutable ID and
 * a parent pin, so offline branches may have the same depth without aliasing. */
export function registryVersionSlot(kind:string,fact:Record<string,any>):string|undefined{
 if(kind==='senseVersions')return fact.origin==='learner_confirmed'&&fact.contentReleaseId===null&&typeof fact.parentSenseVersionId==='string'
  ?`senseVersions:id:${fact.senseVersionId}`:`senseVersions:${fact.senseId}:${fact.versionNumber}`;
 if(kind==='expressionVersions')return `expressionVersions:${fact.expressionId}:${fact.versionNumber}`;
 if(kind==='bindingVersions')return fact.provenance?.sourceKind==='learner_confirmed'&&typeof fact.parentBindingVersionId==='string'
  ?`bindingVersions:id:${fact.bindingVersionId}`:`bindingVersions:${fact.senseExpressionBindingId}:${fact.versionNumber}`;
 return undefined;
}
