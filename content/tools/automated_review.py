#!/usr/bin/env python3
"""Auditable, unattended semantic review for Sensa content candidates.

The deterministic compiler remains the first gate. This module is the
separate semantic-review seam used by SensePackageBuild. It deliberately has no fallback
to the generation provider's configuration: a review must be configured with
``SENSA_REVIEW_LLM_*`` and its result is bound to a digest of the exact text
and semantic facts that were reviewed.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parent.parent
PROMPT_PATH = ROOT / "prompts" / "automated-review.md"
REVIEW_SCHEMA_VERSION = "sensa-automated-semantic-review-v2"
REVIEW_PROMPT_VERSION = "automated-review-v2.0.1"
LEGACY_REVIEW_SCHEMA_VERSION = "sensa-automated-semantic-review-v1"
LEGACY_REVIEW_PROMPT_VERSION = "automated-review-v1.0.0"


def _supported_review_versions(schema_version: Any, prompt_version: Any) -> bool:
    return (schema_version, prompt_version) in {
        (REVIEW_SCHEMA_VERSION, REVIEW_PROMPT_VERSION),
        (LEGACY_REVIEW_SCHEMA_VERSION, LEGACY_REVIEW_PROMPT_VERSION),
    }


def _load_review_dotenv() -> None:
    """Load only review-prefixed local settings; never copy generation settings."""

    env_file = ROOT / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped.startswith("export "):
            stripped = stripped[len("export "):].strip()
        if "=" not in stripped or stripped.startswith("#"):
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        if key.startswith("SENSA_REVIEW_LLM_"):
            os.environ.setdefault(key, value.strip().strip("\"'"))


_load_review_dotenv()

REQUIRED_CHECKS = (
    "sense_identity",
    "profile_requirements",
    "usage_pattern_evidence",
    "bilingual_text",
    "example_sense_lock_and_diversity",
    "boundary_assets",
    "lexical_forms",
)
REVIEW_VERDICTS = frozenset(("approved", "rejected", "needs_revision"))
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_json(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def clean_json(text: str) -> str:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.MULTILINE)
        cleaned = re.sub(r"\s*```$", "", cleaned, flags=re.MULTILINE)
    return cleaned.strip()


def _normalized_verdict(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = re.sub(r"[\s-]+", "_", value.strip().lower())
    return {
        "approve": "approved",
        "approved": "approved",
        "pass": "approved",
        "passed": "approved",
        "reject": "rejected",
        "rejected": "rejected",
        "fail": "rejected",
        "failed": "rejected",
        "needs_revision": "needs_revision",
        "needsrevision": "needs_revision",
        "revise": "needs_revision",
    }.get(normalized)


def _normalized_check_status(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = re.sub(r"[\s-]+", "_", value.strip().lower())
    return {
        "pass": "pass",
        "passed": "pass",
        "ok": "pass",
        "success": "pass",
        "succeeded": "pass",
        "approved": "pass",
        "fail": "fail",
        "failed": "fail",
        "error": "fail",
        "rejected": "fail",
        "needs_revision": "fail",
    }.get(normalized)


def _normalized_issue_severity(value: Any) -> str:
    if not isinstance(value, str):
        return "error"
    normalized = value.strip().lower()
    if normalized in {"info", "notice"}:
        return "info"
    if normalized in {"warning", "warn"}:
        return "warning"
    return "error"


def _has_actionable_error_issues(issues: Any) -> bool:
    if not isinstance(issues, list):
        return True
    return any(
        isinstance(issue, dict)
        and _normalized_issue_severity(issue.get("severity")) == "error"
        for issue in issues
    )


def _stable_asset(asset: dict[str, Any]) -> dict[str, Any]:
    """Remove generated media and volatile review metadata from the text input."""

    return {
        key: value
        for key, value in asset.items()
        if key not in {
            "reviewStatus",
            "createdAt",
            "generatedAt",
            "reviewedAt",
            "contentDigest",
            "mediaBlobId",
            "mediaSha256",
            "mimeType",
            "sizeBytes",
            "durationMs",
            "sourceTextDigest",
            "provider",
            "model",
            "voice",
            "accentLocale",
        }
    }


def _stable_profile(profile: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in profile.items()
        if key not in {"reviewStatus", "createdAt", "reviewedAt"}
    }


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _read_asset_documents(sense_dir: Path, names: tuple[str, ...]) -> list[dict[str, Any]]:
    assets: list[dict[str, Any]] = []
    for name in names:
        path = sense_dir / name
        if not path.exists():
            continue
        value = _read_json(path)
        if isinstance(value, list):
            assets.extend(item for item in value if isinstance(item, dict))
        elif isinstance(value, dict):
            assets.append(value)
    return assets


def build_review_input_from_authoring(
    *,
    db_path: Path,
    sense_id: str,
    sense_dir: Path,
    profile_path: Path,
) -> dict[str, Any]:
    """Rebuild the review subject from the immutable authoring DB and assets.

    Build review, media production, package compilation, and release validation
    must agree on this exact subject. Keeping this loader here prevents media
    production from trusting a
    detached ``reviewStatus`` flag or a stale proof file.
    """

    conn = sqlite3.connect(f"{db_path.resolve().as_uri()}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only = ON")
    try:
        row = conn.execute("SELECT * FROM senses WHERE sense_id = ?", (sense_id,)).fetchone()
        if row is None:
            raise ValueError(f"senses.db 中不存在 {sense_id}")
        target = dict(row)
        word = target["word"]
        relations = [
            dict(item)
            for item in conn.execute(
                "SELECT * FROM relations WHERE word = ? AND (source_sense_id = ? OR target_sense_id = ?)",
                (word, sense_id, sense_id),
            )
        ]
        dictionary_entries = [
            dict(item)
            for item in conn.execute(
                "SELECT * FROM dictionary_entries WHERE word = ? ORDER BY entry_order",
                (word,),
            )
        ]
    finally:
        conn.close()

    profile = _read_json(profile_path)
    if not isinstance(profile, dict):
        raise ValueError(f"Profile must be an object: {profile_path}")
    patterns_path = sense_dir / "usage_patterns.json"
    usage_patterns = _read_json(patterns_path) if patterns_path.exists() else []
    if not isinstance(usage_patterns, list):
        raise ValueError(f"usage_patterns.json must be an array: {patterns_path}")
    usage_status_path = sense_dir / "usage_pattern_status.json"
    usage_pattern_status = _read_json(usage_status_path) if usage_status_path.exists() else None
    if usage_pattern_status is not None and not isinstance(usage_pattern_status, dict):
        raise ValueError(f"usage_pattern_status.json must be an object: {usage_status_path}")
    text_assets = _read_asset_documents(
        sense_dir,
        (
            "experience_sketch.json",
            "l1_bridge.json",
            "examples.json",
            "contrast_pairs.json",
            "boundary_notes.json",
            "visual_assets.json",
            "diagram_assets.json",
            "sequence_assets.json",
        ),
    )
    return build_text_review_input(
        sense_id=sense_id,
        target=target,
        dictionary_entries=dictionary_entries,
        relations=relations,
        profile=profile,
        usage_patterns=[item for item in usage_patterns if isinstance(item, dict)],
        text_assets=text_assets,
        usage_pattern_status=usage_pattern_status,
    )


def build_text_review_input(
    *,
    sense_id: str,
    target: dict[str, Any],
    dictionary_entries: list[dict[str, Any]],
    relations: list[dict[str, Any]],
    profile: dict[str, Any],
    usage_patterns: list[dict[str, Any]],
    text_assets: list[dict[str, Any]],
    usage_pattern_status: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build the exact semantic-review subject.

    Audio/media are intentionally excluded: they have their own deterministic
    media gate after text approval.  Dictionary evidence is included by entry
    ID so the reviewer can check that Usage Patterns are grounded in the
    target Sense's real evidence rather than a generated placeholder ID.
    """

    evidence_ids = _parse_source_entries(target.get("source_entries"))
    evidence_by_id = {str(entry.get("entry_id")): entry for entry in dictionary_entries}
    evidence = []
    for entry_id in evidence_ids:
        entry = evidence_by_id.get(entry_id)
        if entry is not None:
            evidence.append({
                "entryId": entry_id,
                "word": entry.get("word"),
                "pos": entry.get("pos"),
                "gloss": entry.get("gloss"),
                "examples": _parse_json_array(entry.get("examples")),
            })

    target_fact = {
        key: target.get(key)
        for key in (
            "sense_id",
            "word",
            "lemma",
            "pos",
            "label_zh",
            "definition",
            "semantic_type",
            "dimension",
            "valency",
            "register",
            "teaching_priority",
            "source_entries",
        )
    }
    review_input = {
        "schemaVersion": REVIEW_SCHEMA_VERSION,
        "senseId": sense_id,
        "target": target_fact,
        "targetDictionaryEvidence": evidence,
        "relations": sorted(
            [
                {
                    key: relation.get(key)
                    for key in (
                        "id",
                        "source_sense_id",
                        "target_sense_id",
                        "relation",
                        "distinction",
                    )
                }
                for relation in relations
            ],
            key=lambda relation: canonical_json(relation),
        ),
        "profile": _stable_profile(profile),
        "usagePatterns": sorted(
            [_stable_asset(pattern) for pattern in usage_patterns],
            key=lambda pattern: canonical_json(pattern),
        ),
        "textAssets": sorted(
            [_stable_asset(asset) for asset in text_assets],
            key=lambda asset: canonical_json(asset),
        ),
    }
    if usage_pattern_status is not None:
        review_input["usagePatternStatus"] = _stable_asset(usage_pattern_status)
    return review_input


def _parse_json_array(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return []
        return parsed if isinstance(parsed, list) else []
    return []


def _parse_source_entries(value: Any) -> list[str]:
    parsed = _parse_json_array(value)
    if parsed:
        return [str(item).strip() for item in parsed if str(item).strip()]
    if isinstance(value, str) and value.strip():
        return [item.strip() for item in value.split(",") if item.strip()]
    return []


def configured_review_environment() -> bool:
    """Return whether an explicitly separate review provider is configured."""

    return bool(
        os.environ.get("SENSA_REVIEW_LLM_PROTOCOL")
        or os.environ.get("SENSA_REVIEW_LLM_BACKEND")
    )


def load_review_config() -> Any:
    # Import lazily so deterministic-only validation does not require optional
    # HTTP dependencies or a configured API key.
    from tools.llm import LLMConfig

    if not configured_review_environment():
        raise ValueError(
            "No separate semantic reviewer configured. Set SENSA_REVIEW_LLM_PROTOCOL "
            "and its provider-specific SENSA_REVIEW_LLM_* settings."
        )
    return LLMConfig.from_env(prefix="SENSA_REVIEW_LLM_")


def _issue(code: str, path: str, message: str, severity: str = "error") -> dict[str, str]:
    return {"code": code, "path": path, "message": message, "severity": severity}


def _normalize_check_value(value: Any) -> tuple[str | None, dict[str, Any] | None]:
    """Normalize a check while preserving harmless reviewer-provided fields."""

    if isinstance(value, str):
        status = _normalized_check_status(value)
        return status, {"status": status} if status is not None else None
    if not isinstance(value, dict):
        return None, None

    normalized = dict(value)
    status = _normalized_check_status(value.get("status"))
    if status is not None:
        normalized["status"] = status
    if "note" in value:
        note = value.get("note")
        if isinstance(note, str) and note.strip():
            normalized["note"] = note.strip()
        else:
            normalized["note"] = note
    return status, normalized


def _normalize_issue_value(value: Any) -> tuple[dict[str, Any] | None, str | None]:
    """Normalize an issue and return a structural error when its core is bad."""

    if not isinstance(value, dict):
        return None, "Each issue must be an object with code, path, and message text."
    normalized = dict(value)
    for key in ("code", "path", "message"):
        field = value.get(key)
        if not isinstance(field, str) or not field.strip():
            return None, f"Issue {key} must be non-empty text."
        normalized[key] = field.strip()
    if "severity" in value:
        normalized["severity"] = _normalized_issue_severity(value.get("severity"))
    return normalized, None


def validate_review_payload(payload: Any) -> tuple[bool, list[dict[str, str]], dict[str, Any] | None]:
    """Validate the semantic core of a reviewer response.

    The model may add harmless metadata or explanatory fields.  Only the
    version, verdict, seven required check statuses, and issue core are
    interpreted by the gate; optional notes and summaries are checked only
    when supplied.
    """

    issues: list[dict[str, str]] = []
    if not isinstance(payload, dict):
        return False, [_issue("review.response_not_object", "$", "Semantic review response must be a JSON object.")], None
    payload_schema_version = payload.get("schemaVersion")
    if payload_schema_version not in {REVIEW_SCHEMA_VERSION, LEGACY_REVIEW_SCHEMA_VERSION}:
        issues.append(_issue("review.schema_version", "schemaVersion", f"Expected {REVIEW_SCHEMA_VERSION} or legacy {LEGACY_REVIEW_SCHEMA_VERSION}."))
    verdict = _normalized_verdict(payload.get("verdict"))
    if verdict not in REVIEW_VERDICTS:
        issues.append(_issue("review.verdict_invalid", "verdict", "Verdict must be approved, rejected, or needs_revision."))

    if "summary" in payload:
        summary = payload.get("summary")
        if not isinstance(summary, str) or not summary.strip():
            issues.append(_issue("review.summary_invalid", "summary", "summary must be non-empty text when supplied."))
        else:
            summary = summary.strip()
    else:
        summary = ""

    raw_issues = payload.get("issues", [])
    normalized_issues: list[dict[str, Any]] = []
    if not isinstance(raw_issues, list):
        issues.append(_issue("review.issues_invalid", "issues", "issues must be an array when supplied."))
        raw_issues = []
    for index, item in enumerate(raw_issues):
        normalized_issue, error = _normalize_issue_value(item)
        if error is not None:
            issues.append(_issue("review.issue_shape_invalid", f"issues[{index}]", error))
            continue
        if normalized_issue is not None:
            normalized_issues.append(normalized_issue)

    checks = payload.get("checks")
    if not isinstance(checks, dict):
        issues.append(_issue("review.checks_invalid", "checks", "checks must be an object with every required review check."))
        checks = {}

    normalized_checks: dict[str, Any] = dict(checks)
    for check_name in REQUIRED_CHECKS:
        if check_name not in checks:
            issues.append(_issue("review.check_missing", f"checks.{check_name}", "Every required semantic review check must be present."))
            continue
        status, normalized_check = _normalize_check_value(checks.get(check_name))
        if normalized_check is not None:
            normalized_checks[check_name] = normalized_check
        if status not in {"pass", "fail"}:
            issues.append(_issue("review.check_status_invalid", f"checks.{check_name}.status", "Check status must be pass or fail."))
        if isinstance(checks.get(check_name), dict) and "note" in checks[check_name]:
            note = checks[check_name].get("note")
            if not isinstance(note, str) or not note.strip():
                issues.append(_issue("review.check_note_invalid", f"checks.{check_name}.note", "Check note must be non-empty text when supplied."))

    if verdict == "approved":
        failed_checks = [
            check_name
            for check_name in REQUIRED_CHECKS
            if _normalize_check_value(checks.get(check_name))[0] != "pass"
        ]
        if failed_checks:
            issues.append(_issue("review.approved_check_failed", "checks", f"Approved review requires all seven checks to pass: {failed_checks}."))
        if _has_actionable_error_issues(normalized_issues):
            issues.append(_issue("review.approved_with_issues", "issues", "An approved review cannot contain actionable error issues."))

    normalized = {
        "schemaVersion": payload.get("schemaVersion"),
        "verdict": verdict,
        "checks": normalized_checks,
        "issues": normalized_issues,
        "summary": summary,
    }
    return not issues, issues, normalized


def make_failure_report(
    *,
    input_digest: str,
    code: str,
    message: str,
    provider: str = "unconfigured",
    model: str | None = None,
) -> dict[str, Any]:
    now = utc_now()
    return {
        "schemaVersion": REVIEW_SCHEMA_VERSION,
        "reviewMethod": "automated_semantic",
        "reviewPromptVersion": REVIEW_PROMPT_VERSION,
        "provider": provider,
        "model": model,
        "inputDigest": input_digest,
        "requestedAt": now,
        "reviewedAt": now,
        "verdict": "needs_revision",
        "checks": {},
        "issues": [{"code": code, "path": "$", "message": message}],
        "summary": "Semantic review did not produce an approval.",
    }


def run_semantic_review(
    review_input: dict[str, Any],
    *,
    report_path: Path,
    force: bool = False,
) -> dict[str, Any]:
    """Run or reuse the separately configured semantic review pass."""

    input_digest = sha256_json(review_input)
    if report_path.exists() and not force:
        try:
            cached = json.loads(report_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            cached = None
        if isinstance(cached, dict) and _cached_report_is_reusable(cached, input_digest):
            cached_codes = {item.get("code") for item in cached.get("issues", []) if isinstance(item, dict)}
            if not cached_codes.intersection({"review.configuration_missing", "review.request_failed"}):
                return cached

    try:
        config = load_review_config()
    except Exception as exc:
        report = make_failure_report(input_digest=input_digest, code="review.configuration_missing", message=str(exc))
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        return report

    requested_at = utc_now()
    prompt_template = PROMPT_PATH.read_text(encoding="utf-8")
    prompt = prompt_template.replace("{{REVIEW_INPUT_JSON}}", canonical_json(review_input))
    try:
        from tools.llm import invoke

        response = invoke(prompt, config=config)
        payload = json.loads(clean_json(response.text))
        valid, validation_issues, normalized = validate_review_payload(payload)
        if normalized is None:
            normalized = {
                "schemaVersion": REVIEW_SCHEMA_VERSION,
                "verdict": "needs_revision",
                "checks": {},
                "issues": [],
                "summary": "Invalid semantic reviewer response.",
            }
        verdict = normalized.get("verdict") if valid else "needs_revision"
        issues = list(normalized.get("issues") or [])
        issues.extend({"code": item["code"], "path": item["path"], "message": item["message"]} for item in validation_issues)
        report = {
            "schemaVersion": REVIEW_SCHEMA_VERSION,
            "reviewMethod": "automated_semantic",
            "reviewPromptVersion": REVIEW_PROMPT_VERSION,
            "provider": config.protocol,
            "model": config.model,
            "inputDigest": input_digest,
            "requestedAt": requested_at,
            "reviewedAt": utc_now(),
            "requestId": response.request_id,
            "verdict": "approved" if valid and verdict == "approved" else "needs_revision" if verdict != "rejected" else "rejected",
            "checks": normalized.get("checks", {}),
            "issues": issues,
        }
        if normalized.get("summary"):
            report["summary"] = normalized["summary"]
    except Exception as exc:
        report = make_failure_report(
            input_digest=input_digest,
            code="review.request_failed",
            message=f"Semantic review request/response failed: {exc}",
            provider=getattr(config, "protocol", "configured"),
            model=getattr(config, "model", None),
        )
        report["requestedAt"] = requested_at
        report["reviewedAt"] = utc_now()

    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def review_is_approved(report: dict[str, Any], input_digest: str) -> bool:
    if not _review_provenance_is_bound(report, input_digest):
        return False
    payload = {
        "schemaVersion": report.get("schemaVersion"),
        "verdict": report.get("verdict"),
        "checks": report.get("checks"),
        "issues": report.get("issues", []),
    }
    if "summary" in report:
        payload["summary"] = report["summary"]
    valid, _, normalized = validate_review_payload(payload)
    return (
        valid
        and normalized is not None
        and normalized.get("verdict") == "approved"
        and _checks_are_exact_and_passing(normalized.get("checks"))
        and not _has_actionable_error_issues(normalized.get("issues"))
    )


def _checks_are_exact_and_passing(checks: Any) -> bool:
    if not _checks_have_required_shape(checks):
        return False
    return all(_normalize_check_value(checks[name])[0] == "pass" for name in REQUIRED_CHECKS)


def _checks_have_required_shape(checks: Any) -> bool:
    if not isinstance(checks, dict):
        return False
    for name in REQUIRED_CHECKS:
        if name not in checks:
            return False
        status, _ = _normalize_check_value(checks[name])
        if status not in {"pass", "fail"}:
            return False
        check = checks[name]
        if isinstance(check, dict) and "note" in check:
            note = check.get("note")
            if not isinstance(note, str) or not note.strip():
                return False
    return True


def _review_provenance_is_bound(report: dict[str, Any], input_digest: str) -> bool:
    """Check the immutable proof metadata shared by cached and live gates."""

    if not isinstance(report, dict):
        return False
    if not isinstance(input_digest, str) or not SHA256_RE.fullmatch(input_digest):
        return False
    if not _supported_review_versions(report.get("schemaVersion"), report.get("reviewPromptVersion")):
        return False
    if report.get("reviewMethod") != "automated_semantic":
        return False
    if report.get("inputDigest") != input_digest:
        return False
    if not isinstance(report.get("provider"), str) or not report["provider"].strip():
        return False
    # Some command adapters cannot report a model.  Null, "unknown", and a
    # non-empty model string are all valid provenance states; absence is
    # treated like null for backwards-compatible command reports.
    model = report.get("model")
    if model is not None and (not isinstance(model, str) or not model.strip()):
        return False
    for key in ("requestedAt", "reviewedAt"):
        if not isinstance(report.get(key), str) or not report[key].strip():
            return False
    return True


def _cached_report_is_reusable(report: dict[str, Any], input_digest: str) -> bool:
    if not _review_provenance_is_bound(report, input_digest):
        return False
    payload = {
        "schemaVersion": report.get("schemaVersion"),
        "verdict": report.get("verdict"),
        "checks": report.get("checks"),
        "issues": report.get("issues", []),
    }
    if "summary" in report:
        payload["summary"] = report["summary"]
    valid, _, normalized = validate_review_payload(payload)
    if not valid or normalized is None:
        return False
    if normalized.get("verdict") == "approved":
        return (
            _checks_are_exact_and_passing(normalized.get("checks"))
            and not _has_actionable_error_issues(normalized.get("issues"))
        )
    return normalized.get("verdict") in REVIEW_VERDICTS
