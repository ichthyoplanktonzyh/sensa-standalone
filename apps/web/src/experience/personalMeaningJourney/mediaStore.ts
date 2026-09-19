import { useSyncExternalStore } from 'react';
import {
  assertCurrentLibrary,
  observeLibrary,
  readLibrary,
  restoreLibraryTransaction,
} from '../../data/library/store';
import {maxStoredMediaBytes,parseStoredMedia,type StoredMedia} from '../../data/library/media';
export {parseStoredMedia,type StoredMedia} from '../../data/library/media';
/**
 * Local media store for multimodal material blocks.
 *
 * Media bytes are kept out of the journey fact store on purpose: that state is
 * deep-cloned on every mutation, so inlining images there would make every
 * command slower as material grows. The fact store keeps only the
 * `personalMediaObjectId`; the bytes live here, keyed by that same id.
 *
 * Images are downscaled before their records enter the local Library. The
 * journey facts keep only `personalMediaObjectId`; media bytes are separate
 * rows so ordinary semantic mutations do not clone or rewrite image payloads.
 */

/** Longest edge, in pixels, an uploaded image is downscaled to before storing. */
const MAX_EDGE = 1280;
const JPEG_QUALITY = 0.82;
/** Keep a single image bounded for backup, sync and memory-cache costs. */
export class MediaStoreFullError extends Error {
  constructor() {
    super('本机存储放不下更多材料了。可以先删掉一些图片，或改用文字描述。');
    this.name = 'MediaStoreFullError';
  }
}

let mediaCache = new Map<string, StoredMedia>();
let preparedMedia = new Map<string, StoredMedia>();
let mediaReady = false;
let mediaLoad: Promise<void> | null = null;
let observing = false;
let mediaRevision = 0;
const mediaListeners = new Set<() => void>();

const announceMedia = (): void => {
  mediaRevision += 1;
  for (const listener of mediaListeners) listener();
};

const refreshMedia = async (): Promise<void> => {
  const rows = await readLibrary((tx) => tx.entries('media'));
  const next = new Map<string, StoredMedia>();
  for (const row of rows) {
    const media = parseStoredMedia(row.value);
    if (row.key !== media.mediaId) throw new Error('libraryBackup.errors.inconsistent');
    next.set(row.key, media);
  }
  for(const [mediaId,media] of preparedMedia)next.set(mediaId,media);
  mediaCache = next;
  mediaReady = true;
  announceMedia();
};

/** Load the render cache once and keep it aligned after restore or cloud sync. */
export const preloadMedia = (): Promise<void> => {
  if (!observing && typeof window !== 'undefined') {
    observing = true;
    observeLibrary(() => {
      mediaLoad = refreshMedia().finally(() => { mediaLoad = null; });
      void mediaLoad.catch(() => undefined);
    }, ['media']);
  }
  if (mediaLoad) return mediaLoad;
  if (mediaReady) return Promise.resolve();
  mediaLoad ??= refreshMedia().finally(() => { mediaLoad = null; });
  return mediaLoad;
};

/** Synchronous render-cache lookup. Call `preloadMedia` before mounting the product. */
export const getMedia = (mediaId: string): StoredMedia | null => mediaCache.get(mediaId) ?? null;

/** Async lookup for effects and non-render consumers that cannot assume preload. */
export const readMedia = async (mediaId: string): Promise<StoredMedia | null> => {
  await preloadMedia();
  return getMedia(mediaId);
};

export const useMediaStoreVersion = (): number => useSyncExternalStore(
  (listener) => { mediaListeners.add(listener); return () => mediaListeners.delete(listener); },
  () => mediaRevision,
  () => mediaRevision,
);

/** Prepare bytes for preview; the journey repository admits them atomically
 * with the first semantic row that references the id. */
export const stageMedia = (input: StoredMedia): StoredMedia => {
  if (input.sizeBytes > maxStoredMediaBytes) throw new MediaStoreFullError();
  const media = parseStoredMedia(input);
  preparedMedia.set(media.mediaId, structuredClone(media));
  mediaCache.set(media.mediaId, structuredClone(media));
  announceMedia();
  return media;
};

export const preparedMediaSnapshot = (): StoredMedia[] =>
  [...preparedMedia.values()];

export const markPreparedMediaCommitted = (mediaIds: readonly string[]): void => {
  for (const mediaId of mediaIds) preparedMedia.delete(mediaId);
};

export const removeMedia = async (mediaId: string): Promise<void> => {
  if(preparedMedia.delete(mediaId)){
    mediaCache.delete(mediaId);
    announceMedia();
    return;
  }
  await preloadMedia();
  let removed = false;
  await restoreLibraryTransaction(async (tx) => {
    await assertCurrentLibrary(tx);
    const meanings=await tx.entries('semanticMeanings');
    const inbox=await tx.entries('semanticInbox');
    const referenced=meanings.some(row=>(row.value as {personalSemanticAnchorRevisions?:Array<{personalMediaObjectId?:string|null}>})
      .personalSemanticAnchorRevisions?.some(revision=>revision.personalMediaObjectId===mediaId))
      || inbox.some(row=>(row.value as {payload?:{context?:{mediaReferenceIds?:string[]}|null}})
        .payload?.context?.mediaReferenceIds?.includes(mediaId));
    if(referenced)throw new Error('图片仍被个人意义引用，不能删除。');
    if (await tx.get('media', mediaId)) {
      tx.delete('media', mediaId);
      removed = true;
    }
  });
  if (removed) {
    mediaCache.delete(mediaId);
    announceMedia();
  }
};

const readAsDataUrl = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('无法读取这个文件。'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });

const loadImage = (dataUrl: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onerror = () => reject(new Error('这个文件不是可读取的图片。'));
    image.onload = () => resolve(image);
    image.src = dataUrl;
  });

/**
 * Downscale to `MAX_EDGE` and re-encode as JPEG so a phone photo becomes a
 * couple of hundred KB instead of several MB. Returns the original data URL
 * untouched when the browser cannot provide a canvas context.
 */
const downscale = async (dataUrl: string): Promise<{ dataUrl: string; mimeType: string }> => {
  const image = await loadImage(dataUrl);
  const longest = Math.max(image.naturalWidth, image.naturalHeight);
  const scale = longest > MAX_EDGE ? MAX_EDGE / longest : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) return { dataUrl, mimeType: 'image/png' };
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL('image/jpeg', JPEG_QUALITY), mimeType: 'image/jpeg' };
};

/** Read and downscale one picked image. Persistence waits for its semantic command. */
export const storeImageFile = async (
  mediaId: string,
  file: File,
  nowIso: string,
): Promise<StoredMedia> => {
  if (!file.type.startsWith('image/')) throw new Error('目前只支持图片材料。');
  const original = await readAsDataUrl(file);
  const { dataUrl, mimeType } = await downscale(original);
  const stored: StoredMedia = {
    mediaId,
    mediaKind: 'image',
    mimeType,
    dataUrl,
    // A base64 payload is ~4/3 of the bytes it encodes; close enough for a budget check.
    sizeBytes: Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75),
    createdAt: nowIso,
  };
  return stageMedia(stored);
};
