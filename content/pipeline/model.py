"""Stable documents and transitions for SensePackageBuild."""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone
from typing import Any

PIPELINE_VERSION = "sensa-package-build-v1"
BUILD_SCHEMA_VERSION = "sensa-package-build-v1"
ATTEMPT_SCHEMA_VERSION = "sensa-package-build-attempt-v1"

STAGE_ORDER = (
    "facts",
    "profile",
    "grounding",
    "examples",
    "conditions",
    "text_compile",
    "semantic_review",
    "final_compile",
    "media",
    "package_gate",
)

BUILD_STATUSES = {
    "facts_pending",
    "facts_ready",
    "profile_ready",
    "authoring",
    "review_pending",
    "text_approved",
    "compiled",
    "media_ready",
    "package_valid",
    "blocked",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_json(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def new_build_id(sense_id: str) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"build-{sense_id}-{stamp}-{uuid.uuid4().hex[:8]}"


def new_attempt_id(stage: str) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"attempt-{stage}-{stamp}-{uuid.uuid4().hex[:8]}"


def issue(
    code: str,
    message: str,
    *,
    stage: str,
    path: str = "$",
    artifact_id: str | None = None,
    severity: str = "error",
) -> dict[str, Any]:
    value: dict[str, Any] = {
        "code": code,
        "message": message,
        "stage": stage,
        "path": path,
        "severity": severity,
    }
    if artifact_id:
        value["artifactId"] = artifact_id
    return value


def make_build(*, sense_id: str, facts: dict[str, Any]) -> dict[str, Any]:
    now = utc_now()
    return {
        "schemaVersion": BUILD_SCHEMA_VERSION,
        "pipelineVersion": PIPELINE_VERSION,
        "buildId": new_build_id(sense_id),
        "senseId": sense_id,
        "senseVersionId": facts["identity"]["senseVersionId"],
        "lexemeVersionId": facts["identity"]["lexemeVersionId"],
        "inputDigest": sha256_json(facts),
        "status": "facts_pending",
        "selectedAttempts": {},
        "issues": [],
        "revision": 0,
        "createdAt": now,
        "updatedAt": now,
    }


def validate_build(build: Any) -> list[str]:
    errors: list[str] = []
    if not isinstance(build, dict):
        return ["Build document must be an object"]
    if build.get("schemaVersion") != BUILD_SCHEMA_VERSION:
        errors.append(f"Unsupported build schemaVersion: {build.get('schemaVersion')!r}")
    if build.get("pipelineVersion") != PIPELINE_VERSION:
        errors.append(f"Unsupported pipelineVersion: {build.get('pipelineVersion')!r}")
    for key in ("buildId", "senseId", "senseVersionId", "lexemeVersionId", "inputDigest"):
        if not isinstance(build.get(key), str) or not build[key].strip():
            errors.append(f"Build {key} must be non-empty text")
    if build.get("status") not in BUILD_STATUSES:
        errors.append(f"Unknown build status: {build.get('status')!r}")
    if not isinstance(build.get("selectedAttempts"), dict):
        errors.append("selectedAttempts must be an object")
    if not isinstance(build.get("issues"), list):
        errors.append("issues must be an array")
    if not isinstance(build.get("revision"), int) or build["revision"] < 0:
        errors.append("revision must be a non-negative integer")
    return errors
