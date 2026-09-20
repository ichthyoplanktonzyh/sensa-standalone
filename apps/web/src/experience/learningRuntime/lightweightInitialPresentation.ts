/**
 * Delivery contract for the two Lightweight Initial card presentations.
 *
 * Protocol Steps name material roles. These definitions decide where accepted
 * resources may appear; the producing model never chooses layout or CSS.
 */
import {
  LIGHTWEIGHT_INITIAL_MATERIAL_ROLES,
  LIGHTWEIGHT_RESOURCE_PROFILE,
  sensaSceneRealizationSchema,
  sensaCardPresentationDefinitionSchema,
  sensaLearningConnectionContractVersion,
  sensaLightweightExperienceRecallCueSchema,
  sensaLightweightLanguageStructureMaterialSchema,
  sensaLightweightPronunciationMaterialSchema,
  sensaLightweightRecallSupportSchema,
  sensaLightweightSceneBridgeMaterialSchema,
  sensaLightweightSenseConfirmationMaterialSchema,
  sensaLightweightTargetExpressionMaterialSchema,
  sensaLightweightUsageGuidanceMaterialSchema,
  type SensaCardPresentationDefinition,
  type SensaLightweightInitialMaterialRole,
  type SensaMaterializedResource,
} from '@sensa/contracts/sensa';
import {
  lightweightMaterializedResourcesForRole,
  validateLightweightInitialMaterialization,
  type LightweightInitialLearningMaterialization,
} from '../../learning/runtime/lightweightInitialContent';
import {
  LIGHTWEIGHT_EXPERIENCE_RECALL_STEP_KIND,
  LIGHTWEIGHT_EXPRESSION_REVEAL_STEP_KIND,
  LIGHTWEIGHT_INITIAL_STEP_DEFINITIONS,
  type LightweightProtocolStepInstance,
} from '../../learning/runtime/lightweightInitialProtocol';

export { LIGHTWEIGHT_INITIAL_MATERIAL_ROLES };
export type LightweightInitialMaterialRole = SensaLightweightInitialMaterialRole;

const parsePresentation = (definition: unknown): SensaCardPresentationDefinition =>
  Object.freeze(sensaCardPresentationDefinitionSchema.parse(definition));

const slotsFor = (phase:'pre_reveal'|'post_reveal') => LIGHTWEIGHT_INITIAL_MATERIAL_ROLES.filter(key=>LIGHTWEIGHT_RESOURCE_PROFILE[key].phase===phase).map((key,displayOrder)=>{
 const profile=LIGHTWEIGHT_RESOURCE_PROFILE[key];
 return {slotId:key,displayOrder,required:profile.required,acceptedMaterialRoleKeys:[key],minItems:profile.required?1:0,maxItems:profile.maxItems,disclosurePhase:phase,missingBehavior:profile.required?'block_step':'collapse_slot',overflowBehavior:'reject'};
});
export const LIGHTWEIGHT_EXPERIENCE_RECALL_PRESENTATION = parsePresentation({
 contractVersion:sensaLearningConnectionContractVersion,presentationKey:'lightweight-experience-recall-card',presentationVersion:'v2',stepKinds:[LIGHTWEIGHT_EXPERIENCE_RECALL_STEP_KIND],slots:slotsFor('pre_reveal'),
});
export const LIGHTWEIGHT_EXPRESSION_REVEAL_PRESENTATION = parsePresentation({
 contractVersion:sensaLearningConnectionContractVersion,presentationKey:'lightweight-expression-reveal-card',presentationVersion:'v2',stepKinds:[LIGHTWEIGHT_EXPRESSION_REVEAL_STEP_KIND],slots:slotsFor('post_reveal'),
});

export const LIGHTWEIGHT_INITIAL_PRESENTATION_CONTRACTS = Object.freeze([
  LIGHTWEIGHT_EXPERIENCE_RECALL_PRESENTATION,
  LIGHTWEIGHT_EXPRESSION_REVEAL_PRESENTATION,
]);

export const validateLightweightInitialPresentationContracts = (): void => {
  const presentationIds = new Set<string>();
  for (const presentation of LIGHTWEIGHT_INITIAL_PRESENTATION_CONTRACTS) {
    const presentationId = `${presentation.presentationKey}@${presentation.presentationVersion}`;
    if (presentationIds.has(presentationId)) {
      throw new Error(`Duplicate Card Presentation contract: ${presentationId}`);
    }
    presentationIds.add(presentationId);
    for (const slot of presentation.slots) {
      for (const role of slot.acceptedMaterialRoleKeys) {
        if (!(LIGHTWEIGHT_INITIAL_MATERIAL_ROLES as readonly string[]).includes(role)) {
          throw new Error(`Presentation Slot ${slot.slotId} admits unknown role ${role}.`);
        }
      }
    }
    const declaredRoles = new Set(LIGHTWEIGHT_INITIAL_STEP_DEFINITIONS
      .filter((step) => presentation.stepKinds.includes(step.stepKind))
      .flatMap((step) => step.materialRequirements)
      .map((requirement) => requirement.materialRoleKey));
    for (const admittedRole of presentation.slots.flatMap((slot) =>
      slot.acceptedMaterialRoleKeys)) {
      if (!declaredRoles.has(admittedRole)) {
        throw new Error(
          `Card Presentation ${presentationId} admits undeclared role ${admittedRole}.`,
        );
      }
    }
  }

  const preRevealRoles = LIGHTWEIGHT_EXPERIENCE_RECALL_PRESENTATION.slots
    .flatMap((slot) => slot.acceptedMaterialRoleKeys);
  if (preRevealRoles.includes('target_expression')) {
    throw new Error('Experience Recall must not admit the target expression role before Reveal.');
  }

  for (const step of LIGHTWEIGHT_INITIAL_STEP_DEFINITIONS) {
    const presentation = LIGHTWEIGHT_INITIAL_PRESENTATION_CONTRACTS.find((candidate) =>
      candidate.presentationKey === step.presentation.presentationKey
      && candidate.presentationVersion === step.presentation.presentationVersion);
    if (!presentation || !presentation.stepKinds.includes(step.stepKind)) {
      throw new Error(
        `Step ${step.protocolStepDefinitionId} has no matching Card Presentation contract.`,
      );
    }
    const admittedRoles = new Set(presentation.slots.flatMap((slot) =>
      slot.acceptedMaterialRoleKeys));
    for (const requirement of step.materialRequirements) {
      if (!admittedRoles.has(requirement.materialRoleKey)) {
        throw new Error(
          `Step ${step.protocolStepDefinitionId} role ${requirement.materialRoleKey} has no Presentation Slot.`,
        );
      }
      const admitsWithMatchingCardinality = presentation.slots.some((slot) =>
        slot.acceptedMaterialRoleKeys.includes(requirement.materialRoleKey)
        && slot.required === requirement.required);
      if (!admitsWithMatchingCardinality) {
        throw new Error(
          `Step ${step.protocolStepDefinitionId} role ${requirement.materialRoleKey} disagrees with its Presentation Slot cardinality.`,
        );
      }
    }
  }
};

validateLightweightInitialPresentationContracts();

export interface ExperienceRecallCardPresentation {
  readonly kind: 'experience_recall';
  readonly presentationKey: 'lightweight-experience-recall-card';
  readonly presentationVersion: 'v2';
  readonly slots: {
    readonly experienceSketch: {
      readonly images?: readonly import('@sensa/contracts/sensa').SensaContextImage[];
      readonly html?: string;
      readonly scene: string;
      readonly senseFocus: string;
    };
    readonly auxiliaryCues: readonly string[];
  };
}

export interface ExpressionRevealCardPresentation {
  readonly kind: 'expression_reveal';
  readonly presentationKey: 'lightweight-expression-reveal-card';
  readonly presentationVersion: 'v2';
  readonly slots: {
    readonly supplementaryResources: readonly SensaMaterializedResource[];
    readonly expressionPrimary: { readonly surface: string };
    readonly senseConfirmation: { readonly meaning: string };
    readonly pronunciation: {
      readonly audioUrl: string | null;
      readonly phoneticNotation: string | null;
      readonly accentLabel: string | null;
    } | null;
    readonly languageStructure: {
      readonly expressionTypeLabel: string | null;
      readonly partOfSpeech: string | null;
      readonly usagePattern: string | null;
      readonly contrastNote: string | null;
    } | null;
    readonly usageExamples: readonly {
      readonly resourceKey: string;
      readonly example: string;
      readonly translation: string | null;
      readonly audioUrl: string | null;
    }[];
    readonly sceneBridge: { readonly text: string } | null;
  };
}

export type LightweightInitialCardPresentation =
  | ExperienceRecallCardPresentation
  | ExpressionRevealCardPresentation;

const requirePresentationMatch = (
  step: LightweightProtocolStepInstance,
  contract: SensaCardPresentationDefinition,
): void => {
  const reference = step.definition.presentation;
  if (
    !contract.stepKinds.includes(step.definition.stepKind)
    || reference.presentationKey !== contract.presentationKey
    || reference.presentationVersion !== contract.presentationVersion
  ) {
    throw new Error(
      `Step ${step.definition.protocolStepDefinitionId} is not bound to ${contract.presentationKey}@${contract.presentationVersion}.`,
    );
  }
};

const boundResourcesForRole = (
  step: LightweightProtocolStepInstance,
  materialization: LightweightInitialLearningMaterialization,
  role: LightweightInitialMaterialRole,
): readonly SensaMaterializedResource[] => {
  const materializationId = materialization.snapshot.learningMaterializationId;
  const bindings = step.materialBindings.filter((binding) =>
    binding.materialRoleKey === role);
  if (bindings.some((binding) => binding.learningMaterializationId !== materializationId)) {
    throw new Error(`Step ${step.protocolStepInstanceId} mixes Learning Materializations.`);
  }
  const available = new Map(lightweightMaterializedResourcesForRole(
    materialization,
    role,
  ).map((resource) => [resource.resourceKey, resource]));
  return Object.freeze(bindings.map((binding) => {
    const resource = available.get(binding.resourceKey);
    if (!resource) {
      throw new Error(
        `Step ${step.protocolStepInstanceId} binds missing resource ${binding.resourceKey}.`,
      );
    }
    return resource;
  }));
};

const requiredResourceForRole = (
  step: LightweightProtocolStepInstance,
  materialization: LightweightInitialLearningMaterialization,
  role: LightweightInitialMaterialRole,
): SensaMaterializedResource => {
  const resources = boundResourcesForRole(step, materialization, role);
  if (resources.length !== 1) {
    throw new Error(
      `Step ${step.protocolStepInstanceId} requires exactly one bound ${role} resource.`,
    );
  }
  return resources[0]!;
};

export const assembleLightweightInitialPresentation = (
  step: LightweightProtocolStepInstance,
  materialization: LightweightInitialLearningMaterialization,
): LightweightInitialCardPresentation => {
  validateLightweightInitialMaterialization(materialization);
  if (step.definition.stepKind === LIGHTWEIGHT_EXPERIENCE_RECALL_STEP_KIND) {
    requirePresentationMatch(step, LIGHTWEIGHT_EXPERIENCE_RECALL_PRESENTATION);
    const cue = sensaLightweightExperienceRecallCueSchema.parse(
      requiredResourceForRole(
        step,
        materialization,
        'experience_recall_cue',
      ).contentPayload,
    );
    const auxiliaryCues = boundResourcesForRole(step, materialization, 'recall_support')
      .map((resource) => sensaLightweightRecallSupportSchema.parse(
        resource.contentPayload,
      ).text);
    return Object.freeze({
      kind: 'experience_recall',
      presentationKey: 'lightweight-experience-recall-card',
      presentationVersion: 'v2',
      slots: Object.freeze({
        experienceSketch: Object.freeze({
          scene: cue.scene,
          images: cue.images,
          html: cue.html,
          senseFocus: cue.senseFocus,
        }),
        auxiliaryCues: Object.freeze(auxiliaryCues),
      }),
    });
  }

  if (step.definition.stepKind === LIGHTWEIGHT_EXPRESSION_REVEAL_STEP_KIND) {
    requirePresentationMatch(step, LIGHTWEIGHT_EXPRESSION_REVEAL_PRESENTATION);
    const expression = sensaLightweightTargetExpressionMaterialSchema.parse(
      requiredResourceForRole(step, materialization, 'target_expression').contentPayload,
    );
    const sense = sensaLightweightSenseConfirmationMaterialSchema.parse(
      requiredResourceForRole(step, materialization, 'sense_confirmation').contentPayload,
    );
    const pronunciationResource = boundResourcesForRole(
      step,
      materialization,
      'pronunciation',
    )[0] ?? null;
    const structureResource = boundResourcesForRole(
      step,
      materialization,
      'language_structure',
    )[0] ?? null;
    const usageResources = boundResourcesForRole(
      step,
      materialization,
      'usage_guidance',
    );
    const sceneResource = requiredResourceForRole(step, materialization, 'scene_realization');
    const scene = sensaSceneRealizationSchema.parse(sceneResource.contentPayload);
    const sceneBridgeResource = boundResourcesForRole(
      step,
      materialization,
      'scene_bridge',
    )[0] ?? null;
    const pronunciation = pronunciationResource
      ? sensaLightweightPronunciationMaterialSchema.parse(pronunciationResource.contentPayload)
      : null;
    const structure = structureResource
      ? sensaLightweightLanguageStructureMaterialSchema.parse(structureResource.contentPayload)
      : null;
    const usageExamples = [{resourceKey:sceneResource.resourceKey,...scene},...usageResources.map((resource) => ({
      resourceKey: resource.resourceKey,
      ...sensaLightweightUsageGuidanceMaterialSchema.parse(resource.contentPayload),
    }))];
    const sceneBridge = sceneBridgeResource
      ? sensaLightweightSceneBridgeMaterialSchema.parse(sceneBridgeResource.contentPayload)
      : null;
    return Object.freeze({
      kind: 'expression_reveal',
      presentationKey: 'lightweight-expression-reveal-card',
      presentationVersion: 'v2',
      slots: Object.freeze({
        supplementaryResources: Object.freeze(LIGHTWEIGHT_INITIAL_MATERIAL_ROLES.filter(key=>!['experience_recall_cue','recall_support','target_expression','sense_confirmation','pronunciation','language_structure','usage_guidance','scene_bridge','scene_realization'].includes(key) && LIGHTWEIGHT_RESOURCE_PROFILE[key].phase==='post_reveal').flatMap(key=>boundResourcesForRole(step,materialization,key))),
        expressionPrimary: Object.freeze({ surface: expression.surface }),
        senseConfirmation: Object.freeze({ meaning: sense.meaning }),
        pronunciation: pronunciation
          ? Object.freeze(pronunciation)
          : null,
        languageStructure: structure
          ? Object.freeze({
              expressionTypeLabel: structure.expressionTypeLabel,
              partOfSpeech: structure.partOfSpeech,
              usagePattern: structure.usagePattern ?? null,
              contrastNote: structure.contrastNote ?? null,
            })
          : null,
        usageExamples: Object.freeze(usageExamples.map((usage) => Object.freeze({
          resourceKey: usage.resourceKey,
          example: usage.example,
          translation: usage.translation ?? null,
          audioUrl: usage.audioUrl ?? null,
        }))),
        sceneBridge: sceneBridge
          ? Object.freeze({ text: sceneBridge.text })
          : null,
      }),
    });
  }

  throw new Error(`Unsupported Lightweight Initial step kind: ${step.definition.stepKind}`);
};
