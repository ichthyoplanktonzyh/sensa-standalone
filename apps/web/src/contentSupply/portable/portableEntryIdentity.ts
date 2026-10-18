import type {SensaPortableLightweightPackage} from '@sensa/contracts/sensa';
import {canonicalJsonDigest,stableUuid} from '@sensa/learning-kernel';

/** Shared by compilation and restore admission without loading the installer. */
export function portableEntryIdentity(value:SensaPortableLightweightPackage,published:boolean){
 const declaration=published?value.semanticDeclaration:undefined;
 if(published&&!declaration)throw new Error('localFlow.resourceInvalid',{cause:new Error('Published Portable Package has no semantic declaration')});
 const senseSeed=`${value.metadata.packageId}:${value.sense.senseId}`;
 const expressionSeed=`${senseSeed}:${value.route.targetLanguage}:${value.targetExpression.expressionKind}:${value.targetExpression.text}:${value.targetExpression.spokenForm??''}`;
 const senseId=declaration?.sense.senseId??stableUuid(`sensa-portable-sense:${senseSeed}`);
 const expressionId=declaration?.expression.expressionId??stableUuid(`sensa-portable-expression:${expressionSeed}`);
 const senseVersionId=declaration?.sense.senseVersionId??stableUuid(`sensa-portable-sense-version:${senseSeed}:${canonicalJsonDigest(value.sense)}`);
 const expressionVersionId=declaration?.expression.expressionVersionId??stableUuid(`sensa-portable-expression-version:${expressionSeed}:${canonicalJsonDigest(value.targetExpression)}`);
 return {senseId,senseVersionId,expressionId,expressionVersionId,
  bindingId:declaration?.binding.senseExpressionBindingId??stableUuid(`sensa-portable-binding:${expressionSeed}`),
  bindingVersionId:declaration?.binding.bindingVersionId??stableUuid(`sensa-portable-binding-version:${senseVersionId}:${expressionVersionId}`)};
}
