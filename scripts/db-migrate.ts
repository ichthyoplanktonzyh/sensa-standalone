#!/usr/bin/env tsx

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const databaseUrl = process.env.MIGRATION_DATABASE_URL
  ?? process.env.SENSA_DATABASE_URL
  ?? process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.trim() === "") {
  throw new Error("DATABASE_URL or SENSA_DATABASE_URL is required");
}

const migrationDirectory = path.resolve(process.cwd(), "db/migrations");
const client = new pg.Client({ connectionString: databaseUrl });

async function main(): Promise<void> {
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.sensa_schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const migrationFiles = (await readdir(migrationDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));

    for (const filename of migrationFiles) {
      const existing = await client.query<{ filename: string }>(
        "SELECT filename FROM public.sensa_schema_migrations WHERE filename = $1",
        [filename],
      );
      if (existing.rowCount !== 0) continue;

      const sql = await readFile(path.join(migrationDirectory, filename), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO public.sensa_schema_migrations (filename) VALUES ($1)",
          [filename],
        );
        await client.query("COMMIT");
        console.log(`applied ${filename}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(
          `Failed to apply ${filename}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
