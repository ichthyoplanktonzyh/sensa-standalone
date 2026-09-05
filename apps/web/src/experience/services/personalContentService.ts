import { previewStorage } from './previewStorage';
type PersonalContentListener = () => void;

interface PersonalContentState {
  savedSenseIds: string[];
  savedExampleIds: string[];
  semanticAnchors: PersonalSemanticAnchor[];
  semanticRegions: PersonalSemanticRegion[];
  personalMeanings: PersonalMeaning[];
}

export interface PersonalSemanticAnchor {
  anchorId: string;
  senseId: string;
  body: string;
  media: PersonalSemanticAnchorMedia[];
  createdAt: number;
  updatedAt: number;
}

export interface PersonalSemanticAnchorMedia {
  mediaId: string;
  kind: 'image';
  dataUrl: string;
  mimeType: string;
  fileName: string;
  altText: string;
}

export interface PersonalSemanticRegion {
  regionId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export type PersonalMeaningExpressionType =
  | 'word'
  | 'phrase'
  | 'construction'
  | 'sentence'
  | 'utterance_strategy';

export interface PersonalMeaningExpressionAnchor {
  personalExpressionAnchorId: string;
  languageTag: 'zh-CN';
  expressionType: PersonalMeaningExpressionType;
  learnerLanguageRole: 'familiar';
  surfaceForm: string;
  provenance: 'learner_authored';
  /** Mock revision; bumps on edit while the anchor id stays stable. */
  revision: number;
}

export interface PersonalMeaningExperienceAnchor {
  personalSemanticAnchorId: string;
  anchorKind: 'scene';
  bodyText: string;
  provenance: 'learner_authored';
  /** Mock revision; bumps on edit while the anchor id stays stable. */
  revision: number;
}

export interface PersonalMeaning {
  personalMeaningId: string;
  currentRevision: number;
  status: 'active';
  familiarExpressionAnchors: PersonalMeaningExpressionAnchor[];
  semanticAnchors: PersonalMeaningExperienceAnchor[];
  /** Compatibility-only organization from the earlier region prototype. */
  prototypeRegionId: string | null;
  /** Preserved legacy L2 pins; they are not Personal Meaning creation inputs. */
  legacyTargetExpressionCandidates: Array<{
    legacyPinId: string;
    surfaceForm: string;
  }>;
  createdAt: number;
  updatedAt: number;
}

interface LegacyCandidateExpressionPin {
  pinId: string;
  kind: 'word';
  formL2: string;
  alignmentStatus: 'unlinked';
  provenance: 'learner-authored';
}

interface LegacyPersonalMeaningDraft {
  draftId: string;
  regionId: string | null;
  l1Expression: string;
  experienceL1: string;
  expressionPins: LegacyCandidateExpressionPin[];
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = 'sensa_personal_content_prototype_v1';

const EMPTY_STATE: PersonalContentState = {
  savedSenseIds: [],
  savedExampleIds: [],
  semanticAnchors: [],
  semanticRegions: [],
  personalMeanings: [],
};

const uniqueStrings = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0))
  );
};

const semanticAnchors = (value: unknown): PersonalSemanticAnchor[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const anchor = candidate as Partial<PersonalSemanticAnchor>;
    if (
      typeof anchor.anchorId !== 'string'
      || typeof anchor.senseId !== 'string'
      || typeof anchor.body !== 'string'
      || typeof anchor.createdAt !== 'number'
      || typeof anchor.updatedAt !== 'number'
      || !anchor.anchorId
      || !anchor.senseId
    ) {
      return [];
    }
    const media = Array.isArray(anchor.media)
      ? anchor.media.flatMap((item) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
          const candidate = item as Partial<PersonalSemanticAnchorMedia>;
          if (
            typeof candidate.mediaId !== 'string'
            || candidate.kind !== 'image'
            || typeof candidate.dataUrl !== 'string'
            || !candidate.dataUrl.startsWith('data:image/')
            || typeof candidate.mimeType !== 'string'
            || typeof candidate.fileName !== 'string'
          ) {
            return [];
          }
          return [{
            mediaId: candidate.mediaId,
            kind: 'image' as const,
            dataUrl: candidate.dataUrl,
            mimeType: candidate.mimeType,
            fileName: candidate.fileName,
            altText: typeof candidate.altText === 'string' ? candidate.altText : '',
          }];
        })
      : [];
    if (!anchor.body.trim() && media.length === 0) return [];
    return [{
      anchorId: anchor.anchorId,
      senseId: anchor.senseId,
      body: anchor.body.trim(),
      media,
      createdAt: anchor.createdAt,
      updatedAt: anchor.updatedAt,
    }];
  });
};

const semanticRegions = (value: unknown): PersonalSemanticRegion[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const region = candidate as Partial<PersonalSemanticRegion>;
    if (
      typeof region.regionId !== 'string'
      || typeof region.name !== 'string'
      || typeof region.createdAt !== 'number'
      || typeof region.updatedAt !== 'number'
      || !region.regionId
      || !region.name.trim()
    ) {
      return [];
    }
    return [{ ...region, name: region.name.trim() } as PersonalSemanticRegion];
  });
};

const legacyMeaningDrafts = (value: unknown): LegacyPersonalMeaningDraft[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const draft = candidate as Partial<LegacyPersonalMeaningDraft>;
    if (
      typeof draft.draftId !== 'string'
      || typeof draft.l1Expression !== 'string'
      || typeof draft.experienceL1 !== 'string'
      || typeof draft.createdAt !== 'number'
      || typeof draft.updatedAt !== 'number'
      || !draft.draftId
    ) {
      return [];
    }
    const expressionPins = Array.isArray(draft.expressionPins)
      ? draft.expressionPins.flatMap((item) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
          const pin = item as Partial<LegacyCandidateExpressionPin>;
          if (
            typeof pin.pinId !== 'string'
            || pin.kind !== 'word'
            || typeof pin.formL2 !== 'string'
            || !pin.pinId
            || !pin.formL2.trim()
          ) {
            return [];
          }
          return [{
            pinId: pin.pinId,
            kind: 'word' as const,
            formL2: pin.formL2.trim(),
            alignmentStatus: 'unlinked' as const,
            provenance: 'learner-authored' as const,
          }];
        })
      : [];
    const l1Expression = draft.l1Expression.trim();
    const experienceL1 = draft.experienceL1.trim();
    if ((!l1Expression && !experienceL1) || expressionPins.length === 0) return [];
    return [{
      draftId: draft.draftId,
      regionId: typeof draft.regionId === 'string' && draft.regionId ? draft.regionId : null,
      l1Expression,
      experienceL1,
      expressionPins,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
    }];
  });
};

const expressionTypes = new Set<PersonalMeaningExpressionType>([
  'word',
  'phrase',
  'construction',
  'sentence',
  'utterance_strategy',
]);

const personalMeanings = (value: unknown): PersonalMeaning[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const meaning = candidate as Partial<PersonalMeaning>;
    if (
      typeof meaning.personalMeaningId !== 'string'
      || !meaning.personalMeaningId
      || typeof meaning.currentRevision !== 'number'
      || meaning.currentRevision < 1
      || meaning.status !== 'active'
      || typeof meaning.createdAt !== 'number'
      || typeof meaning.updatedAt !== 'number'
    ) {
      return [];
    }

    const familiarExpressionAnchors = Array.isArray(meaning.familiarExpressionAnchors)
      ? meaning.familiarExpressionAnchors.flatMap((item) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
          const anchor = item as Partial<PersonalMeaningExpressionAnchor>;
          if (
            typeof anchor.personalExpressionAnchorId !== 'string'
            || !anchor.personalExpressionAnchorId
            || anchor.languageTag !== 'zh-CN'
            || typeof anchor.expressionType !== 'string'
            || !expressionTypes.has(anchor.expressionType as PersonalMeaningExpressionType)
            || anchor.learnerLanguageRole !== 'familiar'
            || typeof anchor.surfaceForm !== 'string'
            || !anchor.surfaceForm.trim()
          ) {
            return [];
          }
          return [{
            personalExpressionAnchorId: anchor.personalExpressionAnchorId,
            languageTag: 'zh-CN' as const,
            expressionType: anchor.expressionType as PersonalMeaningExpressionType,
            learnerLanguageRole: 'familiar' as const,
            surfaceForm: anchor.surfaceForm.trim(),
            provenance: 'learner_authored' as const,
            revision: typeof anchor.revision === 'number' && anchor.revision >= 1
              ? anchor.revision
              : 1,
          }];
        })
      : [];

    const semanticAnchorItems = Array.isArray(meaning.semanticAnchors)
      ? meaning.semanticAnchors.flatMap((item) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
          const anchor = item as Partial<PersonalMeaningExperienceAnchor>;
          if (
            typeof anchor.personalSemanticAnchorId !== 'string'
            || !anchor.personalSemanticAnchorId
            || anchor.anchorKind !== 'scene'
            || typeof anchor.bodyText !== 'string'
            || !anchor.bodyText.trim()
          ) {
            return [];
          }
          return [{
            personalSemanticAnchorId: anchor.personalSemanticAnchorId,
            anchorKind: 'scene' as const,
            bodyText: anchor.bodyText.trim(),
            provenance: 'learner_authored' as const,
            revision: typeof anchor.revision === 'number' && anchor.revision >= 1
              ? anchor.revision
              : 1,
          }];
        })
      : [];

    if (familiarExpressionAnchors.length === 0 && semanticAnchorItems.length === 0) return [];
    const legacyTargetExpressionCandidates = Array.isArray(meaning.legacyTargetExpressionCandidates)
      ? meaning.legacyTargetExpressionCandidates.flatMap((item) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
          const candidate = item as { legacyPinId?: unknown; surfaceForm?: unknown };
          if (
            typeof candidate.legacyPinId !== 'string'
            || !candidate.legacyPinId
            || typeof candidate.surfaceForm !== 'string'
            || !candidate.surfaceForm.trim()
          ) {
            return [];
          }
          return [{
            legacyPinId: candidate.legacyPinId,
            surfaceForm: candidate.surfaceForm.trim(),
          }];
        })
      : [];
    return [{
      personalMeaningId: meaning.personalMeaningId,
      currentRevision: meaning.currentRevision,
      status: 'active' as const,
      familiarExpressionAnchors,
      semanticAnchors: semanticAnchorItems,
      prototypeRegionId: typeof meaning.prototypeRegionId === 'string' && meaning.prototypeRegionId
        ? meaning.prototypeRegionId
        : null,
      legacyTargetExpressionCandidates,
      createdAt: meaning.createdAt,
      updatedAt: meaning.updatedAt,
    }];
  });
};

const migrateLegacyMeaningDrafts = (value: unknown): PersonalMeaning[] => (
  legacyMeaningDrafts(value).map((draft) => ({
    personalMeaningId: draft.draftId,
    currentRevision: 1,
    status: 'active',
    familiarExpressionAnchors: draft.l1Expression
      ? [{
          personalExpressionAnchorId: createPersonalId('personal_expression_anchor'),
          languageTag: 'zh-CN',
          expressionType: 'phrase',
          learnerLanguageRole: 'familiar',
          surfaceForm: draft.l1Expression,
          provenance: 'learner_authored',
          revision: 1,
        }]
      : [],
    semanticAnchors: draft.experienceL1
      ? [{
          personalSemanticAnchorId: createPersonalId('personal_semantic_anchor'),
          anchorKind: 'scene',
          bodyText: draft.experienceL1,
          provenance: 'learner_authored',
          revision: 1,
        }]
      : [],
    prototypeRegionId: draft.regionId,
    legacyTargetExpressionCandidates: draft.expressionPins.map((pin) => ({
      legacyPinId: pin.pinId,
      surfaceForm: pin.formL2,
    })),
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  }))
);

const createPersonalId = (prefix: string): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

/**
 * Local-only prototype store for learner-owned references, semantic anchors,
 * personal regions and stable Personal Meanings.
 *
 * This deliberately owns no progress, curriculum or memory state. Production
 * writes still require the server schema, sync operation and local outbox
 * contracts described by the Sensa domain model.
 */
class PersonalContentService {
  private state: PersonalContentState = EMPTY_STATE;
  private loaded = false;
  private listeners = new Set<PersonalContentListener>();

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;

    try {
      const raw = typeof window !== 'undefined' ? previewStorage.getItem(STORAGE_KEY) : null;
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<PersonalContentState> & {
        meaningDrafts?: unknown;
      };
      const storedPersonalMeanings = personalMeanings(parsed.personalMeanings);
      this.state = {
        savedSenseIds: uniqueStrings(parsed.savedSenseIds),
        savedExampleIds: uniqueStrings(parsed.savedExampleIds),
        semanticAnchors: semanticAnchors(parsed.semanticAnchors),
        semanticRegions: semanticRegions(parsed.semanticRegions),
        personalMeanings: storedPersonalMeanings.length > 0
          ? storedPersonalMeanings
          : migrateLegacyMeaningDrafts(parsed.meaningDrafts),
      };
    } catch {
      this.state = EMPTY_STATE;
    }
  }

  private persist(): void {
    try {
      if (typeof window !== 'undefined') {
        previewStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      }
    } catch {
      // The interactive prototype remains usable when storage is unavailable.
    }
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }

  public subscribe(listener: PersonalContentListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public getSavedSenseIds(): Set<string> {
    this.load();
    return new Set(this.state.savedSenseIds);
  }

  public getSavedExampleIds(): Set<string> {
    this.load();
    return new Set(this.state.savedExampleIds);
  }

  public getSemanticAnchors(senseId: string): PersonalSemanticAnchor[] {
    this.load();
    return this.state.semanticAnchors
      .filter((anchor) => anchor.senseId === senseId)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((anchor) => ({
        ...anchor,
        media: anchor.media.map((item) => ({ ...item })),
      }));
  }

  public getSemanticAnchor(anchorId: string): PersonalSemanticAnchor | null {
    this.load();
    const anchor = this.state.semanticAnchors.find((candidate) => candidate.anchorId === anchorId);
    return anchor
      ? { ...anchor, media: anchor.media.map((item) => ({ ...item })) }
      : null;
  }

  public getSemanticRegions(): PersonalSemanticRegion[] {
    this.load();
    return this.state.semanticRegions
      .slice()
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((region) => ({ ...region }));
  }

  public getPersonalMeanings(): PersonalMeaning[] {
    this.load();
    return this.state.personalMeanings
      .slice()
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((meaning) => ({
        ...meaning,
        familiarExpressionAnchors: meaning.familiarExpressionAnchors.map((anchor) => ({ ...anchor })),
        semanticAnchors: meaning.semanticAnchors.map((anchor) => ({ ...anchor })),
        legacyTargetExpressionCandidates: meaning.legacyTargetExpressionCandidates.map(
          (candidate) => ({ ...candidate }),
        ),
      }));
  }

  public isSenseSaved(senseId: string): boolean {
    return this.getSavedSenseIds().has(senseId);
  }

  public isExampleSaved(exampleId: string): boolean {
    return this.getSavedExampleIds().has(exampleId);
  }

  public toggleSense(senseId: string): boolean {
    const next = this.getSavedSenseIds();
    const saved = !next.has(senseId);
    if (saved) next.add(senseId);
    else next.delete(senseId);
    this.state = { ...this.state, savedSenseIds: Array.from(next) };
    this.persist();
    this.notify();
    return saved;
  }

  public toggleExample(exampleId: string): boolean {
    const next = this.getSavedExampleIds();
    const saved = !next.has(exampleId);
    if (saved) next.add(exampleId);
    else next.delete(exampleId);
    this.state = { ...this.state, savedExampleIds: Array.from(next) };
    this.persist();
    this.notify();
    return saved;
  }

  public saveSemanticAnchor(input: {
    senseId: string;
    body: string;
    anchorId?: string;
    media?: PersonalSemanticAnchorMedia[];
  }): PersonalSemanticAnchor {
    this.load();
    const body = input.body.trim();
    const media = (input.media ?? []).map((item) => ({ ...item }));
    if (!body && media.length === 0) {
      throw new Error('A personal semantic anchor cannot be empty.');
    }

    const now = Date.now();
    const existing = input.anchorId
      ? this.state.semanticAnchors.find((anchor) => anchor.anchorId === input.anchorId)
      : undefined;
    const anchor: PersonalSemanticAnchor = {
      anchorId: existing?.anchorId ?? createPersonalId('anchor'),
      senseId: input.senseId,
      body,
      media,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const semanticAnchors = existing
      ? this.state.semanticAnchors.map((candidate) => (
          candidate.anchorId === existing.anchorId ? anchor : candidate
        ))
      : [...this.state.semanticAnchors, anchor];
    this.state = { ...this.state, semanticAnchors };
    this.persist();
    this.notify();
    return { ...anchor, media: anchor.media.map((item) => ({ ...item })) };
  }

  public saveSemanticRegion(nameInput: string): PersonalSemanticRegion {
    this.load();
    const name = nameInput.trim();
    if (!name) throw new Error('A personal semantic region needs a name.');

    const existing = this.state.semanticRegions.find(
      (region) => region.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    );
    if (existing) return { ...existing };

    const now = Date.now();
    const region: PersonalSemanticRegion = {
      regionId: createPersonalId('region'),
      name,
      createdAt: now,
      updatedAt: now,
    };
    this.state = {
      ...this.state,
      semanticRegions: [...this.state.semanticRegions, region],
    };
    this.persist();
    this.notify();
    return { ...region };
  }

  public createPersonalMeaning(input: {
    familiarExpression: string;
    familiarExpressionType: PersonalMeaningExpressionType;
    experience: string;
  }): PersonalMeaning {
    this.load();
    const familiarExpression = input.familiarExpression.trim();
    const experience = input.experience.trim();
    if (!familiarExpression && !experience) {
      throw new Error('A Personal Meaning needs a familiar expression or a concrete experience.');
    }
    if (!expressionTypes.has(input.familiarExpressionType)) {
      throw new Error('The familiar expression type is not supported.');
    }

    const now = Date.now();
    const meaning: PersonalMeaning = {
      personalMeaningId: createPersonalId('personal_meaning'),
      currentRevision: 1,
      status: 'active',
      familiarExpressionAnchors: familiarExpression
        ? [{
            personalExpressionAnchorId: createPersonalId('personal_expression_anchor'),
            languageTag: 'zh-CN',
            expressionType: input.familiarExpressionType,
            learnerLanguageRole: 'familiar',
            surfaceForm: familiarExpression,
            provenance: 'learner_authored',
            revision: 1,
          }]
        : [],
      semanticAnchors: experience
        ? [{
            personalSemanticAnchorId: createPersonalId('personal_semantic_anchor'),
            anchorKind: 'scene',
            bodyText: experience,
            provenance: 'learner_authored',
            revision: 1,
          }]
        : [],
      prototypeRegionId: null,
      legacyTargetExpressionCandidates: [],
      createdAt: now,
      updatedAt: now,
    };
    this.state = {
      ...this.state,
      personalMeanings: [...this.state.personalMeanings, meaning],
    };
    this.persist();
    this.notify();
    return {
      ...meaning,
      familiarExpressionAnchors: meaning.familiarExpressionAnchors.map((anchor) => ({ ...anchor })),
      semanticAnchors: meaning.semanticAnchors.map((anchor) => ({ ...anchor })),
      legacyTargetExpressionCandidates: [],
    };
  }

  public getPersonalMeaning(personalMeaningId: string): PersonalMeaning | null {
    this.load();
    const meaning = this.state.personalMeanings.find(
      (candidate) => candidate.personalMeaningId === personalMeaningId,
    );
    if (!meaning) return null;
    return {
      ...meaning,
      familiarExpressionAnchors: meaning.familiarExpressionAnchors.map((anchor) => ({ ...anchor })),
      semanticAnchors: meaning.semanticAnchors.map((anchor) => ({ ...anchor })),
      legacyTargetExpressionCandidates: meaning.legacyTargetExpressionCandidates.map(
        (candidate) => ({ ...candidate }),
      ),
    };
  }

  /**
   * Edit a Personal Meaning's anchors while keeping its identity stable. Any
   * change bumps the meaning's currentRevision; editing one anchor bumps that
   * anchor's revision without changing its id. Anchor edits never confirm a
   * Focus, Sense or Expression — that stays in the journey gateway.
   */
  private mutateMeaning(
    personalMeaningId: string,
    mutate: (meaning: PersonalMeaning) => PersonalMeaning,
  ): PersonalMeaning {
    this.load();
    const existing = this.state.personalMeanings.find(
      (candidate) => candidate.personalMeaningId === personalMeaningId,
    );
    if (!existing) {
      throw new Error('The Personal Meaning to edit was not found.');
    }
    const mutated: PersonalMeaning = {
      ...mutate(existing),
      personalMeaningId: existing.personalMeaningId,
      currentRevision: existing.currentRevision + 1,
      status: 'active',
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    };
    this.state = {
      ...this.state,
      personalMeanings: this.state.personalMeanings.map((candidate) =>
        candidate.personalMeaningId === personalMeaningId ? mutated : candidate,
      ),
    };
    this.persist();
    this.notify();
    return {
      ...mutated,
      familiarExpressionAnchors: mutated.familiarExpressionAnchors.map((anchor) => ({ ...anchor })),
      semanticAnchors: mutated.semanticAnchors.map((anchor) => ({ ...anchor })),
      legacyTargetExpressionCandidates: mutated.legacyTargetExpressionCandidates.map(
        (candidate) => ({ ...candidate }),
      ),
    };
  }

  public addFamiliarExpressionAnchor(
    personalMeaningId: string,
    surfaceForm: string,
    expressionType: PersonalMeaningExpressionType,
  ): PersonalMeaning {
    const trimmed = surfaceForm.trim();
    if (!trimmed) throw new Error('A familiar expression anchor cannot be empty.');
    if (!expressionTypes.has(expressionType)) {
      throw new Error('The familiar expression type is not supported.');
    }
    return this.mutateMeaning(personalMeaningId, (meaning) => ({
      ...meaning,
      familiarExpressionAnchors: [
        ...meaning.familiarExpressionAnchors,
        {
          personalExpressionAnchorId: createPersonalId('personal_expression_anchor'),
          languageTag: 'zh-CN',
          expressionType,
          learnerLanguageRole: 'familiar',
          surfaceForm: trimmed,
          provenance: 'learner_authored',
          revision: 1,
        },
      ],
    }));
  }

  public editFamiliarExpressionAnchor(
    personalMeaningId: string,
    anchorId: string,
    surfaceForm: string,
    expressionType: PersonalMeaningExpressionType,
  ): PersonalMeaning {
    const trimmed = surfaceForm.trim();
    if (!trimmed) throw new Error('A familiar expression anchor cannot be empty.');
    if (!expressionTypes.has(expressionType)) {
      throw new Error('The familiar expression type is not supported.');
    }
    return this.mutateMeaning(personalMeaningId, (meaning) => ({
      ...meaning,
      familiarExpressionAnchors: meaning.familiarExpressionAnchors.map((anchor) =>
        anchor.personalExpressionAnchorId === anchorId
          ? {
              ...anchor,
              surfaceForm: trimmed,
              expressionType,
              revision: anchor.revision + 1,
            }
          : anchor,
      ),
    }));
  }

  public removeFamiliarExpressionAnchor(
    personalMeaningId: string,
    anchorId: string,
  ): PersonalMeaning {
    return this.mutateMeaning(personalMeaningId, (meaning) => ({
      ...meaning,
      familiarExpressionAnchors: meaning.familiarExpressionAnchors.filter(
        (anchor) => anchor.personalExpressionAnchorId !== anchorId,
      ),
    }));
  }

  public addExperienceAnchor(
    personalMeaningId: string,
    bodyText: string,
  ): PersonalMeaning {
    const trimmed = bodyText.trim();
    if (!trimmed) throw new Error('An experience anchor cannot be empty.');
    return this.mutateMeaning(personalMeaningId, (meaning) => ({
      ...meaning,
      semanticAnchors: [
        ...meaning.semanticAnchors,
        {
          personalSemanticAnchorId: createPersonalId('personal_semantic_anchor'),
          anchorKind: 'scene',
          bodyText: trimmed,
          provenance: 'learner_authored',
          revision: 1,
        },
      ],
    }));
  }

  public editExperienceAnchor(
    personalMeaningId: string,
    anchorId: string,
    bodyText: string,
  ): PersonalMeaning {
    const trimmed = bodyText.trim();
    if (!trimmed) throw new Error('An experience anchor cannot be empty.');
    return this.mutateMeaning(personalMeaningId, (meaning) => ({
      ...meaning,
      semanticAnchors: meaning.semanticAnchors.map((anchor) =>
        anchor.personalSemanticAnchorId === anchorId
          ? { ...anchor, bodyText: trimmed, revision: anchor.revision + 1 }
          : anchor,
      ),
    }));
  }

  public removeExperienceAnchor(
    personalMeaningId: string,
    anchorId: string,
  ): PersonalMeaning {
    return this.mutateMeaning(personalMeaningId, (meaning) => ({
      ...meaning,
      semanticAnchors: meaning.semanticAnchors.filter(
        (anchor) => anchor.personalSemanticAnchorId !== anchorId,
      ),
    }));
  }
}

export const personalContentService = new PersonalContentService();
