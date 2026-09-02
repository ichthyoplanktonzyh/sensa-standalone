import type {
  SensaAuthoringAssetProvenance,
  SensaAuthoringLearningExample,
  SensaAuthoringReview,
  SensaGoldenContentBundle,
} from '@sensa/contracts/sensa';

const dictionarySourceKey = 'wiktionary.fragile.2026-08-21';
const editorialSourceKey = 'sensa.editorial.fragile-physical.v1';
const imageSourceKey = 'sensa.generated.fragile-physical-image.v1';
const imageMediaKey = 'fragile.experience.image.physical-care.v1';

const draftReview: SensaAuthoringReview = {
  status: 'draft',
  reviewedBy: null,
  reviewedAt: null,
  note: 'Awaiting product-owner content review.',
};

const dictionaryProvenance: SensaAuthoringAssetProvenance = {
  sourceRefs: [dictionarySourceKey],
  generator: null,
  review: draftReview,
};

const editorialProvenance: SensaAuthoringAssetProvenance = {
  sourceRefs: [dictionarySourceKey, editorialSourceKey],
  generator: {
    provider: 'OpenAI',
    model: 'gpt-5.6-sol',
    promptVersion: 'sensa-golden-fragile-physical-v1',
  },
  review: draftReview,
};

const imageProvenance: SensaAuthoringAssetProvenance = {
  sourceRefs: [dictionarySourceKey, editorialSourceKey, imageSourceKey],
  generator: {
    provider: 'OpenAI',
    model: 'undisclosed-built-in-image-model',
    promptVersion: 'sensa-fragile-experience-image-v1',
  },
  review: draftReview,
};

type ExampleInput = Omit<SensaAuthoringLearningExample, 'target' | 'renders' | 'provenance'> & {
  provenance?: SensaAuthoringAssetProvenance;
};

function example(input: ExampleInput): SensaAuthoringLearningExample {
  const surface = 'fragile';
  const start = input.textL2.indexOf(surface);
  if (start < 0) {
    throw new Error(`Example ${input.exampleKey} does not contain the target surface.`);
  }

  return {
    ...input,
    target: {
      surface,
      start,
      end: start + surface.length,
    },
    renders: [{
      kind: 'text',
      renderKey: `${input.exampleKey}.render.text`,
    }],
    provenance: input.provenance ?? editorialProvenance,
  };
}

/**
 * The first real authoring tracer for the Sensa prototype.
 *
 * Dictionary facts are pinned to the local Wiktionary evidence snapshot.
 * Teaching material is intentionally a draft: it is structurally valid and
 * previewable, but it cannot be released until a human review is recorded.
 */
export const fragileGoldenBundle: SensaGoldenContentBundle = {
  schemaVersion: 'sensa-golden-content-bundle-v1',
  release: {
    releaseKey: 'sensa.prototype.fragile-physical',
    version: 1,
    targetLanguage: 'en',
    learnerLocale: 'zh-CN',
    deliveryProfileVersion: 'sensa-web-prototype-acquisition-v1',
    status: 'draft',
  },
  sources: [
    {
      sourceKey: dictionarySourceKey,
      kind: 'dictionary',
      title: 'Wiktionary fragile entry snapshot',
      provider: 'wiktionary',
      locator: 'fragile-dict-002',
      sourceLicense: null,
      sourceAttribution: null,
      capturedAt: '2026-08-21T00:25:10Z',
      evidenceDigest: 'sha256:5cbb0d94b7fa51ce1c0f2309a7567a30b8a402d3f77dbc90a8d0ced9278dd227',
    },
    {
      sourceKey: editorialSourceKey,
      kind: 'editorial',
      title: 'Sensa editorial draft for the physical fragile Sense',
      provider: 'Sensa',
      locator: null,
      sourceLicense: null,
      sourceAttribution: null,
      capturedAt: null,
      evidenceDigest: null,
    },
    {
      sourceKey: imageSourceKey,
      kind: 'generated',
      title: 'Sensa generated Experience image for the physical fragile Sense',
      provider: 'OpenAI built-in image generation',
      locator: 'imagegen-prompt:sensa-fragile-experience-image-v1',
      sourceLicense: null,
      sourceAttribution: null,
      capturedAt: '2026-08-28T03:32:56Z',
      evidenceDigest: 'sha256:6c01e716cf19e50510500354ebbca99671df4f37f077d3e09ce721a7f995752b',
    },
  ],
  media: [
    {
      mediaKey: imageMediaKey,
      kind: 'image',
      uri: 'content://sha256/6c01e716cf19e50510500354ebbca99671df4f37f077d3e09ce721a7f995752b',
      mimeType: 'image/png',
      sha256: 'sha256:6c01e716cf19e50510500354ebbca99671df4f37f077d3e09ce721a7f995752b',
      sourceTextDigest: null,
      provenance: imageProvenance,
    },
  ],
  lexemes: [
    {
      lexemeKey: 'fragile',
      version: 1,
      languageTag: 'en',
      lemma: 'fragile',
      forms: ['fragile'],
      syllables: 'frag·ile',
      pronunciations: [
        {
          pronunciationKey: 'fragile.en-us',
          accentLocale: 'en-US',
          ipa: '/ˈfrædʒəl/',
          mediaKey: null,
        },
      ],
      provenance: dictionaryProvenance,
    },
  ],
  relations: [],
  packages: [
    {
      schemaVersion: 'sensa-sense-package-definition-v1',
      identity: {
        packageKey: 'fragile.adj.physical-easily-broken',
        packageVersion: 1,
        senseKey: 'fragile.adj.physical-easily-broken',
        senseVersion: 1,
        lexemeKey: 'fragile',
        lexemeVersion: 1,
        targetLanguage: 'en',
        learnerLocale: 'zh-CN',
      },
      sense: {
        partOfSpeech: 'adj.',
        senseRank: 1,
        guideLabelL1: '易碎的',
        definitionL2: 'Easily broken, not sturdy; of delicate material.',
        teachingPriority: 'core',
        coreFeatures: [
          'Describes a physical object or material.',
          'A relatively small force can break or damage it.',
          'It requires careful handling because it lacks sturdiness.',
        ],
      },
      acquisitionProfile: {
        profileKey: 'fragile.physical.acquisition.v1',
        acquisitionNeeds: ['perceptual_grounding', 'form_binding'],
        minimumSufficientExperience: 'The learner anticipates damage from a small impact and responds by handling the object carefully.',
        distinguishingFeatures: [
          'The referent is physical rather than an abstract situation.',
          'The likely change is breakage, tearing, or material damage.',
          'The risk exists even under modest force or careless handling.',
        ],
        preferredPrimitives: ['causal_sequence'],
        fallbackPrimitives: ['visual_grounding'],
        requiredCapabilities: [
          { kind: 'contextual_recognition' },
          { kind: 'meaning_to_form_recall', gradingContract: 'lexeme_identity_v1' },
          { kind: 'novel_context_transfer' },
        ],
        optionalCapabilities: [],
        requiredAssetCapabilities: [
          'meaning_grounding',
          'l1_mediation',
          'contextual_variation',
        ],
        optionalAssetCapabilities: [
          'usage_pattern',
          'visual_grounding',
          'causal_grounding',
        ],
        domainBound: false,
        domainConstraints: [],
        boundaryTargets: [],
        provenance: editorialProvenance,
      },
      experience: {
        sketch: {
          sketchKey: 'fragile.experience.sketch.physical.v1',
          experienceGoal: 'Make the learner anticipate damage before any definition or target form is shown.',
          focalStructure: [
            'A thin glass cup is held in two hands.',
            'A light bump against a table edge could crack it.',
            'The holder slows down and uses extra care.',
          ],
          learnerInference: 'This object can be damaged by a small force, so it must be handled carefully.',
          constraints: {
            mustConvey: [
              'physical vulnerability',
              'low force threshold',
              'need for careful handling',
            ],
            mustAvoid: [
              'general weakness with no physical damage',
              'an already broken object',
              'an abstract relationship or political situation',
            ],
            hideTargetForms: true,
          },
          provenance: editorialProvenance,
        },
        renders: [
          {
            kind: 'text',
            renderKey: 'fragile.experience.render.text.v1',
            primitive: 'causal_sequence',
            supportedDeliveryProfiles: ['sensa-web-prototype-acquisition-v1'],
            sceneL1: '想象你双手捧着一只很薄的玻璃杯。只要轻轻碰到桌角，它就可能裂开，所以你放下它时格外小心。',
            provenance: editorialProvenance,
          },
          {
            kind: 'image',
            renderKey: 'fragile.experience.render.image.v1',
            primitive: 'visual_grounding',
            supportedDeliveryProfiles: ['sensa-web-prototype-acquisition-v1'],
            mediaKey: imageMediaKey,
            altTextL1: '两只手用指尖和掌心小心托住一只很薄的透明玻璃杯，正把它轻轻放到折叠软布上。',
            provenance: imageProvenance,
          },
          {
            kind: 'sequence',
            renderKey: 'fragile.experience.render.causal-sequence.v1',
            primitive: 'causal_sequence',
            supportedDeliveryProfiles: ['sensa-web-prototype-acquisition-v1'],
            sequenceKind: 'causal',
            steps: [
              {
                label: '完好',
                description: '一只薄玻璃杯外观完整，但材质和结构经不起明显冲击。',
              },
              {
                label: '轻微碰撞',
                description: '杯沿不小心碰到桌角，施加的力量并不大。',
              },
              {
                label: '出现裂纹',
                description: '碰撞处迅速产生裂纹，杯子可能继续破裂。',
              },
              {
                label: '小心处理',
                description: '拿取和放置时都要减慢动作，并避开碰撞。',
              },
            ],
            provenance: editorialProvenance,
          },
          {
            kind: 'interaction',
            renderKey: 'fragile.experience.render.interaction.v1',
            primitive: 'causal_sequence',
            supportedDeliveryProfiles: ['sensa-web-prototype-acquisition-v1'],
            rendererKey: 'state_change_v1',
            payload: {
              instructionL1: '缓慢拖动“碰撞力度”，观察薄玻璃杯从完好到受损的变化。',
              subject: {
                kind: 'thin_glass_cup',
                initialState: 'intact',
              },
              control: {
                kind: 'slider',
                valueKey: 'impactForce',
                minimum: 0,
                maximum: 3,
                step: 1,
                labelsL1: ['没有碰撞', '轻碰', '普通碰撞', '较强碰撞'],
              },
              states: [
                {
                  value: 0,
                  state: 'intact',
                  feedbackL1: '杯子保持完好。',
                },
                {
                  value: 1,
                  state: 'hairline_crack',
                  feedbackL1: '只是轻轻一碰，杯壁已经出现细小裂纹。',
                },
                {
                  value: 2,
                  state: 'cracked',
                  feedbackL1: '裂纹继续扩展，杯子无法再安全使用。',
                },
                {
                  value: 3,
                  state: 'broken',
                  feedbackL1: '碰撞越强，损坏越明显。',
                },
              ],
              resetLabelL1: '重新体验',
              accessibility: {
                keyboardStep: 1,
                summaryL1: '这个杯子在很低的碰撞力度下就会受损。',
              },
            },
            provenance: editorialProvenance,
          },
        ],
        renderPlan: {
          strategyVersion: 'sensa-experience-render-plan-v1',
          selections: [
            {
              renderKey: 'fragile.experience.render.interaction.v1',
              role: 'preferred',
              rank: 1,
              reason: 'Direct manipulation makes the unusually low damage threshold perceptible instead of merely stated.',
            },
            {
              renderKey: 'fragile.experience.render.causal-sequence.v1',
              role: 'alternative',
              rank: 1,
              reason: 'Preserves the low-force-to-damage causal structure without requiring an interactive renderer.',
            },
            {
              renderKey: 'fragile.experience.render.image.v1',
              role: 'alternative',
              rank: 2,
              reason: 'Visually grounds thin material and careful handling when causal motion is unavailable.',
            },
            {
              renderKey: 'fragile.experience.render.text.v1',
              role: 'fallback',
              rank: 1,
              reason: 'Provides the complete causal experience on every text-capable client and for accessibility fallback.',
            },
          ],
        },
      },
      l1Bridge: {
        assetKey: 'fragile.bridge.zh.v1',
        bodyL1: '这种“受到不大的外力就容易破损、需要小心对待”的状态，就是 fragile 在这里表达的意思。',
        provenance: editorialProvenance,
      },
      examples: [
        example({
          exampleKey: 'fragile.example.study.vase.v1',
          textL2: 'She caught the fragile vase before it could shatter on the floor.',
          textL1: '花瓶落地摔碎前，她接住了这只易碎的花瓶。',
          scenarioFamily: 'household-object',
          construction: 'fragile + concrete noun',
          roles: ['study_binding', 'retrieval_repair', 'free_practice'],
          visibility: 'learning_only',
          provenance: dictionaryProvenance,
        }),
        example({
          exampleKey: 'fragile.example.study.glass.v1',
          textL2: 'The fragile glass was wrapped in soft cloth before the journey.',
          textL1: '出发前，这件易碎的玻璃制品被柔软的布包了起来。',
          scenarioFamily: 'household-object',
          construction: 'fragile + concrete noun',
          roles: ['retrieval_repair', 'free_practice'],
          visibility: 'learning_only',
        }),
        example({
          exampleKey: 'fragile.example.study.material.v1',
          textL2: 'This fragile material can crack under very little pressure.',
          textL1: '这种易碎材料受到很小的压力就可能开裂。',
          scenarioFamily: 'manufactured-material',
          construction: 'fragile + concrete noun',
          roles: ['retrieval_repair', 'free_practice'],
          visibility: 'learning_only',
        }),
        example({
          exampleKey: 'fragile.example.recognition.glass-panel.v1',
          textL2: 'The movers placed each fragile glass panel in a padded frame.',
          textL1: '搬运工把每块易碎的玻璃板都放进了带衬垫的框架中。',
          scenarioFamily: 'building-material',
          construction: 'fragile + concrete noun',
          roles: ['recognition_assessment'],
          visibility: 'assessment_only',
        }),
        example({
          exampleKey: 'fragile.example.transfer.bone.v1',
          textL2: 'The archaeologist uncovered the fragile bones with a small brush.',
          textL1: '考古学家用一把小刷子清理出那些易碎的骨骼。',
          scenarioFamily: 'archaeological-remains',
          construction: 'fragile + concrete noun',
          roles: ['transfer_assessment'],
          visibility: 'assessment_only',
        }),
        example({
          exampleKey: 'fragile.example.transfer.coral.v1',
          textL2: 'New coral growth is fragile and can be damaged by a careless touch.',
          textL1: '新生的珊瑚很脆弱，随手一碰就可能受损。',
          scenarioFamily: 'living-material',
          construction: 'subject + be + fragile',
          roles: ['transfer_assessment'],
          visibility: 'assessment_only',
        }),
        example({
          exampleKey: 'fragile.example.transfer.solar-cell.v1',
          textL2: 'The thin solar cells are fragile during installation.',
          textL1: '这些薄型太阳能电池在安装时很容易破损。',
          scenarioFamily: 'manufactured-component',
          construction: 'subject + be + fragile',
          roles: ['transfer_assessment'],
          visibility: 'assessment_only',
        }),
        example({
          exampleKey: 'fragile.example.transfer.fabric.v1',
          textL2: 'After years in the attic, the fragile fabric tore along the fold.',
          textL1: '在阁楼放了多年后，那块易损的布料沿折痕裂开了。',
          scenarioFamily: 'aged-material',
          construction: 'fragile + concrete noun',
          roles: ['transfer_assessment'],
          visibility: 'assessment_only',
        }),
        example({
          exampleKey: 'fragile.example.transfer.sensor.v1',
          textL2: 'Technicians placed the fragile sensor inside a shock-resistant case.',
          textL1: '技术人员把易损的传感器放进了防震外壳。',
          scenarioFamily: 'precision-equipment',
          construction: 'fragile + concrete noun',
          roles: ['transfer_assessment'],
          visibility: 'assessment_only',
        }),
      ],
      usagePatterns: [
        {
          patternKey: 'fragile.pattern.concrete-noun.v1',
          canonicalPattern: 'fragile + concrete noun',
          commonCollocations: ['fragile vase', 'fragile glass', 'fragile material'],
          registerLabel: 'neutral',
          domainLabel: 'physical objects and materials',
          usageRestriction: '这里只学习描述实体物品容易破损的义项，不包含局势、关系或情绪等抽象的“脆弱”。',
          provenance: editorialProvenance,
        },
      ],
      practiceManifest: {
        profileVersion: 'sensa-initial-free-practice-v1',
        grants: [
          {
            taskFamily: 'immersive_browse',
            resourceKeys: [
              'fragile.experience.render.text.v1',
              'fragile.experience.render.image.v1',
              'fragile.experience.render.causal-sequence.v1',
              'fragile.experience.render.interaction.v1',
              'fragile.bridge.zh.v1',
              'fragile.example.study.vase.v1',
            ],
          },
          {
            taskFamily: 'quick_spelling',
            resourceKeys: ['fragile.bridge.zh.v1'],
          },
        ],
      },
      provenance: editorialProvenance,
    },
  ],
};
