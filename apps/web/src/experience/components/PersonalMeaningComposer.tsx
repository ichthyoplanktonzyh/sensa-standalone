import {localFlowText,localFlowNotice} from '../../i18n/localFlowText';
import { previewStorage } from "../services/previewStorage";
import { useTranslation } from "react-i18next";
import { Camera, Plus, ImagePlus, X } from "lucide-react";
/**
 * The stable material editor.
 *
 * It asks for two things and nothing more: the material itself (free-form,
 * multimodal, unclassified) and an optional starting stance. There is
 * deliberately no Focus field, no Sense field and no target-expression field —
 * those are our domain model, not the learner's, and a separate input for the
 * target expression would quietly imply that filling it in confirms it.
 *
 * Saving here never calls the model and never creates a Personal Meaning. It
 * creates an Inbox-owned clarification draft; only final confirmation can
 * atomically materialize the complete Personal Meaning.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { newUuid } from "../personalMeaningJourney/ids";
import { useJourneyGateway } from "../personalMeaningJourney";
import type { MaterialBlockInput } from "../personalMeaningJourney";
import { type ClarificationStartingPoint } from "../personalMeaningJourney/semanticAgent";
import { SensaOverlayLayout } from "../ui/SensaComponents";
import {
  MediaStoreFullError,
  readMedia,
  removeMedia,
  storeImageFile,
  useMediaStoreVersion,
} from "../personalMeaningJourney/mediaStore";
import {
  MAX_SCENE_IMAGES,
  useSceneImageInput,
} from "./useSceneImageInput";

export interface MaterialComposerPort {
  save: (input: {texts:string[]; familiarExpression:string; startingPoint:ClarificationStartingPoint|null}) => Promise<string>;
}
interface PersonalMeaningComposerProps {
  persistence?: MaterialComposerPort;
  open: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
  onCreated?: (personalMeaningId: string) => void;
}

interface DraftBlock {
  localId: string;
  kind: "text" | "image";
  bodyText: string;
  mediaId: string | null;
  previewUrl: string | null;
}

const textBlock = (): DraftBlock => ({
  localId: newUuid(),
  kind: "text",
  bodyText: "",
  mediaId: null,
  previewUrl: null,
});

export const PersonalMeaningComposer = ({
  open,
  onClose,
  onSaved,
  onCreated,
  persistence,
}: PersonalMeaningComposerProps) => {
  const { t } = useTranslation();
  useMediaStoreVersion();
  const gateway = useJourneyGateway();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [savedDraft] = useState(() => {
    if(persistence)return null;
    try {
      const value = JSON.parse(
        previewStorage.getItem("content-composer-draft") ?? "null",
      );
      if (
        !value ||
        !Array.isArray(value.blocks) ||
        typeof value.familiarExpression !== "string" ||
        ![null, "from_experience", "from_sense", "from_expression"].includes(value.startingPoint) ||
        !value.blocks.every(
          (b: DraftBlock) =>
            typeof b.localId === "string" &&
            typeof b.bodyText === "string" &&
            (b.kind === "text" || b.kind === "image"),
        )
      )
        return null;
      return value as {
        blocks: DraftBlock[];
        familiarExpression: string;
        startingPoint: ClarificationStartingPoint | null;
      };
    } catch {
      return null;
    }
  });
  const [blocks, setBlocks] = useState<DraftBlock[]>(
    savedDraft?.blocks.length ? savedDraft.blocks : [textBlock()],
  );
  const [familiarExpression, setFamiliarExpression] = useState(
    savedDraft?.familiarExpression ?? "",
  );
  const [startingPoint, setStartingPoint] =
    useState<ClarificationStartingPoint | null>(
      savedDraft?.startingPoint ?? null,
    );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if(persistence)return;
    try {
      previewStorage.setItem(
        "content-composer-draft",
        JSON.stringify({
          blocks: blocks.map((b) => ({ ...b, previewUrl: null })),
          familiarExpression,
          startingPoint,
        }),
      );
    } catch {
      setError(t("composer.draftError"));
    }
  }, [blocks, familiarExpression, startingPoint, t]);
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      (savedDraft?.blocks ?? [])
        .filter((b) => b.mediaId)
        .map(async (b) => {
          const media = await readMedia(b.mediaId!);
          if (!cancelled && media)
            setBlocks((current) =>
              current.map((block) =>
                block.localId === b.localId
                  ? { ...block, previewUrl: media.dataUrl }
                  : block,
              ),
            );
        }),
    ).catch(() => {
      if (!cancelled) setError(t("composer.imageError"));
    });
    return () => {
      cancelled = true;
    };
  }, [savedDraft, t]);

  const filled = blocks.filter((block) =>
    block.kind === "text" ? block.bodyText.trim() : block.mediaId,
  );
  const canSave = filled.length > 0 || Boolean(familiarExpression.trim());
  const imageCount = blocks.filter((block) => block.kind === "image" && block.mediaId).length;

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const reset = () => {
    setBlocks([textBlock()]);
    setFamiliarExpression("");
    setStartingPoint(null);
    setError("");
    setBusy(false);
  };

  const updateBlock = (localId: string, bodyText: string) => {
    setBlocks((current) =>
      current.map((block) =>
        block.localId === localId ? { ...block, bodyText } : block,
      ),
    );
  };

  const removeBlock = (localId: string) => {
    const target = blocks.find((block) => block.localId === localId);
    if (target?.mediaId) void removeMedia(target.mediaId).catch(() => setError(t("composer.imageError")));
    setBlocks((current) => {
      const next = current.filter((block) => block.localId !== localId);
      return next.length > 0 ? next : [textBlock()];
    });
  };

  const addImageFiles = useCallback(async (files: File[]) => {
    const additions: DraftBlock[] = [];
    let failure: unknown = null;
    for (const file of files) {
      try {
        const mediaId = newUuid();
        const stored = await storeImageFile(
          mediaId,
          file,
          new Date().toISOString(),
        );
        additions.push({
          localId: newUuid(),
          kind: "image",
          bodyText: "",
          mediaId,
          previewUrl: stored.dataUrl,
        });
      } catch (cause) {
        failure = cause;
        break;
      }
    }
    if (additions.length > 0) {
      setBlocks((current) => [...current, ...additions]);
    }
    if (failure) throw failure;
  }, []);

  const sceneImages = useSceneImageInput({
    disabled: busy || Boolean(persistence),
    imageCount,
    onAddFiles: addImageFiles,
    onStart: () => setError(""),
    onRejected: () => setError("localFlow.sceneImageRequirements"),
    onFailed: (cause) => setError(
      cause instanceof MediaStoreFullError
        ? "localFlow.sceneStorageFull"
        : t("composer.imageError"),
    ),
  });

  const unavailable = busy || sceneImages.processing;

  const handleClose = () => {
    if(persistence&&canSave&&!window.confirm(localFlowText('unsavedSource')))return;
    if (!unavailable) onClose(); // Keep the in-progress material when the panel closes.
  };

  const save = async (): Promise<string | null> => {
    setError("");
    setBusy(true);
    try {
      if(persistence){const id=await persistence.save({texts:filled.filter(b=>b.kind==='text').map(b=>b.bodyText.trim()),familiarExpression:familiarExpression.trim(),startingPoint});onSaved(t("composer.saved"));return id;}
      const payload: MaterialBlockInput[] = filled.map((block) =>
        block.kind === "image"
          ? { kind: "image", personalMediaObjectId: block.mediaId! }
          : { kind: "text", bodyText: block.bodyText.trim() },
      );
      const result = await gateway.createClarificationDraft({
        operationId: newUuid(),
        blocks: payload,
        familiarExpression: familiarExpression.trim()
          ? { surfaceForm: familiarExpression.trim() }
          : undefined,
        startingPoint,
      });
      onSaved(t("composer.saved"));
      return result.intakeId;
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t("composer.saveError"),
      );
      return null;
    } finally {
      setBusy(false);
    }
  };

  const saveAndClarify = async () => {
    const personalMeaningId = await save();
    if (!personalMeaningId) return;
    reset();
    onCreated?.(personalMeaningId);
  };

  const saveOnly = async () => {
    const personalMeaningId = await save();
    if (!personalMeaningId) return;
    reset();
    onClose();
  };

  if (!open) return null;

  const action =
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-4 text-sm disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-focus";
  return (
    <SensaOverlayLayout
      variant="sheet"
      measure="standard"
      className="sensa-context-composer z-[110]"
      labelledBy="pmc-title"
      onDismiss={handleClose}
      dismissOnBackdrop
      regions={{
        header: <div className="flex items-center justify-between">
          <h2 id="pmc-title" className="text-xl font-medium">
            {t("composer.title")}
          </h2>
          <button
            className={action}
            disabled={unavailable}
            onClick={handleClose}
            aria-label={t("content.close")}
          >
            <X size={20} />
          </button>
        </div>,
        primary: <div
          onDragOver={sceneImages.onDragOver}
          onDragLeave={sceneImages.onDragLeave}
          onDrop={sceneImages.onDrop}
          data-dragging={sceneImages.dragging}
          aria-busy={sceneImages.processing || undefined}
          className="rounded-card data-[dragging=true]:ring-2 data-[dragging=true]:ring-focus"
        >
          <p
            role="status"
            aria-live="polite"
            className={sceneImages.dragging
              ? "pointer-events-none mb-4 rounded-control border border-dashed border-border-strong bg-accent-soft p-4 text-center text-sm text-fg-secondary"
              : "sr-only"}
          >
            {sceneImages.dragging
              ? localFlowText('dropImages')
              : sceneImages.processing ? localFlowText('readingImages') : ''}
          </p>
          <div className="space-y-4">
            {blocks.map((block, index) => (
              <div
                key={block.localId}
                className="relative rounded-card border border-border-subtle bg-surface-panel p-4"
              >
                {block.kind === "text" ? (
                  <textarea
                    autoFocus={index === 0}
                    aria-label={t("composer.placeholder")}
                    value={block.bodyText}
                    onPaste={sceneImages.onPaste}
                    onChange={(event) =>
                      updateBlock(block.localId, event.target.value)
                    }
                    placeholder={t("composer.placeholder")}
                    rows={index === 0 ? 8 : 3}
                    className="w-full resize-y bg-transparent pr-10 text-base leading-8 outline-none focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50"
                    disabled={unavailable}
                  />
                ) : (
                  <img
                    src={block.previewUrl ?? ""}
                    alt={t("composer.imageAlt")}
                    className="max-h-72 w-full rounded-control object-contain"
                  />
                )}
                {blocks.length > 1 && (
                  <button
                    className="absolute top-2 right-2 grid size-11 place-items-center rounded-control text-fg-tertiary hover:bg-surface-selected focus-visible:outline-2 focus-visible:outline-focus"
                    disabled={unavailable}
                    onClick={() => removeBlock(block.localId)}
                    aria-label={t("composer.remove")}
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-fg-secondary">
            <button
              className={action}
              disabled={unavailable}
              onClick={() => setBlocks((current) => [...current, textBlock()])}
            >
              <Plus size={16} />
              {t("composer.text")}
            </button>
            <button
              className={action}
              disabled={unavailable||!!persistence||imageCount >= MAX_SCENE_IMAGES}
              onClick={() => fileRef.current?.click()}
              title={persistence?localFlowText('imagesUnavailable'):""}
            >
              <ImagePlus size={17} />
              {t("composer.image")}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              disabled={unavailable||!!persistence||imageCount >= MAX_SCENE_IMAGES}
              onChange={(event) => {
                void sceneImages.addFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
            <button
              className={action}
              disabled={unavailable||!!persistence||imageCount >= MAX_SCENE_IMAGES}
              onClick={() => cameraRef.current?.click()}
              title={persistence?localFlowText('imagesUnavailable'):""}
            >
              <Camera size={17} aria-hidden="true" />
              {t("composer.camera")}
            </button>
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              disabled={unavailable||!!persistence||imageCount >= MAX_SCENE_IMAGES}
              onChange={(event) => {
                void sceneImages.addFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
            <span className="ml-auto text-xs text-fg-tertiary">
              {localFlowText('sceneImageCount',{count:imageCount,max:MAX_SCENE_IMAGES})}
            </span>
          </div>
          <details className="mt-7 border-t border-border-subtle pt-5">
            <summary className="cursor-pointer text-sm text-fg-tertiary">
              {t("composer.optional")}
            </summary>
            <label className="mt-6 block text-sm">
              <span>{t("composer.familiar")}</span>
              <input
                value={familiarExpression}
                disabled={unavailable}
                onChange={(event) => setFamiliarExpression(event.target.value)}
                placeholder={t("composer.familiarHint")}
                maxLength={100}
                className="mt-3 min-h-12 w-full rounded-control border border-border-strong bg-surface-panel px-4 focus-visible:outline-2 focus-visible:outline-focus"
              />
            </label>
            <fieldset className="mt-6 space-y-3">
              <legend className="mb-3 text-sm">{t("composer.stance")}</legend>
              {(
                ["from_experience", "from_sense", "from_expression"] as const
              ).map((value) => (
                <label
                  key={value}
                  className="flex items-center gap-3 text-sm text-fg-secondary"
                >
                  <input
                    type="checkbox"
                    disabled={unavailable}
                    checked={startingPoint === value}
                    onChange={() =>
                      setStartingPoint(startingPoint === value ? null : value)
                    }
                    className="size-4 accent-action-primary"
                  />
                  {t(`composer.${value}`)}
                </label>
              ))}
            </fieldset>
          </details>
          {error && (
            <p className="mt-5 text-sm text-feedback-danger" role="alert">
              {localFlowNotice(error)}
            </p>
          )}
        </div>,
        controls: <div className="flex gap-3">
          <button
            className={`${action} flex-1 bg-action-primary text-action-on-primary hover:bg-action-primary-hover`}
            disabled={!canSave || unavailable}
            onClick={() => void saveAndClarify()}
          >
            {t(busy ? "composer.saving" : "composer.clarify")}
          </button>
          <button
            className={`${action} text-fg-secondary hover:bg-surface-selected`}
            disabled={!canSave || unavailable}
            onClick={() => void saveOnly()}
          >
            {t("composer.save")}
          </button>
        </div>,
      }}
    />
  );
};
