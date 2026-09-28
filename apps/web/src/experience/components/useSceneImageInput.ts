import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
} from 'react';

export const MAX_SCENE_IMAGES = 3;
export const MAX_SCENE_IMAGE_SOURCE_BYTES = 8 * 1024 * 1024;

export interface SceneImageSelection {
  accepted: File[];
  rejected: boolean;
}

export interface SceneImageAttemptStatus {
  fileKey: string;
  fileName: string;
  state: 'added' | 'failed';
  cause?: unknown;
}

export interface SceneImageProcessingResult {
  statuses: SceneImageAttemptStatus[];
  rejected: boolean;
}

const fileName = (file: File): string => file.name.trim() || 'image';

/** Content identity makes a repeated picker/drop retry independent of a new
 * File object, filename changes, or file ordering. */
export async function sceneImageFileKey(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}

/** Process a multi-image attempt without replaying files that already
 * succeeded in an earlier partial attempt. Failures do not prevent later files
 * in the same selection from being tried. */
export async function processSceneImageFiles(
  files: readonly File[],
  currentCount: number,
  completedFileKeys: Set<string>,
  onAddFile: (file: File, fileKey: string) => Promise<void>,
): Promise<SceneImageProcessingResult> {
  const statuses: SceneImageAttemptStatus[] = [];
  const attempted = new Set<string>();
  let added = 0;
  let rejected = false;

  for (const file of files) {
    if (!file.type.startsWith('image/') || file.size > MAX_SCENE_IMAGE_SOURCE_BYTES) {
      rejected = true;
      continue;
    }
    let fileKey: string;
    try {
      fileKey = await sceneImageFileKey(file);
    } catch (cause) {
      statuses.push({
        fileKey: `unreadable:${statuses.length}:${fileName(file)}`,
        fileName: fileName(file),
        state: 'failed',
        cause,
      });
      continue;
    }
    if (completedFileKeys.has(fileKey) || attempted.has(fileKey)) continue;
    attempted.add(fileKey);
    if (currentCount + added >= MAX_SCENE_IMAGES) {
      rejected = true;
      continue;
    }
    try {
      await onAddFile(file, fileKey);
      completedFileKeys.add(fileKey);
      added += 1;
      statuses.push({fileKey, fileName: fileName(file), state: 'added'});
    } catch (cause) {
      statuses.push({fileKey, fileName: fileName(file), state: 'failed', cause});
    }
  }
  return {statuses, rejected};
}

/**
 * Apply the same image boundary at every learner-owned scene entry point.
 * `accept` on a file input is only a picker hint, so the files still need to
 * be checked here before they are decoded or persisted.
 */
export function selectSceneImageFiles(
  files: readonly File[],
  currentCount: number,
): SceneImageSelection {
  const remaining = Math.max(0, MAX_SCENE_IMAGES - currentCount);
  const accepted: File[] = [];
  let rejected = false;

  for (const file of files) {
    if (!file.type.startsWith('image/') || file.size > MAX_SCENE_IMAGE_SOURCE_BYTES) {
      rejected = true;
      continue;
    }
    if (accepted.length >= remaining) {
      rejected = true;
      continue;
    }
    accepted.push(file);
  }

  return { accepted, rejected };
}

function clipboardImageFiles(data: DataTransfer): File[] {
  const direct = Array.from(data.files).filter((file) => file.type.startsWith('image/'));
  if (direct.length > 0) return direct;
  return Array.from(data.items)
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

interface SceneImageInputOptions {
  disabled: boolean;
  imageCount: number;
  onAddFile: (file: File, fileKey: string) => Promise<void>;
  onStart?: () => void;
  onRejected: () => void;
  onFailed: (failures: readonly SceneImageAttemptStatus[]) => void;
  onComplete?: (result: SceneImageProcessingResult) => void;
}

/** Shared drag, paste and picker coordination for scene image entry points. */
export function useSceneImageInput({
  disabled,
  imageCount,
  onAddFile,
  onStart,
  onRejected,
  onFailed,
  onComplete,
}: SceneImageInputOptions) {
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [statuses, setStatuses] = useState<SceneImageAttemptStatus[]>([]);
  const processingRef = useRef(false);
  const completedFileKeys = useRef(new Set<string>());

  useEffect(() => {
    if (disabled) setDragging(false);
  }, [disabled]);

  const addFiles = useCallback(async (files: readonly File[]) => {
    if (disabled || processingRef.current || files.length === 0) return;
    onStart?.();
    processingRef.current = true;
    setProcessing(true);
    setStatuses([]);
    try {
      const result = await processSceneImageFiles(files, imageCount, completedFileKeys.current, onAddFile);
      setStatuses(result.statuses);
      if (result.rejected) onRejected();
      const failures = result.statuses.filter((status) => status.state === 'failed');
      if (failures.length > 0) onFailed(failures);
      onComplete?.(result);
    } finally {
      processingRef.current = false;
      setProcessing(false);
      setDragging(false);
    }
  }, [disabled, imageCount, onAddFile, onComplete, onFailed, onRejected, onStart]);

  const forgetFile = useCallback((fileKey: string | null | undefined) => {
    if (!fileKey) return;
    completedFileKeys.current.delete(fileKey);
    setStatuses((current) => current.filter((status) => status.fileKey !== fileKey));
  }, []);

  const clearStatuses = useCallback(() => {
    completedFileKeys.current.clear();
    setStatuses([]);
  }, []);

  const onDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    if (!disabled && !processingRef.current) setDragging(true);
  }, [disabled]);

  const onDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDragging(false);
    }
  }, []);

  const onDrop = useCallback((event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    setDragging(false);
    if (!disabled) void addFiles(Array.from(event.dataTransfer.files));
  }, [addFiles, disabled]);

  const onPaste = useCallback((event: ClipboardEvent<HTMLElement>) => {
    const images = clipboardImageFiles(event.clipboardData);
    if (images.length === 0 || disabled || processingRef.current) return;
    event.preventDefault();
    void addFiles(images);
  }, [addFiles, disabled]);

  return {
    addFiles,
    statuses,
    forgetFile,
    clearStatuses,
    dragging,
    processing,
    onDragOver,
    onDragLeave,
    onDrop,
    onPaste,
  };
}
