/**
 * Local media store for multimodal material blocks.
 *
 * Media bytes are kept out of the journey fact store on purpose: that state is
 * deep-cloned on every mutation, so inlining images there would make every
 * command slower as material grows. The fact store keeps only the
 * `personalMediaObjectId`; the bytes live here, keyed by that same id.
 *
 * Prototype scope: images are downscaled and stored as `data:` URLs in
 * localStorage. That is a real quota, so writes report an honest, recoverable
 * error instead of silently dropping a block the learner just added.
 */

const KEY = 'sensa_personal_media_v1';

/** Longest edge, in pixels, an uploaded image is downscaled to before storing. */
const MAX_EDGE = 1280;
const JPEG_QUALITY = 0.82;
/** Refuse anything that would obviously blow the localStorage budget. */
const MAX_STORED_BYTES = 1_500_000;

export interface StoredMedia {
  mediaId: string;
  mediaKind: 'image';
  mimeType: string;
  dataUrl: string;
  sizeBytes: number;
  createdAt: string;
}

export class MediaStoreFullError extends Error {
  constructor() {
    super('本机存储放不下更多材料了。可以先删掉一些图片，或改用文字描述。');
    this.name = 'MediaStoreFullError';
  }
}

type MediaMap = Record<string, StoredMedia>;

const readAll = (): MediaMap => {
  if (typeof window === 'undefined') return {};
  const raw = window.localStorage.getItem(KEY);
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as MediaMap)
      : {};
  } catch {
    return {};
  }
};

const writeAll = (media: MediaMap): void => {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(media));
  } catch {
    throw new MediaStoreFullError();
  }
};

export const getMedia = (mediaId: string): StoredMedia | null =>
  readAll()[mediaId] ?? null;

export const putMedia = (media: StoredMedia): void => {
  if (typeof window === 'undefined') return;
  if (media.sizeBytes > MAX_STORED_BYTES) throw new MediaStoreFullError();
  const all = readAll();
  all[media.mediaId] = media;
  writeAll(all);
};

export const removeMedia = (mediaId: string): void => {
  if (typeof window === 'undefined') return;
  const all = readAll();
  if (!(mediaId in all)) return;
  delete all[mediaId];
  writeAll(all);
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

/** Read, downscale and store one picked image; returns the stored record. */
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
  putMedia(stored);
  return stored;
};
