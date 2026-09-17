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
  onAddFiles: (files: File[]) => Promise<void>;
  onStart?: () => void;
  onRejected: () => void;
  onFailed: (cause: unknown) => void;
}

/** Shared drag, paste and picker coordination for scene image entry points. */
export function useSceneImageInput({
  disabled,
  imageCount,
  onAddFiles,
  onStart,
  onRejected,
  onFailed,
}: SceneImageInputOptions) {
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const processingRef = useRef(false);

  useEffect(() => {
    if (disabled) setDragging(false);
  }, [disabled]);

  const addFiles = useCallback(async (files: readonly File[]) => {
    if (disabled || processingRef.current || files.length === 0) return;
    onStart?.();
    const selection = selectSceneImageFiles(files, imageCount);
    if (selection.rejected) onRejected();
    if (selection.accepted.length === 0) return;

    processingRef.current = true;
    setProcessing(true);
    try {
      await onAddFiles(selection.accepted);
    } catch (cause) {
      onFailed(cause);
    } finally {
      processingRef.current = false;
      setProcessing(false);
      setDragging(false);
    }
  }, [disabled, imageCount, onAddFiles, onFailed, onRejected, onStart]);

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
    dragging,
    processing,
    onDragOver,
    onDragLeave,
    onDrop,
    onPaste,
  };
}
