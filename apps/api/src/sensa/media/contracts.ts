import type { DatabaseExecutor } from "../../database/index.js";

/**
 * Sensa V1 supports the two established MP3 MIME aliases. Keep the value
 * returned by the Catalog/media registry unchanged; this is an allowlist, not
 * a normalization rule.
 */
export const sensaAudioMimeTypes = ["audio/mpeg", "audio/mp3"] as const;
export type SensaAudioMimeType = typeof sensaAudioMimeTypes[number];
export const sensaAudioMimeType = sensaAudioMimeTypes[0];

export function isSensaAudioMimeType(value: string): value is SensaAudioMimeType {
  return (sensaAudioMimeTypes as readonly string[]).includes(value);
}

export type SensaMediaDownloadInput = Readonly<{
  workspaceId: string;
  learnerUserId: string;
  senseEncounterId: string;
  learningActionId: string;
  learningAssetId: string;
}>;

export type SensaMediaDownloadSource = Readonly<{
  media: Readonly<{
    mediaBlobId: string;
    sha256: string;
    mimeType: SensaAudioMimeType;
    sizeBytes: number;
  }>;
  /** Internal only. The HTTP route must never serialize this field. */
  storageKey: string;
}>;

export type SensaMediaModule = Readonly<{
  loadDownloadSource(
    input: SensaMediaDownloadInput,
  ): Promise<SensaMediaDownloadSource>;
}>;

export type SensaMediaModuleOptions = Readonly<{
  /** Test-only executor seam; production uses one scoped read-only transaction. */
  executor?: DatabaseExecutor;
}>;
