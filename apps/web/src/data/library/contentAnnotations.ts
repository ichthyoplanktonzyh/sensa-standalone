import { canonicalJsonDigest } from '@sensa/learning-kernel';
import { command, observeLibrary, readLibrary } from './store';

export interface PersonalSemanticAnchorMedia {
  mediaId: string;
  kind: 'image';
  dataUrl: string;
  mimeType: string;
  fileName: string;
  altText: string;
}

export interface PersonalSemanticAnchor {
  id: string;
  kind: 'semantic_anchor';
  anchorId: string;
  senseId: string;
  body: string;
  media: PersonalSemanticAnchorMedia[];
  createdAt: number;
  updatedAt: number;
}

export interface PersonalLearningSceneRevision {
  revisionId: string;
  revision: number;
  curriculumMembershipId: string;
  body: string;
  media: PersonalSemanticAnchorMedia[];
  createdAt: number;
}

/** Learner-owned runtime scaffold. It becomes a Personal Semantic Anchor only
 * after a separate Semantic Acceptance command. */
export interface PersonalLearningScene {
  id: string;
  kind: 'learning_scene';
  sceneId: string;
  learningTargetId: string;
  languageRouteId: string;
  senseId: string;
  senseVersionId: string;
  bindingVersionId: string;
  currentRevision: number;
  revisions: PersonalLearningSceneRevision[];
  acceptedRevisionId: string | null;
  acceptedPersonalMeaningId: string | null;
  createdAt: number;
  updatedAt: number;
}

export type ContentAnnotation =
  | Readonly<{
      id: string;
      kind: 'word_note';
      word: string;
      body: string;
      updatedAt: number;
    }>
  | Readonly<{
      id: string;
      kind: 'sense_note';
      senseId: string;
      body: string;
      updatedAt: number;
    }>
  | Readonly<{
      id: string;
      kind: 'saved_sense';
      senseId: string;
      createdAt: number;
    }>
  | Readonly<{
      id: string;
      kind: 'saved_example';
      exampleId: string;
      createdAt: number;
    }>
  | PersonalSemanticAnchor
  | PersonalLearningScene;

const wordKey = (word: string) => word.trim().toLocaleLowerCase();
const rowId = (kind: ContentAnnotation['kind'], subject: string) =>
  `${kind}:${encodeURIComponent(subject)}`;
export const personalLearningSceneRowId = (learningTargetId: string, languageRouteId: string) =>
  rowId('learning_scene', `${learningTargetId}:${languageRouteId}`);

let rows: readonly ContentAnnotation[] = [];
let loadRevision = 0;
let stopObserving: (() => void) | null = null;
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) listener();
};

const reloadQuietly = () => { void reload().catch(() => undefined); };

async function reload() {
  const revision = ++loadRevision;
  const next = await readLibrary((tx) => tx.all<ContentAnnotation>('annotations'));
  if (revision !== loadRevision) return;
  rows = next;
  notify();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  if (listeners.size === 1) {
    stopObserving = observeLibrary(reloadQuietly);
    reloadQuietly();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopObserving?.();
      stopObserving = null;
    }
  };
};

const find = <K extends ContentAnnotation['kind']>(kind: K, id: string) =>
  rows.find((row): row is Extract<ContentAnnotation, { kind: K }> => (
    row.kind === kind && row.id === id
  ));

async function setNote(scope: 'word' | 'sense', subject: string, content: string) {
  const normalized = scope === 'word' ? wordKey(subject) : subject.trim();
  if (!normalized) return;
  const kind = scope === 'word' ? 'word_note' : 'sense_note';
  const id = rowId(kind, normalized);
  const body = content.trim();
  await command({
    id: crypto.randomUUID(),
    kind: `annotation.${kind}`,
    input: {
      subject: normalized,
      clear: !body,
      contentDigest: canonicalJsonDigest(body),
    },
  }, async (tx) => {
    if (!body) tx.delete('annotations', id);
    else if (kind === 'word_note') {
      tx.put('annotations', id, { id, kind, word: normalized, body, updatedAt: Date.now() });
    } else {
      tx.put('annotations', id, { id, kind, senseId: normalized, body, updatedAt: Date.now() });
    }
  });
  await reload();
}

async function toggleSaved(kind: 'saved_sense' | 'saved_example', subject: string) {
  const normalized = subject.trim();
  if (!normalized) throw new Error('localFlow.annotationInvalid');
  const id = rowId(kind, normalized);
  const saved = await command({
    id: crypto.randomUUID(),
    kind: `annotation.${kind}`,
    input: { subject: normalized },
  }, async (tx) => {
    const current = await tx.get<ContentAnnotation>('annotations', id);
    if (current) {
      tx.delete('annotations', id);
      return false;
    }
    const value = kind === 'saved_sense'
      ? { id, kind, senseId: normalized, createdAt: Date.now() }
      : { id, kind, exampleId: normalized, createdAt: Date.now() };
    tx.put('annotations', id, value);
    return true;
  });
  await reload();
  return saved;
}

async function saveSemanticAnchor(input: Readonly<{
  senseId: string;
  anchorId?: string;
  body: string;
  media: readonly PersonalSemanticAnchorMedia[];
}>) {
  const senseId = input.senseId.trim();
  const body = input.body.trim();
  if (!senseId || (!body && input.media.length === 0)) {
    throw new Error('localFlow.annotationInvalid');
  }
  const anchorId = input.anchorId ?? crypto.randomUUID();
  const id = rowId('semantic_anchor', anchorId);
  const saved = await command({
    id: crypto.randomUUID(),
    kind: 'annotation.semantic_anchor',
    input: {
      anchorId,
      senseId,
      contentDigest: canonicalJsonDigest({ body, media: input.media }),
    },
  }, async (tx) => {
    const current = await tx.get<PersonalSemanticAnchor>('annotations', id);
    const now = Date.now();
    const anchor: PersonalSemanticAnchor = {
      id,
      kind: 'semantic_anchor',
      anchorId,
      senseId,
      body,
      media: structuredClone(input.media) as PersonalSemanticAnchorMedia[],
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    tx.put('annotations', id, anchor);
    return anchorId;
  });
  await reload();
  return saved;
}

async function saveLearningScene(input: Readonly<{
  operationId: string;
  learningTargetId: string;
  languageRouteId: string;
  curriculumMembershipId: string;
  senseId: string;
  senseVersionId: string;
  bindingVersionId: string;
  body: string;
  media: readonly PersonalSemanticAnchorMedia[];
}>) {
  const body = input.body.trim();
  if (!body && input.media.length === 0) throw new Error('localFlow.annotationInvalid');
  const id = personalLearningSceneRowId(input.learningTargetId, input.languageRouteId);
  const scene = await command({
    id: input.operationId,
    kind: 'annotation.learning_scene.save',
    input: {
      learningTargetId: input.learningTargetId,
      languageRouteId: input.languageRouteId,
      curriculumMembershipId: input.curriculumMembershipId,
      senseId: input.senseId,
      senseVersionId: input.senseVersionId,
      bindingVersionId: input.bindingVersionId,
      contentDigest: canonicalJsonDigest({ body, media: input.media }),
    },
  }, async (tx) => {
    const current = await tx.get<PersonalLearningScene>('annotations', id);
    if (current && (
      current.learningTargetId !== input.learningTargetId
      || current.languageRouteId !== input.languageRouteId
      || current.senseId !== input.senseId
      || current.senseVersionId !== input.senseVersionId
      || current.bindingVersionId !== input.bindingVersionId
    )) throw new Error('localFlow.annotationInvalid');
    const currentValue = current?.revisions.find((revision) => (
      revision.revision === current.currentRevision
    ));
    if (currentValue && canonicalJsonDigest({ body: currentValue.body, media: currentValue.media })
      === canonicalJsonDigest({ body, media: input.media })) return current;
    const now = Date.now();
    const revision: PersonalLearningSceneRevision = {
      revisionId: crypto.randomUUID(),
      revision: (current?.currentRevision ?? 0) + 1,
      curriculumMembershipId: input.curriculumMembershipId,
      body,
      media: structuredClone(input.media) as PersonalSemanticAnchorMedia[],
      createdAt: now,
    };
    const next: PersonalLearningScene = {
      id,
      kind: 'learning_scene',
      sceneId: current?.sceneId ?? crypto.randomUUID(),
      learningTargetId: input.learningTargetId,
      languageRouteId: input.languageRouteId,
      senseId: input.senseId,
      senseVersionId: input.senseVersionId,
      bindingVersionId: input.bindingVersionId,
      currentRevision: revision.revision,
      revisions: [...(current?.revisions ?? []), revision],
      acceptedRevisionId: current?.acceptedRevisionId ?? null,
      acceptedPersonalMeaningId: current?.acceptedPersonalMeaningId ?? null,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    tx.put('annotations', id, next);
    return next;
  });
  await reload();
  return scene;
}

async function markLearningSceneAccepted(input: Readonly<{
  operationId: string;
  sceneId: string;
  revisionId: string;
  personalMeaningId: string;
}>) {
  const result = await command({
    id: input.operationId,
    kind: 'annotation.learning_scene.accepted',
    input,
  }, async (tx) => {
    const current = (await tx.all<PersonalLearningScene>('annotations')).find((candidate) => (
      candidate.kind === 'learning_scene' && candidate.sceneId === input.sceneId
    ));
    if (!current || !current.revisions.some((revision) => revision.revisionId === input.revisionId)) {
      throw new Error('localFlow.annotationInvalid');
    }
    const next: PersonalLearningScene = {
      ...current,
      acceptedRevisionId: input.revisionId,
      acceptedPersonalMeaningId: input.personalMeaningId,
      updatedAt: Date.now(),
    };
    tx.put('annotations', next.id, next);
    return next;
  });
  await reload();
  return result;
}

export const contentAnnotations = {
  subscribe,
  getNote(word: string) {
    return find('word_note', rowId('word_note', wordKey(word)))?.body ?? '';
  },
  getSenseNote(senseId: string) {
    return find('sense_note', rowId('sense_note', senseId.trim()))?.body ?? '';
  },
  getAllNotes() {
    return Object.fromEntries(rows.flatMap((row) => row.kind === 'word_note' ? [[row.word, row.body]] : []));
  },
  getAllSenseNotes() {
    return Object.fromEntries(rows.flatMap((row) => row.kind === 'sense_note' ? [[row.senseId, row.body]] : []));
  },
  setNote: (word: string, content: string) => setNote('word', word, content),
  setSenseNote: (senseId: string, content: string) => setNote('sense', senseId, content),
  isSenseSaved(senseId: string) {
    return !!find('saved_sense', rowId('saved_sense', senseId.trim()));
  },
  isExampleSaved(exampleId: string) {
    return !!find('saved_example', rowId('saved_example', exampleId.trim()));
  },
  getSavedSenseIds() {
    return new Set(rows.flatMap((row) => row.kind === 'saved_sense' ? [row.senseId] : []));
  },
  getSavedExampleIds() {
    return new Set(rows.flatMap((row) => row.kind === 'saved_example' ? [row.exampleId] : []));
  },
  toggleSense: (senseId: string) => toggleSaved('saved_sense', senseId),
  toggleExample: (exampleId: string) => toggleSaved('saved_example', exampleId),
  getSemanticAnchors(senseId: string) {
    return rows
      .flatMap((row) => row.kind === 'semantic_anchor' && row.senseId === senseId ? [row] : [])
      .sort((left, right) => right.updatedAt - left.updatedAt);
  },
  getSemanticAnchor(anchorId: string) {
    return find('semantic_anchor', rowId('semantic_anchor', anchorId)) ?? null;
  },
  saveSemanticAnchor,
  getLearningScene(learningTargetId: string, languageRouteId: string) {
    return find('learning_scene', personalLearningSceneRowId(learningTargetId, languageRouteId)) ?? null;
  },
  getLearningSceneRevision(scene: PersonalLearningScene) {
    return scene.revisions.find((revision) => revision.revision === scene.currentRevision) ?? null;
  },
  saveLearningScene,
  markLearningSceneAccepted,
};
