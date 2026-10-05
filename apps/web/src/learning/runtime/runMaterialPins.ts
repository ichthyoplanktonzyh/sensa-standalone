import {canonicalJsonDigest} from '@sensa/learning-kernel';
import {backupEqual,encodeBackupValue} from '../../data/library/backupCodec';
import type {LocalLearningMaterialization,LocalLearningRunParticipant} from './localProtocol';

export type RunMaterialPins=Pick<LocalLearningRunParticipant,'material'|'materializations'|'presentedMaterials'|'presentationOrder'>;
export const runMaterialDigest=(material:LocalLearningMaterialization)=>canonicalJsonDigest(encodeBackupValue(material));
const invalid=()=>{throw new Error('localFlow.resourceInvalid');};

/** Run-local immutable bodies. References pin exact snapshots, never today's
 * Curriculum pointer or a public cache that may no longer be available. */
export function runMaterial(pins:RunMaterialPins,reference:string):LocalLearningMaterialization{
 if(typeof reference!=='string'||!/^[a-f0-9]{64}$/u.test(reference)||!pins.materializations||!Object.hasOwn(pins.materializations,reference))return invalid();
 return pins.materializations[reference]!;
}
export const runBaselineMaterial=(pins:RunMaterialPins)=>runMaterial(pins,pins.material);
export const runStepMaterial=(pins:RunMaterialPins,stepId:string)=>runMaterial(pins,pins.presentedMaterials?.[stepId]!);
export const runMaterialById=(pins:RunMaterialPins,materializationId:string)=>Object.values(pins.materializations).find(material=>material.snapshot.learningMaterializationId===materializationId)??invalid();
export function storeRunMaterial(pins:RunMaterialPins,material:LocalLearningMaterialization):string{
 const reference=runMaterialDigest(material),existing=pins.materializations[reference];
 if(existing&&!backupEqual(existing,material))return invalid();
 if(!existing)pins.materializations[reference]=structuredClone(material);
 return reference;
}
export function pinRunStepMaterial(pins:RunMaterialPins,stepId:string,material:LocalLearningMaterialization):void{
 if(!stepId.trim()||!Array.isArray(pins.presentationOrder))return invalid();
 if(!Object.hasOwn(pins.presentedMaterials,stepId))pins.presentationOrder.push(stepId);
 pins.presentedMaterials[stepId]=storeRunMaterial(pins,material);
}
export function validateRunMaterialPins(pins:RunMaterialPins):LocalLearningMaterialization[]{
 if(!pins.materializations||typeof pins.materializations!=='object'||Array.isArray(pins.materializations)||!pins.presentedMaterials||typeof pins.presentedMaterials!=='object'||Array.isArray(pins.presentedMaterials))return invalid();
 if(!Array.isArray(pins.presentationOrder)||pins.presentationOrder.some(stepId=>typeof stepId!=='string'||!stepId.trim())||new Set(pins.presentationOrder).size!==pins.presentationOrder.length||!backupEqual([...pins.presentationOrder].sort(),Object.keys(pins.presentedMaterials).sort()))return invalid();
 const materializationIds=new Set<string>();
 const materials=Object.entries(pins.materializations).map(([reference,material])=>{if(reference!==runMaterialDigest(material)||materializationIds.has(material.snapshot.learningMaterializationId))return invalid();materializationIds.add(material.snapshot.learningMaterializationId);return material;});
 runBaselineMaterial(pins);for(const [stepId,reference] of Object.entries(pins.presentedMaterials)){if(!stepId.trim())return invalid();runMaterial(pins,reference);}
 return materials;
}
