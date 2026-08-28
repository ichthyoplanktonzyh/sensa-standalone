#!/usr/bin/env python3
"""Read-only batch/release validation for Sensa Package candidates.

The TypeScript Package Validator is authoritative for per-Sense requirements.
This command adds release-level checks that the single-package function cannot
perform: shared snapshot coherence, media files, sidecar reports/manifests,
missing packages, and orphan media.  It reports candidate completeness
separately from the public ``>= 1,000`` distinct eligible Lexeme gate.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from mutagen.mp3 import MP3
except ImportError:  # pragma: no cover - environment diagnostic is reported below
    MP3 = None

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PACKAGES_DIR = ROOT / "data" / "packages"
DEFAULT_ASSETS_DIR = ROOT / "data" / "assets"
DEFAULT_PROFILES_DIR = ROOT / "data" / "profiles"
DEFAULT_MEDIA_DIR = ROOT / "data" / "media"
DEFAULT_DB_PATH = ROOT / "data" / "senses.db"
MIN_PUBLIC_LEXEMES = 1000
CAPABILITY_RESOLVER_VERSION = "sensa-executable-learning-capability-resolver-v1"
LEGACY_PACKAGE_VALIDATOR_VERSION = "sensa-package-validator-v1"
LEGACY_CONTENT_SCHEMA_VERSION = "sensa-content-kernel-v1"
LEGACY_DETERMINISTIC_REVIEW_SCHEMA_VERSION = "sensa-deterministic-text-review-v1"
LEGACY_SEMANTIC_REVIEW_SCHEMA_VERSION = "sensa-automated-semantic-review-v1"

sys.path.insert(0, str(ROOT))
from tools.automated_review import (  # noqa: E402
    build_review_input_from_authoring,
    review_is_approved,
    sha256_json,
)
from tools.lexeme_forms import verified_release_lexeme_forms  # noqa: E402


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _run_validator(candidate_path: Path) -> dict[str, Any]:
    tsx_path = ROOT.parent / "node_modules" / ".bin" / "tsx"
    process = subprocess.run(
        [str(tsx_path), str(ROOT / "tools" / "run_validator.ts"), str(candidate_path)],
        cwd=str(ROOT.parent),
        capture_output=True,
        text=True,
    )
    try:
        report = json.loads(process.stdout)
        if isinstance(report, dict):
            return report
    except json.JSONDecodeError:
        pass
    return {
        "status": "invalid",
        "validatorVersion": "sensa-package-validator-v3",
        "capabilityResolverVersion": CAPABILITY_RESOLVER_VERSION,
        "packageDigest": "",
        "requirements": [],
        "issues": [{"code": "validator.output_invalid", "path": "$", "message": process.stderr or process.stdout}],
    }


def _finding(findings: list[dict[str, str]], severity: str, code: str, message: str, path: str = "$") -> None:
    findings.append({"severity": severity, "code": code, "path": path, "message": message})


def _media_file(media_dir: Path, media_sha: str) -> Path | None:
    if not isinstance(media_sha, str) or not media_sha:
        return None
    direct = media_dir / "audio" / f"{media_sha}.mp3"
    if direct.exists():
        return direct
    for path in media_dir.rglob(f"{media_sha}.*") if media_dir.exists() else []:
        if path.is_file():
            return path
    return None


def _check_media(candidate: dict[str, Any], media_dir: Path, findings: list[dict[str, str]]) -> set[str]:
    referenced: set[str] = set()
    for asset in candidate.get("assets", []):
        if not isinstance(asset, dict) or asset.get("kind") not in {"pronunciation_audio", "study_example_audio", "extended_audio", "visual_grounding"}:
            continue
        media_sha = asset.get("mediaSha256")
        if isinstance(media_sha, str):
            referenced.add(media_sha)
        path = _media_file(media_dir, media_sha)
        asset_id = str(asset.get("learningAssetId"))
        if path is None:
            _finding(findings, "error", "media.missing", f"{asset_id}: referenced media file is missing", asset_id)
            continue
        expected_size = asset.get("sizeBytes")
        actual_size = path.stat().st_size
        if actual_size <= 0 or actual_size != expected_size:
            _finding(findings, "error", "media.size_mismatch", f"{asset_id}: expected {expected_size}, found {actual_size}", asset_id)
        if _sha256_file(path) != media_sha:
            _finding(findings, "error", "media.hash_mismatch", f"{asset_id}: media SHA-256 does not match candidate", asset_id)
        if asset.get("kind") in {"pronunciation_audio", "study_example_audio", "extended_audio"}:
            if MP3 is None:
                _finding(findings, "error", "media.metadata_unavailable", f"{asset_id}: mutagen is required to verify MP3 metadata", asset_id)
            else:
                try:
                    duration_ms = int(round(float(MP3(str(path)).info.length) * 1000))
                except Exception as exc:
                    _finding(findings, "error", "media.metadata_invalid", f"{asset_id}: MP3 metadata invalid: {exc}", asset_id)
                else:
                    if duration_ms <= 0 or duration_ms != asset.get("durationMs"):
                        _finding(findings, "error", "media.duration_mismatch", f"{asset_id}: expected duration {asset.get('durationMs')}, found {duration_ms}", asset_id)
        expected_mime = asset.get("mimeType")
        actual_mime = mimetypes.guess_type(path.name)[0]
        accepted_mimes = {expected_mime, actual_mime}
        if expected_mime in {"audio/mp3", "audio/mpeg"} and actual_mime in {"audio/mp3", "audio/mpeg"}:
            accepted_mimes = {expected_mime}
        if expected_mime and actual_mime and expected_mime != actual_mime and accepted_mimes != {expected_mime}:
            _finding(findings, "error", "media.mime_mismatch", f"{asset_id}: expected {expected_mime}, found {actual_mime}", asset_id)
    return referenced


def _approved_lexeme_forms(
    *,
    db_path: Path,
    assets_dir: Path,
    profiles_dir: Path,
    lemma: str,
) -> set[str]:
    """Return only forms in the independently sourced dictionary inventory."""

    conn = sqlite3.connect(f"{db_path.resolve().as_uri()}?mode=ro", uri=True)
    conn.execute("PRAGMA query_only = ON")
    try:
        return {
            value.casefold()
            for value in verified_release_lexeme_forms(
                conn,
                lemma,
            )
        }
    finally:
        conn.close()


def validate_release(
    *,
    packages_dir: Path,
    assets_dir: Path,
    profiles_dir: Path,
    media_dir: Path,
    expected_senses_path: Path | None = None,
    db_path: Path = DEFAULT_DB_PATH,
    require_public_gate: bool = False,
) -> dict[str, Any]:
    findings: list[dict[str, str]] = []
    package_paths = sorted(packages_dir.glob("*.candidate.json")) if packages_dir.exists() else []
    package_reports: list[dict[str, Any]] = []
    shared_entities: dict[str, dict[str, str]] = {}
    entity_packages: dict[str, set[str]] = {}
    conflicted_entities: set[str] = set()
    referenced_media: set[str] = set()
    profile_senses = {path.stem for path in profiles_dir.glob("*.json")} if profiles_dir.exists() else set()
    candidate_senses: set[str] = set()
    eligible_by_sense: dict[str, bool] = {}
    approved_form_cache: dict[str, set[str]] = {}

    expected_senses = None
    if expected_senses_path is not None:
        if not expected_senses_path.exists():
            _finding(findings, "error", "curriculum.manifest_missing", f"Expected Sense manifest is missing: {expected_senses_path}", expected_senses_path.as_posix())
        else:
            try:
                expected_value = _load_json(expected_senses_path)
            except (OSError, json.JSONDecodeError) as exc:
                _finding(findings, "error", "curriculum.manifest_invalid", f"Expected Sense manifest cannot be read: {exc}", expected_senses_path.as_posix())
                expected_value = None
            if isinstance(expected_value, list):
                expected_senses = {str(item) for item in expected_value}
            elif isinstance(expected_value, dict):
                values = expected_value.get("senses") or expected_value.get("senseIds") or []
                expected_senses = {str(item) for item in values}

    def record_shared(key: str, snapshot: str, package_name: str, sense_id: str) -> None:
        entity_packages.setdefault(key, set()).add(sense_id)
        previous = shared_entities.get(key)
        if previous and previous["snapshot"] != snapshot:
            conflicted_entities.add(key)
            _finding(
                findings,
                "error",
                "entity.shared_snapshot_conflict",
                f"{key} differs between {previous['package']} and {package_name}",
                key,
            )
        else:
            shared_entities.setdefault(key, {"package": package_name, "snapshot": snapshot})

    for package_path in package_paths:
        package_error_start = sum(1 for finding in findings if finding["severity"] == "error")
        try:
            candidate = _load_json(package_path)
        except (OSError, json.JSONDecodeError) as exc:
            _finding(findings, "error", "package.invalid_json", f"{package_path.name}: {exc}", package_path.name)
            continue
        if not isinstance(candidate, dict):
            _finding(findings, "error", "package.invalid_shape", f"{package_path.name}: candidate must be an object", package_path.name)
            continue
        sense = str((candidate.get("senseVersion") or {}).get("senseId") or package_path.stem.replace(".candidate", ""))
        release = candidate.get("release") if isinstance(candidate.get("release"), dict) else {}
        legacy_snapshot = (
            release.get("validatorVersion") == LEGACY_PACKAGE_VALIDATOR_VERSION
            or release.get("schemaVersion") == LEGACY_CONTENT_SCHEMA_VERSION
        )
        candidate_senses.add(sense)
        report = _run_validator(package_path)
        if report.get("capabilityResolverVersion") != CAPABILITY_RESOLVER_VERSION:
            _finding(findings, "error", "validator.capability_resolver_version_invalid", f"{package_path.name}: Validator returned an unsupported Capability Resolver version", package_path.name)
        validator_status = report.get("status")
        if validator_status not in {"satisfied", "incomplete", "invalid"}:
            _finding(findings, "error", "validator.status_invalid", f"{package_path.name}: Validator returned invalid status {validator_status!r}", package_path.name)
            validator_status = "invalid"
        package_entry: dict[str, Any] = {
            "senseId": sense,
            "package": package_path.name,
            "validator": report,
            "validatorStatus": validator_status,
        }
        validation_sidecar = packages_dir / f"{sense}.validation.json"
        sidecar: dict[str, Any] | None = None
        if not validation_sidecar.exists():
            _finding(findings, "error", "report.missing_package_report", f"Missing validation sidecar for {sense}", validation_sidecar.as_posix())
        else:
            try:
                sidecar = _load_json(validation_sidecar)
                if not isinstance(sidecar, dict):
                    raise ValueError("sidecar must be an object")
                legacy_sidecar = legacy_snapshot and sidecar.get("validatorVersion") == LEGACY_PACKAGE_VALIDATOR_VERSION
                if sidecar.get("packageDigest") != report.get("packageDigest") and not legacy_sidecar:
                    _finding(findings, "error", "report.package_digest_mismatch", f"Validation sidecar digest does not match Validator output for {sense}", validation_sidecar.as_posix())
                if sidecar.get("validatorVersion") != report.get("validatorVersion") and not legacy_sidecar:
                    _finding(findings, "error", "report.validator_version_mismatch", f"Validation sidecar validator version does not match for {sense}", validation_sidecar.as_posix())
                if sidecar.get("capabilityResolverVersion") != report.get("capabilityResolverVersion"):
                    _finding(findings, "error", "report.capability_resolver_version_mismatch", f"Validation sidecar Capability Resolver version does not match for {sense}", validation_sidecar.as_posix())
            except (OSError, json.JSONDecodeError, AttributeError, ValueError) as exc:
                _finding(findings, "error", "report.invalid_package_report", f"Invalid validation sidecar for {sense}: {exc}", validation_sidecar.as_posix())

        sidecar_status = sidecar.get("status") if sidecar else None
        # The frozen Validator is authoritative.  A sidecar may only downgrade
        # a fresh satisfied result (for example, an assembler preflight); it
        # can never upgrade an incomplete/invalid Validator result.
        effective_status = validator_status
        if validator_status == "satisfied" and sidecar_status in {"incomplete", "invalid"}:
            effective_status = sidecar_status
        package_entry["effectiveStatus"] = effective_status
        if effective_status != "satisfied":
            _finding(findings, "error", "package.not_complete", f"{package_path.name}: effective status={effective_status}", package_path.name)

        lexeme = candidate.get("lexemeVersion") or {}
        lexeme_id = lexeme.get("lexemeId")
        if isinstance(lexeme_id, str):
            record_shared(f"lexeme:{lexeme_id}", _canonical(lexeme), package_path.name, sense)
        lemma = lexeme.get("lemma")
        forms = lexeme.get("forms")
        if isinstance(lemma, str) and isinstance(forms, list):
            if lemma not in approved_form_cache:
                if db_path.exists():
                    try:
                        approved_form_cache[lemma] = _approved_lexeme_forms(
                            db_path=db_path,
                            assets_dir=assets_dir,
                            profiles_dir=profiles_dir,
                            lemma=lemma,
                        )
                    except (OSError, sqlite3.Error, ValueError) as exc:
                        approved_form_cache[lemma] = set()
                        _finding(findings, "error", "lexeme.form_provenance_unavailable", f"Cannot verify approved forms for {lemma}: {exc}", package_path.name)
                else:
                    approved_form_cache[lemma] = set()
                    _finding(findings, "error", "lexeme.authoring_db_missing", f"Cannot verify approved forms; authoring DB is missing: {db_path}", package_path.name)
            allowed_forms = approved_form_cache[lemma]
            for index, form in enumerate(forms):
                if not isinstance(form, str) or not form.strip() or (
                    not legacy_snapshot and form.strip().casefold() not in allowed_forms
                ):
                    _finding(findings, "error", "lexeme.unapproved_form", f"{package_path.name}: form {form!r} is not the lemma or an approved example form", f"lexemeVersion.forms[{index}]")
        else:
            _finding(findings, "error", "lexeme.form_shape_invalid", f"{package_path.name}: Lexeme Version lemma/forms are missing or malformed", package_path.name)
        for relation in candidate.get("relations", []):
            if isinstance(relation, dict) and isinstance(relation.get("senseRelationId"), str):
                record_shared(
                    f"relation:{relation['senseRelationId']}",
                    _canonical(relation),
                    package_path.name,
                    sense,
                )
        for asset in candidate.get("assets", []):
            if not isinstance(asset, dict):
                continue
            asset_id = asset.get("learningAssetId")
            if isinstance(asset_id, str):
                record_shared(f"asset:{asset_id}", _canonical(asset), package_path.name, sense)
            referenced_media.update(_check_media({"assets": [asset]}, media_dir, findings))

        manifest = assets_dir / sense / "manifest.json"
        if not manifest.exists():
            _finding(findings, "error", "report.missing_manifest", f"Missing manifest for {sense}", manifest.as_posix())
        else:
            try:
                manifest_doc = _load_json(manifest)
                if not isinstance(manifest_doc, dict):
                    raise ValueError("manifest must be an object")
                legacy_manifest = legacy_snapshot and manifest_doc.get("validatorVersion") == LEGACY_PACKAGE_VALIDATOR_VERSION
                if manifest_doc.get("packageDigest") != report.get("packageDigest") and not legacy_manifest:
                    _finding(findings, "error", "report.manifest_digest_mismatch", f"Manifest digest does not match Validator output for {sense}", manifest.as_posix())
                if manifest_doc.get("status") != report.get("status") and not legacy_manifest:
                    _finding(findings, "error", "report.manifest_status_mismatch", f"Manifest status does not match Validator output for {sense}", manifest.as_posix())
                if manifest_doc.get("requirements") != report.get("requirements") and not legacy_manifest:
                    _finding(findings, "error", "report.manifest_requirements_mismatch", f"Manifest requirements do not match Validator output for {sense}", manifest.as_posix())
                if manifest_doc.get("capabilityResolverVersion") != report.get("capabilityResolverVersion"):
                    _finding(findings, "error", "report.manifest_capability_resolver_version_mismatch", f"Manifest Capability Resolver version does not match Validator output for {sense}", manifest.as_posix())
            except (OSError, json.JSONDecodeError, AttributeError, ValueError) as exc:
                _finding(findings, "error", "report.invalid_manifest", f"Invalid manifest for {sense}: {exc}", manifest.as_posix())

        proof_valid = False
        proof_detail: dict[str, Any] = {}
        sense_dir = assets_dir / sense
        semantic_path = sense_dir / "semantic_review.json"
        deterministic_path = sense_dir / "deterministic_review.json"
        if not semantic_path.exists() or not deterministic_path.exists():
            _finding(findings, "error", "review.missing_proof", f"Missing automated review proof for {sense}", sense)
        elif not db_path.exists():
            _finding(findings, "error", "review.authoring_db_missing", f"Cannot rebuild review input; authoring DB is missing: {db_path}", sense)
        else:
            try:
                review_input = build_review_input_from_authoring(
                    db_path=db_path,
                    sense_id=sense,
                    sense_dir=sense_dir,
                    profile_path=profiles_dir / f"{sense}.json",
                )
                input_digest = sha256_json(review_input)
                deterministic_doc = _load_json(deterministic_path)
                semantic_doc = _load_json(semantic_path)
                legacy_review_digest = deterministic_doc.get("validatorInputDigest")
                legacy_proof_compatible = (
                    legacy_snapshot
                    and deterministic_doc.get("schemaVersion") == LEGACY_DETERMINISTIC_REVIEW_SCHEMA_VERSION
                    and semantic_doc.get("schemaVersion") == LEGACY_SEMANTIC_REVIEW_SCHEMA_VERSION
                    and deterministic_doc.get("status") == "passed"
                    and isinstance(legacy_review_digest, str)
                    and semantic_doc.get("inputDigest") == legacy_review_digest
                    and review_is_approved(semantic_doc, legacy_review_digest)
                )
                if legacy_proof_compatible:
                    proof_valid = True
                    proof_detail = {
                        "inputDigest": legacy_review_digest,
                        "deterministicStatus": deterministic_doc.get("status"),
                        "semanticApproved": True,
                        "legacyCompatibility": True,
                    }
                else:
                    if deterministic_doc.get("status") != "passed":
                        _finding(findings, "error", "review.deterministic_not_passed", f"Deterministic proof is not passed for {sense}", sense)
                    elif deterministic_doc.get("validatorInputDigest") != input_digest:
                        _finding(findings, "error", "review.deterministic_digest_mismatch", f"Deterministic proof digest does not match current input for {sense}", sense)
                    if not review_is_approved(semantic_doc, input_digest):
                        _finding(findings, "error", "review.semantic_not_approved", f"Semantic proof is not approved for current input for {sense}", sense)
                    else:
                        proof_valid = deterministic_doc.get("status") == "passed" and deterministic_doc.get("validatorInputDigest") == input_digest
                    proof_detail = {
                        "inputDigest": input_digest,
                        "deterministicStatus": deterministic_doc.get("status"),
                        "semanticApproved": review_is_approved(semantic_doc, input_digest),
                    }
            except (OSError, json.JSONDecodeError, TypeError, ValueError) as exc:
                _finding(findings, "error", "review.proof_invalid", f"Cannot validate current review proof for {sense}: {exc}", sense)
        package_entry["review"] = proof_detail
        local_error_count = sum(1 for finding in findings if finding["severity"] == "error") - package_error_start
        package_entry["eligible"] = bool(
            validator_status == "satisfied"
            and effective_status == "satisfied"
            and proof_valid
            and local_error_count == 0
        )
        eligible_by_sense[sense] = package_entry["eligible"]
        package_reports.append(package_entry)

    for key in conflicted_entities:
        for sense in entity_packages.get(key, set()):
            eligible_by_sense[sense] = False

    missing_senses = (expected_senses if expected_senses is not None else profile_senses) - candidate_senses
    for sense in sorted(missing_senses):
        _finding(findings, "error", "package.missing", f"No candidate package for {sense}", sense)

    if media_dir.exists():
        for path in media_dir.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in {".mp3", ".png", ".jpg", ".jpeg", ".webp"}:
                continue
            stem = path.stem
            if stem not in referenced_media:
                _finding(findings, "warning", "media.orphan", f"Unreferenced media file: {path.relative_to(media_dir)}", path.as_posix())

    statuses = {"satisfied": 0, "incomplete": 0, "invalid": 0}
    for entry in package_reports:
        status = entry.get("effectiveStatus") or entry["validator"].get("status")
        if status in statuses:
            statuses[status] += 1
    errors = sum(1 for finding in findings if finding["severity"] == "error")
    warnings = sum(1 for finding in findings if finding["severity"] == "warning")
    # The Validator report does not expose lexemeId as a top-level field; read
    # it from the candidate when computing eligibility.
    eligible_lexemes = set()
    for entry in package_reports:
        if not eligible_by_sense.get(entry["senseId"]):
            continue
        try:
            candidate = _load_json(packages_dir / entry["package"])
            lexeme_id = (candidate.get("lexemeVersion") or {}).get("lexemeId")
        except (OSError, json.JSONDecodeError, AttributeError):
            lexeme_id = None
        if isinstance(lexeme_id, str):
            eligible_lexemes.add(lexeme_id)
    candidate_errors = errors
    candidate_integrity_ok = candidate_errors == 0
    public_passed = len(eligible_lexemes) >= MIN_PUBLIC_LEXEMES and candidate_integrity_ok
    if require_public_gate and not public_passed:
        _finding(findings, "error", "public.lexeme_gate_failed", f"Only {len(eligible_lexemes)} eligible distinct Lexemes; {MIN_PUBLIC_LEXEMES} are required for public release.", "publicLexemeGate")
        errors += 1
    report = {
        "schemaVersion": "sensa-release-validation-v1",
        "validatorVersion": "sensa-package-validator-v3",
        "capabilityResolverVersion": CAPABILITY_RESOLVER_VERSION,
        "checkedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "candidateCompleteness": {
            "packages": len(package_paths),
            "satisfied": statuses["satisfied"],
            "incomplete": statuses["incomplete"],
            "invalid": statuses["invalid"],
            "complete": bool(
                len(package_paths) > 0
                and statuses["incomplete"] == 0
                and statuses["invalid"] == 0
                and candidate_errors == 0
            ),
        },
        "publicLexemeGate": {
            "eligibleDistinctLexemes": len(eligible_lexemes),
            "minimumDistinctLexemes": MIN_PUBLIC_LEXEMES,
            "passed": public_passed,
            "requiredForThisRun": require_public_gate,
            "note": "Only satisfied packages with valid proof and release consistency count; this is separate from candidate completeness.",
        },
        "packages": package_reports,
        "findings": findings,
        "summary": {
            "errors": sum(1 for finding in findings if finding["severity"] == "error"),
            "warnings": warnings,
        },
    }
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Read-only Sensa release/batch validator")
    parser.add_argument("--packages-dir", default=str(DEFAULT_PACKAGES_DIR))
    parser.add_argument("--assets-dir", default=str(DEFAULT_ASSETS_DIR))
    parser.add_argument("--profiles-dir", default=str(DEFAULT_PROFILES_DIR))
    parser.add_argument("--media-dir", default=str(DEFAULT_MEDIA_DIR))
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH), help="Immutable authoring DB used to rebuild review input digests")
    parser.add_argument("--expected-senses", default=None, help="Optional JSON list/object of expected Sense IDs")
    parser.add_argument("--report", default=None, help="Optional path to persist the machine-readable report")
    parser.add_argument("--public", action="store_true", help="Treat the 1,000 distinct Lexeme gate as a failure condition")
    args = parser.parse_args()
    report = validate_release(
        packages_dir=Path(args.packages_dir),
        assets_dir=Path(args.assets_dir),
        profiles_dir=Path(args.profiles_dir),
        media_dir=Path(args.media_dir),
        expected_senses_path=Path(args.expected_senses) if args.expected_senses else None,
        db_path=Path(args.db),
        require_public_gate=args.public,
    )
    output = json.dumps(report, ensure_ascii=False, indent=2)
    print(output)
    if args.report:
        report_path = Path(args.report)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(output + "\n", encoding="utf-8")
    if report["summary"]["errors"] > 0:
        sys.exit(2)


if __name__ == "__main__":
    main()
