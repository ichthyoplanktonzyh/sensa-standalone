#!/usr/bin/env npx tsx
/**
 * Standalone Sensa Package Validator CLI.
 *
 * The validator is a package in this repository; content production must not
 * import the legacy flashcard backend just to check a candidate.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  validateSenseLearningPackage,
  type SenseLearningPackageCandidate,
} from "../../packages/content-validator/src/packageValidator.js";

function main(): void {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npx tsx content/tools/run_validator.ts <candidate_json_path>");
    process.exit(1);
  }

  const absolutePath = resolve(process.cwd(), filePath);
  const candidate = JSON.parse(
    readFileSync(absolutePath, "utf-8"),
  ) as SenseLearningPackageCandidate;
  const report = validateSenseLearningPackage(candidate);

  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "satisfied") {
    process.exit(2);
  }
}

main();
