import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { unsafeQuery } from "../../database/core.js";
import { readSensaApiEnvironment } from "../../server/environment.js";
import type { PresignedMediaAssetDownload } from "../../mediaAssets/types.js";
import {
  isSensaAudioMimeType,
  type SensaMediaDownloadSource,
} from "./contracts.js";

const localCapabilityVersion = 1;
const localCapabilityLifetimeSeconds = 5 * 60;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const localCapabilityKey = randomBytes(32);
const localMediaCapabilitySchema = z.object({
  version: z.literal(localCapabilityVersion),
  mediaBlobId: z.string().min(1),
  sha256: z.string().regex(sha256Pattern),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  expiresAt: z.number().int(),
}).strict();

type LocalMediaCapabilityPayload = Readonly<{
  version: number;
  mediaBlobId: string;
  sha256: string;
  mimeType: string;
  sizeBytes: number;
  expiresAt: number;
}>;

type LocalMediaRequest = Readonly<{
  requestUrl: string;
  range: string | null;
}>;

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "cache-control": "no-store" },
  });
}

function base64UrlEncode(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function signCapability(body: string): string {
  return base64UrlEncode(createHmac("sha256", localCapabilityKey).update(body).digest());
}

function encodeCapability(payload: LocalMediaCapabilityPayload): string {
  const body = base64UrlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  return `${body}.${signCapability(body)}`;
}

function decodeCapability(token: string): LocalMediaCapabilityPayload | null {
  const [body, signature, ...extra] = token.split(".");
  if (body === undefined || signature === undefined || extra.length !== 0 || body === "" || signature === "") {
    return null;
  }
  let expectedSignature: Buffer;
  let actualSignature: Buffer;
  try {
    expectedSignature = base64UrlDecode(signCapability(body));
    actualSignature = base64UrlDecode(signature);
  } catch {
    return null;
  }
  if (expectedSignature.length !== actualSignature.length || !timingSafeEqual(expectedSignature, actualSignature)) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(base64UrlDecode(body).toString("utf8")) as unknown;
  } catch {
    return null;
  }
  const result = localMediaCapabilitySchema.safeParse(parsed);
  if (!result.success || !isSensaAudioMimeType(result.data.mimeType) || result.data.expiresAt <= Math.floor(Date.now() / 1_000)) return null;
  return result.data;
}

function requestPathPrefix(requestUrl: string): string {
  try {
    const pathname = new URL(requestUrl).pathname;
    const markerIndex = pathname.indexOf("/workspaces/");
    return markerIndex < 0 ? "" : pathname.slice(0, markerIndex);
  } catch {
    return "";
  }
}

function localMediaRoot(): string | null {
  const environment = readSensaApiEnvironment();
  const value = environment.SENSA_MEDIA_ROOT
    ?? environment.SENSA_LOCAL_CONTENT_MEDIA_ROOT;
  return value === undefined || value === "" ? null : value;
}

/**
 * Local bytes are deliberately a separate mode. Cognito/S3 deployments never
 * accept these capabilities, even if an operator accidentally leaves a local
 * media-root variable in the environment.
 */
export function isSensaLocalMediaEnabled(): boolean {
  const environment = readSensaApiEnvironment();
  return environment.AUTH_MODE === "none"
    && environment.ALLOW_INSECURE_LOCAL_AUTH === "true"
    && localMediaRoot() !== null;
}

export function createLocalMediaCapability(input: Readonly<{
  requestUrl: string;
  media: SensaMediaDownloadSource["media"];
}>): PresignedMediaAssetDownload {
  if (!isSensaLocalMediaEnabled()) {
    throw new Error("Local Sensa media is disabled outside insecure local auth with an explicit media root.");
  }
  const expiresAt = Math.floor(Date.now() / 1_000) + localCapabilityLifetimeSeconds;
  const token = encodeCapability({
    version: localCapabilityVersion,
    mediaBlobId: input.media.mediaBlobId,
    sha256: input.media.sha256,
    mimeType: input.media.mimeType,
    sizeBytes: input.media.sizeBytes,
    expiresAt,
  });
  const url = new URL(input.requestUrl);
  const prefix = requestPathPrefix(input.requestUrl);
  url.pathname = `${prefix}/sensa/media/local/${token}`;
  url.search = "";
  url.hash = "";
  return {
    method: "GET",
    url: url.toString(),
    expiresAt: new Date(expiresAt * 1_000).toISOString(),
    rangeRequests: true,
  };
}

function parseRangeHeader(value: string | null, sizeBytes: number): Readonly<{ start: number; end: number }> | null {
  if (value === null) return { start: 0, end: sizeBytes - 1 };
  if (!/^bytes=[0-9]*-[0-9]*$/u.test(value)) return null;
  const range = value.slice("bytes=".length);
  const [startText, endText] = range.split("-");
  if (startText === "" && endText === "") return null;
  if (startText === "") {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return {
      start: Math.max(0, sizeBytes - suffixLength),
      end: sizeBytes - 1,
    };
  }
  const start = Number(startText);
  if (!Number.isSafeInteger(start) || start < 0 || start >= sizeBytes) return null;
  const end = endText === "" ? sizeBytes - 1 : Number(endText);
  if (!Number.isSafeInteger(end) || end < start) return null;
  return { start, end: Math.min(end, sizeBytes - 1) };
}

async function canonicalMediaFile(mediaRootValue: string, sha256: string): Promise<string | null> {
  try {
    const root = await realpath(mediaRootValue);
    const rootStats = await stat(root);
    if (!rootStats.isDirectory()) return null;
    const candidate = path.resolve(root, `${sha256}.mp3`);
    if (path.dirname(candidate) !== root) return null;
    const actual = await realpath(candidate);
    if (actual !== candidate) return null;
    const fileStats = await stat(actual);
    return fileStats.isFile() ? actual : null;
  } catch {
    return null;
  }
}

/**
 * Serves only a verified, short-lived capability. The DB row and file bytes
 * are checked on every request so a stale token cannot mask an operator-side
 * content mutation or a wrong local root.
 */
export async function loadLocalMediaResponse(
  token: string,
  request: LocalMediaRequest,
): Promise<Response> {
  if (!isSensaLocalMediaEnabled()) return notFound();
  const capability = decodeCapability(token);
  const root = localMediaRoot();
  if (capability === null || root === null) return notFound();

  let rows;
  try {
    rows = await unsafeQuery<{
      media_blob_id: string;
      sha256: string;
      mime_type: string;
      size_bytes: string | number;
    }>(`
      SELECT media_blob_id::TEXT AS media_blob_id,
             sha256,
             mime_type,
             size_bytes
        FROM content.media_blobs
       WHERE media_blob_id = $1
         AND sha256 = $2
       LIMIT 1
    `, [capability.mediaBlobId, capability.sha256]);
  } catch {
    return notFound();
  }
  const row = rows.rows[0];
  const sizeBytes = row === undefined
    ? Number.NaN
    : typeof row.size_bytes === "number" ? row.size_bytes : Number(row.size_bytes);
  if (
    row === undefined
    || row.sha256 !== capability.sha256
    || row.mime_type !== capability.mimeType
    || !Number.isSafeInteger(sizeBytes)
    || sizeBytes !== capability.sizeBytes
  ) {
    return notFound();
  }

  const filePath = await canonicalMediaFile(root, capability.sha256);
  if (filePath === null) return notFound();
  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
  } catch {
    return notFound();
  }
  if (bytes.byteLength !== capability.sizeBytes || createHash("sha256").update(bytes).digest("hex") !== capability.sha256) {
    return notFound();
  }

  const selectedRange = parseRangeHeader(request.range, bytes.byteLength);
  const baseHeaders = {
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=300",
    "content-type": capability.mimeType,
    etag: `"${capability.sha256}"`,
  };
  if (selectedRange === null) {
    return new Response(null, {
      status: 416,
      headers: {
        ...baseHeaders,
        "content-length": "0",
        "content-range": `bytes */${bytes.byteLength}`,
      },
    });
  }
  const body = bytes.subarray(selectedRange.start, selectedRange.end + 1);
  const isPartial = request.range !== null;
  return new Response(new Uint8Array(body), {
    status: isPartial ? 206 : 200,
    headers: {
      ...baseHeaders,
      "content-length": String(body.byteLength),
      ...(isPartial ? { "content-range": `bytes ${selectedRange.start}-${selectedRange.end}/${bytes.byteLength}` } : {}),
    },
  });
}
