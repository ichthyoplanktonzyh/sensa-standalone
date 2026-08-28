import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Client } = pg;

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

const sourceRoot = argument("--source-root");
const databaseUrl = argument("--database-url", process.env.DATABASE_URL ?? null);
const destinationRoot = path.resolve(argument("--destination-root", "runtime-media/audio"));
const dryRun = process.argv.includes("--dry-run");
if (sourceRoot === null || databaseUrl === null) {
  throw new Error("Usage: node scripts/ingest-runtime-media.mjs --source-root <audio-root> --database-url <url> [--destination-root <dir>] [--dry-run]");
}

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  const result = await client.query(`
    SELECT DISTINCT blobs.sha256, blobs.size_bytes, blobs.mime_type, blobs.storage_key
      FROM content.media_blobs AS blobs
      JOIN sensa.audio_assets AS audio ON audio.media_blob_id = blobs.media_blob_id
     WHERE blobs.mime_type IN ('audio/mpeg', 'audio/mp3')
     ORDER BY blobs.sha256
  `);
  const manifest = [];
  if (!dryRun) await mkdir(destinationRoot, { recursive: true });
  for (const row of result.rows) {
    const sha256 = String(row.sha256);
    const source = path.resolve(sourceRoot, `${sha256}.mp3`);
    const destination = path.resolve(destinationRoot, `${sha256}.mp3`);
    if (path.dirname(source) !== path.resolve(sourceRoot) || path.dirname(destination) !== destinationRoot) {
      throw new Error(`Unsafe media path for ${sha256}`);
    }
    const sourceStats = await stat(source).catch(() => null);
    if (sourceStats === null || !sourceStats.isFile()) throw new Error(`Missing source media: ${source}`);
    if (Number(row.size_bytes) !== sourceStats.size) throw new Error(`Size mismatch for ${sha256}: DB=${row.size_bytes}, file=${sourceStats.size}`);
    const digest = createHash("sha256").update(await readFile(source)).digest("hex");
    if (digest !== sha256) throw new Error(`Digest mismatch for ${source}: ${digest}`);
    if (!dryRun) await copyFile(source, destination);
    manifest.push({ sha256, sizeBytes: sourceStats.size, mimeType: String(row.mime_type), storageKey: String(row.storage_key), source: "operator-selected-release", destination: path.relative(process.cwd(), destination) });
  }
  if (!dryRun) {
    await writeFile(path.join(destinationRoot, "../manifest.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), sourceCount: manifest.length, files: manifest }, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify({ dryRun, sourceRoot: path.resolve(sourceRoot), destinationRoot, copied: manifest.length, totalBytes: manifest.reduce((sum, item) => sum + item.sizeBytes, 0) }, null, 2));
} finally {
  await client.end();
}
