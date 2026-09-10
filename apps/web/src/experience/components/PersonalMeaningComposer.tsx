import { previewStorage } from "../services/previewStorage";
import { useTranslation } from "react-i18next";
import { Plus, ImagePlus, X } from "lucide-react";
/**
 * The stable material editor.
 *
 * It asks for two things and nothing more: the material itself (free-form,
 * multimodal, unclassified) and an optional starting stance. There is
 * deliberately no Focus field, no Sense field and no target-expression field —
 * those are our domain model, not the learner's, and a separate input for the
 * target expression would quietly imply that filling it in confirms it.
 *
 * Saving here never calls the model. Entering clarification is a second,
 * explicit intent.
 */

import { useEffect, useRef, useState } from "react";
import { newUuid } from "../personalMeaningJourney/ids";
import { useJourneyGateway } from "../personalMeaningJourney";
import type { MaterialBlockInput } from "../personalMeaningJourney";
import { type ClarificationStartingPoint } from "../personalMeaningJourney/semanticAgent";
import {
  getMedia,
  removeMedia,
  storeImageFile,
} from "../personalMeaningJourney/mediaStore";

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
  const gateway = useJourneyGateway();
  const fileRef = useRef<HTMLInputElement>(null);
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
          const media = await getMedia(b.mediaId!);
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

  const handleClose = () => {
    if(persistence&&canSave&&!window.confirm("当前材料尚未保存，确定离开吗？"))return;
    if (!busy) onClose(); // Keep the in-progress material when the panel closes.
  };

  const updateBlock = (localId: string, bodyText: string) => {
    setBlocks((current) =>
      current.map((block) =>
        block.localId === localId ? { ...block, bodyText } : block,
      ),
    );
  };

  const removeBlock = (localId: string) => {
    setBlocks((current) => {
      const target = current.find((block) => block.localId === localId);
      if (target?.mediaId) removeMedia(target.mediaId);
      const next = current.filter((block) => block.localId !== localId);
      return next.length > 0 ? next : [textBlock()];
    });
  };

  const pickImage = async (file: File | undefined) => {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    try {
      const mediaId = newUuid();
      const stored = await storeImageFile(
        mediaId,
        file,
        new Date().toISOString(),
      );
      setBlocks((current) => [
        ...current,
        {
          localId: newUuid(),
          kind: "image",
          bodyText: "",
          mediaId,
          previewUrl: stored.dataUrl,
        },
      ]);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t("composer.imageError"),
      );
    } finally {
      setBusy(false);
    }
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
      const result = await gateway.createPersonalMeaning({
        operationId: newUuid(),
        blocks: payload,
        familiarExpression: familiarExpression.trim()
          ? { surfaceForm: familiarExpression.trim(), languageTag: "zh-CN" }
          : undefined,
        startingPoint,
      });
      onSaved(t("composer.saved"));
      return result.personalMeaningId;
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
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-[#3c51ad]";
  return (
    <div
      className="fixed inset-0 z-[110] flex justify-end bg-[#1f2937]/20"
      onMouseDown={handleClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="pmc-title"
        onMouseDown={(event) => event.stopPropagation()}
        className="flex h-full w-full flex-col bg-[#fbfbfa] text-[#222631] shadow-xl sm:max-w-xl"
      >
        <header className="flex items-center justify-between border-b border-[#e1e5ed] px-6 py-5 sm:px-8">
          <h2 id="pmc-title" className="text-xl font-medium">
            {t("composer.title")}
          </h2>
          <button
            className={action}
            disabled={busy}
            onClick={handleClose}
            aria-label={t("content.close")}
          >
            <X size={20} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-8 sm:px-8">
          <div className="space-y-4">
            {blocks.map((block, index) => (
              <div
                key={block.localId}
                className="relative rounded-xl border border-[#dce2ee] bg-white p-4"
              >
                {block.kind === "text" ? (
                  <textarea
                    autoFocus={index === 0}
                    aria-label={t("composer.placeholder")}
                    value={block.bodyText}
                    onChange={(event) =>
                      updateBlock(block.localId, event.target.value)
                    }
                    placeholder={t("composer.placeholder")}
                    rows={index === 0 ? 8 : 3}
                    className="w-full resize-y bg-transparent pr-5 text-base leading-8 outline-none disabled:opacity-50"
                    disabled={busy}
                  />
                ) : (
                  <img
                    src={block.previewUrl ?? ""}
                    alt={t("composer.imageAlt")}
                    className="max-h-72 w-full rounded-lg object-contain"
                  />
                )}
                {blocks.length > 1 && (
                  <button
                    className="absolute top-2 right-2 grid size-9 place-items-center rounded-lg text-[#7b8496] hover:bg-[#f0f2f8]"
                    disabled={busy}
                    onClick={() => removeBlock(block.localId)}
                    aria-label={t("composer.remove")}
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2 text-[#65718b]">
            <button
              className={action}
              disabled={busy}
              onClick={() => setBlocks((current) => [...current, textBlock()])}
            >
              <Plus size={16} />
              {t("composer.text")}
            </button>
            <button
              className={action}
              disabled={busy||!!persistence}
              onClick={() => fileRef.current?.click()}
              title={persistence?"本机图片保存尚未接入":""}
            >
              <ImagePlus size={17} />
              {t("composer.image")}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                void pickImage(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </div>
          <details className="mt-7 border-t border-[#e3e7ef] pt-5">
            <summary className="cursor-pointer text-sm text-[#778094]">
              {t("composer.optional")}
            </summary>
            <label className="mt-6 block text-sm">
              <span>{t("composer.familiar")}</span>
              <input
                value={familiarExpression}
                disabled={busy}
                onChange={(event) => setFamiliarExpression(event.target.value)}
                placeholder={t("composer.familiarHint")}
                maxLength={100}
                className="mt-3 min-h-12 w-full rounded-lg border border-[#e0e5ef] bg-white px-4"
              />
            </label>
            <fieldset className="mt-6 space-y-3">
              <legend className="mb-3 text-sm">{t("composer.stance")}</legend>
              {(
                ["from_experience", "from_sense", "from_expression"] as const
              ).map((value) => (
                <label
                  key={value}
                  className="flex items-center gap-3 text-sm text-[#68748c]"
                >
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={startingPoint === value}
                    onChange={() =>
                      setStartingPoint(startingPoint === value ? null : value)
                    }
                    className="size-4 accent-[#3c4b7c]"
                  />
                  {t(`composer.${value}`)}
                </label>
              ))}
            </fieldset>
          </details>
          {error && (
            <p className="mt-5 text-sm text-red-700" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="flex gap-3 border-t border-[#e1e5ed] bg-white px-6 py-5 sm:px-8">
          <button
            className={`${action} flex-1 bg-[#2f3b70] text-white`}
            disabled={!canSave || busy}
            onClick={() => void saveAndClarify()}
          >
            {t(busy ? "composer.saving" : "composer.clarify")}
          </button>
          <button
            className={`${action} text-[#65718b]`}
            disabled={!canSave || busy}
            onClick={() => void saveOnly()}
          >
            {t("composer.save")}
          </button>
        </footer>
      </section>
    </div>
  );
};
