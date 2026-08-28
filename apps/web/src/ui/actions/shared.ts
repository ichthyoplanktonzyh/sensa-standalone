import type { SensaStudyTarget } from "../../session";
import type { SensaExampleCard } from "../assets";
import type { useSensaAudio } from "../audio";

export type SensaAttemptVerdict = Readonly<{
  actionId: string;
  isCorrect: boolean | null;
  evaluationCode: string;
}>;

export type ActionRendererProps = Readonly<{
  target: SensaStudyTarget;
  audio: ReturnType<typeof useSensaAudio>;
  busy: boolean;
  verdict: SensaAttemptVerdict | null;
  accent: "美式" | "英式";
  pronunciationAutoplay: boolean;
  onRespond: (response: Readonly<Record<string, unknown>>) => void;
  onOpenExamples: (cards: readonly SensaExampleCard[], index: number) => void;
}>;

export const acknowledgement = { kind: "acknowledgement", acknowledged: true } as const;
