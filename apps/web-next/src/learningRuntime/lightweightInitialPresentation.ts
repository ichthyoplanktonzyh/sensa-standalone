/**
 * Delivery contract for the two Lightweight Initial card presentations.
 *
 * Protocol Steps name material roles. These definitions decide where accepted
 * resources may appear; the producing model never chooses layout or CSS.
 */
import {
  sensaCardPresentationDefinitionSchema,
  sensaLearningConnectionContractVersion,
  type SensaCardPresentationDefinition,
} from '@sensa/contracts/sensa';
import {
  experienceGroundingForTarget,
  type PrototypeLearningTargetView,
} from '../learningJourney/prototypeLearning';
import {
  LIGHTWEIGHT_EXPERIENCE_RECALL_STEP_KIND,
  LIGHTWEIGHT_EXPRESSION_REVEAL_STEP_KIND,
  LIGHTWEIGHT_INITIAL_STEP_DEFINITIONS,
  type LightweightProtocolStepInstance,
} from './lightweightInitialProtocol';

export const LIGHTWEIGHT_INITIAL_MATERIAL_ROLES = Object.freeze([
  'experience_recall_cue',
  'recall_support',
  'target_expression',
  'sense_confirmation',
  'pronunciation',
  'language_structure',
  'usage_guidance',
  'scene_bridge',
] as const);

export type LightweightInitialMaterialRole =
  typeof LIGHTWEIGHT_INITIAL_MATERIAL_ROLES[number];

const parsePresentation = (definition: unknown): SensaCardPresentationDefinition =>
  Object.freeze(sensaCardPresentationDefinitionSchema.parse(definition));

export const LIGHTWEIGHT_EXPERIENCE_RECALL_PRESENTATION = parsePresentation({
  contractVersion: sensaLearningConnectionContractVersion,
  presentationKey: 'lightweight-experience-recall-card',
  presentationVersion: 'v1',
  stepKinds: [LIGHTWEIGHT_EXPERIENCE_RECALL_STEP_KIND],
  slots: [
    {
      slotId: 'experience_sketch',
      displayOrder: 0,
      required: true,
      acceptedMaterialRoleKeys: [
        'experience_recall_cue' satisfies LightweightInitialMaterialRole,
      ],
      minItems: 1,
      maxItems: 1,
      disclosurePhase: 'pre_reveal',
      missingBehavior: 'block_step',
      overflowBehavior: 'reject',
    },
    {
      slotId: 'auxiliary_cues',
      displayOrder: 1,
      required: false,
      acceptedMaterialRoleKeys: [
        'recall_support' satisfies LightweightInitialMaterialRole,
      ],
      minItems: 0,
      maxItems: 4,
      disclosurePhase: 'pre_reveal',
      missingBehavior: 'collapse_slot',
      overflowBehavior: 'truncate',
    },
  ],
});

export const LIGHTWEIGHT_EXPRESSION_REVEAL_PRESENTATION = parsePresentation({
  contractVersion: sensaLearningConnectionContractVersion,
  presentationKey: 'lightweight-expression-reveal-card',
  presentationVersion: 'v1',
  stepKinds: [LIGHTWEIGHT_EXPRESSION_REVEAL_STEP_KIND],
  slots: [
    {
      slotId: 'expression_primary',
      displayOrder: 0,
      required: true,
      acceptedMaterialRoleKeys: [
        'target_expression' satisfies LightweightInitialMaterialRole,
      ],
      minItems: 1,
      maxItems: 1,
      disclosurePhase: 'post_reveal',
      missingBehavior: 'block_step',
      overflowBehavior: 'reject',
    },
    {
      slotId: 'sense_confirmation',
      displayOrder: 1,
      required: true,
      acceptedMaterialRoleKeys: [
        'sense_confirmation' satisfies LightweightInitialMaterialRole,
      ],
      minItems: 1,
      maxItems: 1,
      disclosurePhase: 'post_reveal',
      missingBehavior: 'block_step',
      overflowBehavior: 'reject',
    },
    {
      slotId: 'pronunciation',
      displayOrder: 2,
      required: false,
      acceptedMaterialRoleKeys: [
        'pronunciation' satisfies LightweightInitialMaterialRole,
      ],
      minItems: 0,
      maxItems: 1,
      disclosurePhase: 'post_reveal',
      missingBehavior: 'collapse_slot',
      overflowBehavior: 'reject',
    },
    {
      slotId: 'language_structure',
      displayOrder: 3,
      required: false,
      acceptedMaterialRoleKeys: [
        'language_structure' satisfies LightweightInitialMaterialRole,
      ],
      minItems: 0,
      maxItems: 1,
      disclosurePhase: 'post_reveal',
      missingBehavior: 'collapse_slot',
      overflowBehavior: 'reject',
    },
    {
      slotId: 'usage_guidance',
      displayOrder: 4,
      required: false,
      acceptedMaterialRoleKeys: [
        'usage_guidance' satisfies LightweightInitialMaterialRole,
      ],
      minItems: 0,
      maxItems: 1,
      disclosurePhase: 'post_reveal',
      missingBehavior: 'collapse_slot',
      overflowBehavior: 'reject',
    },
    {
      slotId: 'scene_bridge',
      displayOrder: 5,
      required: false,
      acceptedMaterialRoleKeys: [
        'scene_bridge' satisfies LightweightInitialMaterialRole,
      ],
      minItems: 0,
      maxItems: 1,
      disclosurePhase: 'post_reveal',
      missingBehavior: 'collapse_slot',
      overflowBehavior: 'reject',
    },
  ],
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
  readonly presentationVersion: 'v1';
  readonly slots: {
    readonly experienceSketch: {
      readonly scene: string;
      readonly senseFocus: string;
    };
    readonly auxiliaryCues: readonly string[];
  };
}

export interface ExpressionRevealCardPresentation {
  readonly kind: 'expression_reveal';
  readonly presentationKey: 'lightweight-expression-reveal-card';
  readonly presentationVersion: 'v1';
  readonly slots: {
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
    } | null;
    readonly usageGuidance: { readonly example: string } | null;
    readonly sceneBridge: { readonly text: string } | null;
  };
}

export type LightweightInitialCardPresentation =
  | ExperienceRecallCardPresentation
  | ExpressionRevealCardPresentation;

const containsExpression = (text: string, expression: string): boolean => {
  const normalize = (value: string): string => value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase();
  const normalizedExpression = normalize(expression);
  return normalizedExpression.length > 0 && normalize(text).includes(normalizedExpression);
};

const assertNoTargetExpressionDisclosure = (
  target: PrototypeLearningTargetView,
  values: readonly string[],
): void => {
  if (values.some((value) => containsExpression(value, target.expression))) {
    throw new Error(
      `Experience Recall material for ${target.targetId} discloses the target expression.`,
    );
  }
};

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

export const assembleLightweightInitialPresentation = (
  step: LightweightProtocolStepInstance,
  target: PrototypeLearningTargetView,
): LightweightInitialCardPresentation => {
  if (step.definition.stepKind === LIGHTWEIGHT_EXPERIENCE_RECALL_STEP_KIND) {
    requirePresentationMatch(step, LIGHTWEIGHT_EXPERIENCE_RECALL_PRESENTATION);
    const grounding = experienceGroundingForTarget(target);
    assertNoTargetExpressionDisclosure(target, [
      grounding.scene,
      grounding.focus,
      ...grounding.featureLabels,
    ]);
    return Object.freeze({
      kind: 'experience_recall',
      presentationKey: 'lightweight-experience-recall-card',
      presentationVersion: 'v1',
      slots: Object.freeze({
        experienceSketch: Object.freeze({
          scene: grounding.scene,
          senseFocus: grounding.focus,
        }),
        auxiliaryCues: Object.freeze([...grounding.featureLabels].slice(0, 4)),
      }),
    });
  }

  if (step.definition.stepKind === LIGHTWEIGHT_EXPRESSION_REVEAL_STEP_KIND) {
    requirePresentationMatch(step, LIGHTWEIGHT_EXPRESSION_REVEAL_PRESENTATION);
    const expressionTypeLabel = target.expressionTypeLabel.trim() || null;
    const partOfSpeech = target.partOfSpeech.trim() || null;
    return Object.freeze({
      kind: 'expression_reveal',
      presentationKey: 'lightweight-expression-reveal-card',
      presentationVersion: 'v1',
      slots: Object.freeze({
        expressionPrimary: Object.freeze({ surface: target.expression }),
        senseConfirmation: Object.freeze({ meaning: target.meaning }),
        pronunciation: null,
        languageStructure: expressionTypeLabel || partOfSpeech
          ? Object.freeze({ expressionTypeLabel, partOfSpeech })
          : null,
        usageGuidance: target.example.trim()
          ? Object.freeze({ example: target.example })
          : null,
        sceneBridge: null,
      }),
    });
  }

  throw new Error(`Unsupported Lightweight Initial step kind: ${step.definition.stepKind}`);
};
