import {
  sensaIntakePayloadSchema,
  type CaptureSnapshot,
  type SemanticProposal,
  type SensaIntakePayload,
  type SensaSemanticResolutionProvenance,
} from '@sensa/contracts/sensa';

const utf16Offset = (value: string, codePointOffset: number): number =>
  Array.from(value).slice(0, codePointOffset).join('').length;

/**
 * Convert one browser capture into the port-neutral Semantic Intake contract.
 * Saving and accepting differ only in which facts are currently present; Web,
 * not this adapter, mechanically selects direct commit or Inbox.
 */
export const browserCaptureToIntake = (
  operationId: string,
  snapshot: CaptureSnapshot,
  proposal: SemanticProposal | null,
  resolutionProvenance: SensaSemanticResolutionProvenance | null = null,
): SensaIntakePayload => {
  const observed = snapshot.expression;
  const occurrence = observed ? {
    surfaceForm: observed.text,
    locator: {
      kind: 'text_span' as const,
      start: utf16Offset(snapshot.sentence, observed.start),
      end: utf16Offset(snapshot.sentence, observed.end),
    },
  } : null;
  const sourceReferenceId = snapshot.source.video
    ? `youtube:${snapshot.source.video.videoId}:${snapshot.source.video.startMs}-${snapshot.source.video.endMs}`
    : null;

  return sensaIntakePayloadSchema.parse({
    contractVersion: 'sensa-intake-v3',
    operationId,
    capturedAt: snapshot.source.capturedAt,
    context: {
      modality: 'text',
      textSegment: snapshot.sentence,
      mediaReferenceIds: [],
      languageTag: snapshot.language,
      source: {
        client: 'sensa-browser-extension',
        url: snapshot.source.url,
        title: snapshot.source.title || null,
        sourceReferenceId,
        domSelector: null,
        paragraphContext: null,
      },
    },
    expression: observed ? {
      surfaceForm: proposal?.expression.surface ?? observed.text,
      languageTag: proposal?.expression.language ?? snapshot.language,
      occurrence,
      expressionTypeHint: proposal?.expression.type ?? null,
    } : null,
    sense: proposal && resolutionProvenance ? {
      senseKey: null,
      semanticSpec: proposal.semanticSpec,
      wordingSource: 'llm_suggested',
      resolutionProvenance,
    } : null,
    acceptance: proposal && resolutionProvenance ? { mode: 'learner_direct' } : null,
  });
};
