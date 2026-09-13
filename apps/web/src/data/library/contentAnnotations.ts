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
  | PersonalSemanticAnchor;

const wordKey = (word: string) => word.trim().toLocaleLowerCase();
const rowId = (kind: ContentAnnotation['kind'], subject: string) =>
  `${kind}:${encodeURIComponent(subject)}`;

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
};
