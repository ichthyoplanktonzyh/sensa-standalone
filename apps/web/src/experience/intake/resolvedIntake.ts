import {sensaIntakePayloadSchema,type SensaIntakeItem,type SensaIntakePayload} from '@sensa/contracts/sensa';
import type {ResolveSemanticIntakeCommand} from './semanticIntakeModule';

/** Completion preserves captured media; the original tuple remains separate provenance. */
export function resolvedIntakePayload(item:SensaIntakeItem,input:ResolveSemanticIntakeCommand):SensaIntakePayload{
 const context=input.context?{...input.context,mediaReferenceIds:[...new Set([...(item.payload.context?.mediaReferenceIds??[]),...input.context.mediaReferenceIds])]}:item.payload.context;
 return sensaIntakePayloadSchema.parse({...item.payload,context,expression:input.expression??item.payload.expression,sense:input.sense,acceptance:{mode:'learner_direct'}});
}
