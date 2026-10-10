import {z} from 'zod';
import type {LocalLearningMaterialization} from '../../learning/runtime/localProtocol';

const timestamp=z.string().datetime({offset:true});

/** Source admission survives the per-Run snapshot creation time. A supplement
 * becomes available separately; neither instant is inferred from Run history. */
export function materialReadyAt(material:LocalLearningMaterialization):number{
 const source=Date.parse(timestamp.parse(material.snapshot.provenance.sourceReadyAt));
 const supplement=material.snapshot.provenance.resourceSupplement as {readyAt?:unknown}|undefined;
 const ready=supplement?Date.parse(timestamp.parse(supplement.readyAt)):source;
 if(ready<source||ready>Date.parse(timestamp.parse(material.snapshot.createdAt)))throw new Error('localFlow.resourceInvalid');
 return ready;
}

export function assertMaterialAvailableAt(material:LocalLearningMaterialization,at:string):void{
 if(materialReadyAt(material)>Date.parse(timestamp.parse(at)))throw new Error('localFlow.clockChanged');
}
