import { canonicalJsonDigest } from '@sensa/learning-kernel';

import {
  assertCurrentLibrary,
  command,
  observeLibrary,
  readLibrary,
  type LibraryTransaction,
} from '../../data/library/store';

export interface PersonalContentImage {
  mediaId: string;
  kind: 'image';
  dataUrl: string;
  mimeType: string;
  fileName: string;
  altText: string;
}

/**
 * A personal annotation attached to a stable Sense. It is deliberately not a
 * Personal Semantic Anchor: entering the Personal Semantic World still
 * requires a Personal Meaning and explicit Semantic Acceptance.
 */
export interface SenseContextNote {
  id: string;
  kind: 'sense_context';
  contextId: string;
  senseId: string;
  body: string;
  media: PersonalContentImage[];
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export interface SenseNote {
  id: string;
  kind: 'sense_note';
  senseId: string;
  body: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export interface SenseNoteSnapshot {
  readonly body: string;
  /** Zero means no note has ever been saved; clearing retains the revision. */
  readonly revision: number;
}

export class SenseNoteConflictError extends Error {
  constructor(readonly current: SenseNoteSnapshot) {
    super('personalContent.noteChanged');
  }
}

export interface SenseNoteSaveResult {
  readonly note: SenseNoteSnapshot;
  readonly projectionUpdated: boolean;
}

export interface PersonalLearningSceneRevision {
  revisionId: string;
  revision: number;
  curriculumMembershipId: string;
  body: string;
  media: PersonalContentImage[];
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

/** The editor's exact read base, without copying media into command metadata. */
export type PersonalLearningSceneEditBase = Readonly<{revisionId:string;contentDigest:string}> | null;

export const personalLearningSceneEditBase = (scene:PersonalLearningScene|null):PersonalLearningSceneEditBase => {
  const revision=scene?.revisions.find(row=>row.revision===scene.currentRevision);
  return revision?{revisionId:revision.revisionId,contentDigest:canonicalJsonDigest({body:revision.body,media:revision.media})}:null;
};

export interface PersonalLearningSceneEditSnapshot {
  readonly expected:PersonalLearningSceneEditBase;
  readonly body:string;
  readonly media:PersonalContentImage[];
}

export class PersonalLearningSceneConflictError extends Error {
  constructor(readonly current:PersonalLearningSceneEditSnapshot|null) {super('personalContent.sceneChanged');}
}

export interface PersonalLearningSceneSaveResult {
  readonly scene:PersonalLearningScene;
  readonly projectionUpdated:boolean;
}

export type PersonalContentRecord =
  | SenseNote
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
  | SenseContextNote
  | PersonalLearningScene;

export interface PersonalContentSnapshot {
  readonly status: 'loading' | 'ready' | 'error';
  readonly savedSenseIds: ReadonlySet<string>;
  readonly savedExampleIds: ReadonlySet<string>;
  readonly senseNotes: Readonly<Record<string, string>>;
}

export interface PersonalSenseContent {
  readonly status: 'loading' | 'ready' | 'error';
  readonly saved: boolean;
  readonly note: string;
  readonly contexts: readonly SenseContextNote[];
}

export type PersonalContentQuery =
  | Readonly<{ kind: 'snapshot' }>
  | Readonly<{ kind: 'sense'; senseId: string }>
  | Readonly<{ kind: 'example'; exampleId: string }>
  | Readonly<{ kind: 'sense_context'; contextId: string }>
  | Readonly<{ kind: 'learning_scene'; learningTargetId: string; languageRouteId: string }>;

export type PersonalContentQueryResult<Query extends PersonalContentQuery> =
  Query['kind'] extends 'snapshot' ? PersonalContentSnapshot
    : Query['kind'] extends 'sense' ? PersonalSenseContent
      : Query['kind'] extends 'example' ? boolean
        : Query['kind'] extends 'sense_context' ? SenseContextNote | null
          : PersonalLearningScene | null;

export type PersonalSceneQuery = Extract<PersonalContentQuery,{kind:'sense_context'|'learning_scene'}>;

type SetSavedCommand = Readonly<{
  operationId: string;
  saved: boolean;
}>;

export type PersonalContentCommand =
  | (SetSavedCommand & Readonly<{ kind: 'set_saved_sense'; senseId: string }>)
  | (SetSavedCommand & Readonly<{ kind: 'set_saved_example'; exampleId: string }>)
  | Readonly<{ kind: 'set_sense_note'; operationId: string; senseId: string; body: string; expected: SenseNoteSnapshot }>
  | Readonly<{
      kind: 'save_sense_context';
      operationId: string;
      senseId: string;
      contextId?: string;
      body: string;
      media: readonly PersonalContentImage[];
    }>
  | Readonly<{
      kind: 'save_learning_scene';
      operationId: string;
      learningTargetId: string;
      languageRouteId: string;
      curriculumMembershipId: string;
      senseId: string;
      senseVersionId: string;
      bindingVersionId: string;
      body: string;
      media: readonly PersonalContentImage[];
      expected: PersonalLearningSceneEditBase;
    }>
  | Readonly<{
      kind: 'mark_learning_scene_accepted';
      operationId: string;
      sceneId: string;
      revisionId: string;
      personalMeaningId: string;
    }>;

export type PersonalContentCommandResult<Command extends PersonalContentCommand> =
  Command['kind'] extends 'set_saved_sense' | 'set_saved_example' ? boolean
    : Command['kind'] extends 'set_sense_note' ? SenseNoteSaveResult
      : Command['kind'] extends 'save_sense_context' ? string
        : Command['kind'] extends 'save_learning_scene' ? PersonalLearningSceneSaveResult
          : PersonalLearningScene;

export interface PersonalContentSystem {
  execute<Command extends PersonalContentCommand>(
    command: Command,
  ): Promise<PersonalContentCommandResult<Command>>;
  read<Query extends PersonalContentQuery>(query: Query): PersonalContentQueryResult<Query>;
  /** Load the exact edit base, not an initially empty or stale presentation cache. */
  readSenseNote(senseId: string): Promise<SenseNoteSnapshot>;
  /** An exact durable scene/context read; null means confirmed absence, never an unread cache. */
  readScene<Query extends PersonalSceneQuery>(query:Query):Promise<PersonalContentQueryResult<Query>>;
  refresh(): Promise<void>;
  subscribe(query: PersonalContentQuery, listener: () => void): () => void;
}

const rowId = (kind: PersonalContentRecord['kind'], subject: string) =>
  `${kind}:${encodeURIComponent(subject)}`;

export const personalLearningSceneRowId = (learningTargetId: string, languageRouteId: string) =>
  rowId('learning_scene', `${learningTargetId}:${languageRouteId}`);

let rows: readonly PersonalContentRecord[] = [];
let rowsById = new Map<string,PersonalContentRecord>();
let contextsBySense = new Map<string,SenseContextNote[]>();
let loadRevision = 0;
let readStatus: PersonalContentSnapshot['status'] = 'loading';
let stopObserving: (() => void) | null = null;
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) listener();
};

const reloadQuietly = () => { void reload().catch(() => undefined); };

async function reload() {
  const revision = ++loadRevision;
  if(readStatus!=='loading'){readStatus='loading';notify();}
  let next:PersonalContentRecord[];
  try{next=await readLibrary((tx) => tx.all<PersonalContentRecord>('annotations'));}
  catch(error){if(revision===loadRevision){readStatus='error';notify();}throw error;}
  if (revision !== loadRevision) return;
  rows = next;
  rowsById=new Map(next.map(row=>[row.id,row]));
  const grouped=new Map<string,SenseContextNote[]>();
  for(const row of next)if(row.kind==='sense_context'){
    const group=grouped.get(row.senseId)??[];group.push(row);grouped.set(row.senseId,group);
  }
  for(const group of grouped.values())group.sort((a,b)=>b.updatedAt-a.updatedAt);
  contextsBySense=grouped;
  readStatus='ready';
  notify();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  if (listeners.size === 1) {
    stopObserving = observeLibrary(reloadQuietly, ['annotations']);
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

const find = <K extends PersonalContentRecord['kind']>(kind: K, id: string) =>
  {const row=rowsById.get(id);return row?.kind===kind?row as Extract<PersonalContentRecord,{kind:K}>:undefined;};

const cloneImages = (media: readonly PersonalContentImage[]): PersonalContentImage[] =>
  structuredClone(media) as PersonalContentImage[];

const assertChangedPersonalContent = async (tx: LibraryTransaction) => {
  const { assertPersonalContentChanges } = await import('./personalContentAuthority');
  await assertPersonalContentChanges(tx);
};

async function setSenseNote(input: Extract<PersonalContentCommand, { kind: 'set_sense_note' }>) {
  const senseId = input.senseId.trim();
  const expected = input.expected && {body: input.expected.body, revision: input.expected.revision};
  if (!senseId || !expected || !Number.isSafeInteger(expected.revision) || expected.revision < 0
    || typeof expected.body !== 'string' || expected.body.length > 1000) {
    throw new Error('localFlow.annotationInvalid');
  }
  const id = rowId('sense_note', senseId);
  const body = input.body.trim();
  const note = await command({
    id: input.operationId,
    kind: 'personal_content.sense_note.set',
    input: { senseId, expectedRevision: expected.revision, expectedContentDigest: canonicalJsonDigest(expected.body), clear: !body, contentDigest: canonicalJsonDigest(body) },
  }, async (tx) => {
    const current = await tx.get<SenseNote>('annotations', id);
    const revision = current?.revision ?? 0;
    // An explicitly chosen Cloud fork can have the same revision number with
    // different content. Compare the actual edit base, not just the counter.
    if (revision !== expected.revision || (current?.body ?? '') !== expected.body) {
      throw new SenseNoteConflictError({body: current?.body ?? '', revision});
    }
    if ((current?.body ?? '') !== body) {
      const now = Date.now();
      tx.put('annotations', id, {
        id,
        kind: 'sense_note',
        senseId,
        body,
        revision: revision + 1,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
      } satisfies SenseNote);
      await assertChangedPersonalContent(tx);
      return {body, revision: revision + 1};
    }
    return {body, revision};
  });
  // A failed presentation read cannot turn a confirmed durable save into a
  // failed write. The caller can offer a read retry without re-saving.
  try {
    await reload();
    return {note, projectionUpdated: readStatus==='ready'};
  } catch {
    return {note, projectionUpdated: false};
  }
}

const readSenseNote = (senseId: string): Promise<SenseNoteSnapshot> => readLibrary(async (tx) => {
  const normalized = senseId.trim();
  if (!normalized) throw new Error('localFlow.annotationInvalid');
  await assertCurrentLibrary(tx);
  const current = await tx.get<SenseNote>('annotations', rowId('sense_note', normalized));
  return {body: current?.body ?? '', revision: current?.revision ?? 0};
});

const readScene = <Query extends PersonalSceneQuery>(query:Query):Promise<PersonalContentQueryResult<Query>> => {
  const key=query.kind==='sense_context'?rowId('sense_context',query.contextId):personalLearningSceneRowId(query.learningTargetId,query.languageRouteId);
  return readLibrary(async tx=>{
    await assertCurrentLibrary(tx);
    const current=await tx.get<SenseContextNote|PersonalLearningScene>('annotations',key);
    if(current&&current.kind!==query.kind)throw Error('localFlow.annotationInvalid');
    return (current??null) as PersonalContentQueryResult<Query>;
  });
};

async function setSaved(
  kind: 'saved_sense' | 'saved_example',
  subject: string,
  saved: boolean,
  operationId: string,
) {
  const normalized = subject.trim();
  if (!normalized) throw new Error('localFlow.annotationInvalid');
  const id = rowId(kind, normalized);
  const result = await command({
    id: operationId,
    kind: `personal_content.${kind}.set`,
    input: { subject: normalized, saved },
  }, async (tx) => {
    const current = await tx.get<PersonalContentRecord>('annotations', id);
    if (!saved) tx.delete('annotations', id);
    else if (!current) {
      const value = kind === 'saved_sense'
        ? { id, kind, senseId: normalized, createdAt: Date.now() }
        : { id, kind, exampleId: normalized, createdAt: Date.now() };
      tx.put('annotations', id, value);
    }
    await assertChangedPersonalContent(tx);
    return saved;
  });
  await reload();
  return result;
}

async function saveSenseContext(
  input: Extract<PersonalContentCommand, { kind: 'save_sense_context' }>,
) {
  const senseId = input.senseId.trim();
  const body = input.body.trim();
  if (!senseId || (!body && input.media.length === 0)) throw new Error('localFlow.annotationInvalid');
  const contextId = input.contextId ?? crypto.randomUUID();
  const id = rowId('sense_context', contextId);
  const saved = await command({
    id: input.operationId,
    kind: 'personal_content.sense_context.save',
    input: { contextId, senseId, contentDigest: canonicalJsonDigest({ body, media: input.media }) },
  }, async (tx) => {
    const current = await tx.get<SenseContextNote>('annotations', id);
    if (current && canonicalJsonDigest({ body: current.body, media: current.media })
      === canonicalJsonDigest({ body, media: input.media })) return contextId;
    const now = Date.now();
    tx.put('annotations', id, {
      id,
      kind: 'sense_context',
      contextId,
      senseId,
      body,
      media: cloneImages(input.media),
      revision: (current?.revision ?? 0) + 1,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    } satisfies SenseContextNote);
    await assertChangedPersonalContent(tx);
    return contextId;
  });
  await reload();
  return saved;
}

async function saveLearningScene(
  input: Extract<PersonalContentCommand, { kind: 'save_learning_scene' }>,
) {
  if(input.expected===undefined)throw new Error('localFlow.annotationInvalid');
  // Capture one request before waiting on the transaction. Caller aliases
  // cannot change either the receipt digest or the material that is committed.
  input={...input,media:cloneImages(input.media),expected:input.expected&&{...input.expected}};
  if(input.expected&&(typeof input.expected.revisionId!=='string'||!input.expected.revisionId
    ||typeof input.expected.contentDigest!=='string'||!input.expected.contentDigest))throw new Error('localFlow.annotationInvalid');
  const body = input.body.trim();
  if (!body && input.media.length === 0) throw new Error('localFlow.annotationInvalid');
  const id = personalLearningSceneRowId(input.learningTargetId, input.languageRouteId);
  const scene = await command({
    id: input.operationId,
    kind: 'personal_content.learning_scene.save',
    input: {
      learningTargetId: input.learningTargetId,
      languageRouteId: input.languageRouteId,
      curriculumMembershipId: input.curriculumMembershipId,
      senseId: input.senseId,
      senseVersionId: input.senseVersionId,
      bindingVersionId: input.bindingVersionId,
      expected: input.expected,
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
    const currentValue = current?.revisions.find((revision) => revision.revision === current.currentRevision);
    if(canonicalJsonDigest(personalLearningSceneEditBase(current??null))!==canonicalJsonDigest(input.expected)) {
      throw new PersonalLearningSceneConflictError(currentValue?{expected:personalLearningSceneEditBase(current!),body:currentValue.body,media:cloneImages(currentValue.media)}:null);
    }
    if (currentValue && canonicalJsonDigest({ body: currentValue.body, media: currentValue.media })
      === canonicalJsonDigest({ body, media: input.media })) return current;
    const now = Date.now();
    const revision: PersonalLearningSceneRevision = {
      revisionId: crypto.randomUUID(),
      revision: (current?.currentRevision ?? 0) + 1,
      curriculumMembershipId: input.curriculumMembershipId,
      body,
      media: cloneImages(input.media),
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
    await assertChangedPersonalContent(tx);
    return next;
  });
  // A list refresh cannot undo the durable scene+receipt commit.
  try {await reload();return {scene,projectionUpdated:readStatus==='ready'};}
  catch {return {scene,projectionUpdated:false};}
}

async function markLearningSceneAccepted(
  input: Extract<PersonalContentCommand, { kind: 'mark_learning_scene_accepted' }>,
) {
  const result = await command({
    id: input.operationId,
    kind: 'personal_content.learning_scene.accepted',
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
    await assertChangedPersonalContent(tx);
    return next;
  });
  await reload();
  return result;
}

const read = <Query extends PersonalContentQuery>(
  query: Query,
): PersonalContentQueryResult<Query> => {
  let result: unknown;
  switch (query.kind) {
    case 'snapshot':
      result = {
        status: readStatus,
        savedSenseIds: new Set(rows.flatMap((row) => row.kind === 'saved_sense' ? [row.senseId] : [])),
        savedExampleIds: new Set(rows.flatMap((row) => row.kind === 'saved_example' ? [row.exampleId] : [])),
        senseNotes: Object.fromEntries(rows.flatMap((row) => row.kind === 'sense_note' && row.body ? [[row.senseId, row.body]] : [])),
      } satisfies PersonalContentSnapshot;
      break;
    case 'sense':
      result = {
        status: readStatus,
        saved: !!find('saved_sense', rowId('saved_sense', query.senseId.trim())),
        note: find('sense_note', rowId('sense_note', query.senseId.trim()))?.body ?? '',
        contexts: [...(contextsBySense.get(query.senseId)??[])],
      } satisfies PersonalSenseContent;
      break;
    case 'example':
      result = !!find('saved_example', rowId('saved_example', query.exampleId.trim()));
      break;
    case 'sense_context':
      result = find('sense_context', rowId('sense_context', query.contextId)) ?? null;
      break;
    case 'learning_scene':
      result = find('learning_scene', personalLearningSceneRowId(
        query.learningTargetId,
        query.languageRouteId,
      )) ?? null;
      break;
  }
  return result as PersonalContentQueryResult<Query>;
};

/**
 * Stable Personal Content deep Module interface. Screens submit explicit
 * learner intents and read presentation-safe projections; annotation rows,
 * operation receipts, validation and revision histories remain hidden.
 */
export const personalContentSystem: PersonalContentSystem = {
  execute: (async (input: PersonalContentCommand) => {
    switch (input.kind) {
      case 'set_saved_sense':
        return setSaved('saved_sense', input.senseId, input.saved, input.operationId);
      case 'set_saved_example':
        return setSaved('saved_example', input.exampleId, input.saved, input.operationId);
      case 'set_sense_note':
        return setSenseNote(input);
      case 'save_sense_context':
        return saveSenseContext(input);
      case 'save_learning_scene':
        return saveLearningScene(input);
      case 'mark_learning_scene_accepted':
        return markLearningSceneAccepted(input);
    }
  }) as PersonalContentSystem['execute'],
  read,
  readSenseNote,
  readScene,
  refresh: reload,
  subscribe: (_query, listener) => subscribe(listener),
};

export const currentPersonalLearningSceneRevision = (scene: PersonalLearningScene) =>
  scene.revisions.find((revision) => revision.revision === scene.currentRevision) ?? null;

/** Transaction-local handoff used by Learning to pin the exact scaffold revision. */
export const readPersonalLearningSceneForAction = (
  tx: LibraryTransaction,
  learningTargetId: string,
  languageRouteId: string,
) => tx.get<PersonalLearningScene>(
  'annotations',
  personalLearningSceneRowId(learningTargetId, languageRouteId),
);
