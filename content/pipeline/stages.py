"""External authoring stages. Nothing here is allowed to publish content."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from tools.docio import extract_json_doc
from tools.llm import LLMConfig, LLMResult, invoke

from .model import canonical_json, issue, sha256_json, utc_now
from .validation import (
    validate_conditions,
    validate_example,
    validate_examples,
    validate_grounding,
    validate_profile,
)

ROOT = Path(__file__).resolve().parent.parent
PROMPTS = ROOT / "prompts"
GENERATION_PREFIX = "SENSA_ACQUISITION_LLM_"


def load_generation_environment() -> None:
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key.startswith(GENERATION_PREFIX):
            os.environ.setdefault(key, value.strip().strip("\"'"))


def _context(facts: dict[str, Any]) -> dict[str, Any]:
    target = facts["target"]
    target_keys = (
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
    )
    sibling_keys = ("sense_id", "pos", "label_zh", "definition", "semantic_type", "valency")
    relation_keys = ("senseRelationId", "source_sense_id", "target_sense_id", "relation", "distinction")
    evidence_keys = ("entry_id", "pos", "gloss", "examples")
    return {
        "target": {key: target.get(key) for key in target_keys},
        "validForms": facts.get("validForms", []),
        "siblings": [
            {key: sibling.get(key) for key in sibling_keys}
            for sibling in facts.get("siblings", [])
        ],
        "relations": [
            {key: relation.get(key) for key in relation_keys}
            for relation in facts.get("relations", [])
        ],
        "targetDictionaryEvidence": [
            {key: evidence.get(key) for key in evidence_keys}
            for evidence in facts.get("targetDictionaryEvidence", [])
        ],
    }


def _call(
    *,
    prompt_name: str,
    replacements: dict[str, str],
    prompt_version: str,
    allow_external: bool,
) -> tuple[dict[str, Any], dict[str, Any]]:
    if not allow_external:
        raise PermissionError("LLM generation requires explicit --allow-llm")
    load_generation_environment()
    config = LLMConfig.from_env(prefix=GENERATION_PREFIX)
    prompt = (PROMPTS / prompt_name).read_text(encoding="utf-8")
    for key, value in replacements.items():
        prompt = prompt.replace(f"{{{{{key}}}}}", value)
    requested_at = utc_now()
    response: LLMResult = invoke(prompt, config=config)
    document = extract_json_doc(response.text)
    provenance = {
        "method": "llm",
        "provider": response.protocol,
        "model": response.model,
        "requestId": response.request_id,
        "promptVersion": prompt_version,
        "requestedAt": requested_at,
        "completedAt": utc_now(),
        "inputDigest": sha256_json({"promptVersion": prompt_version, "replacements": replacements}),
        "outputDigest": sha256_json(document),
    }
    return document, provenance


def generate_profile(
    facts: dict[str, Any],
    *,
    allow_external: bool,
    repair_instruction: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]]]:
    document, provenance = _call(
        prompt_name="acquisition-profile.md",
        prompt_version="acquisition-profile-v2",
        allow_external=allow_external,
        replacements={
            "SENSE_FACTS_JSON": canonical_json(_context(facts)),
            "REPAIR_INSTRUCTION": repair_instruction or "None. Produce the initial profile.",
        },
    )
    profile = document.get("profile") if isinstance(document.get("profile"), dict) else document
    return profile, provenance, validate_profile(profile, facts)


def generate_grounding(
    facts: dict[str, Any],
    profile: dict[str, Any],
    *,
    allow_external: bool,
    repair_instruction: str | None = None,
    existing: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]]]:
    document, provenance = _call(
        prompt_name="grounding-bundle.md",
        prompt_version="grounding-bundle-v1",
        allow_external=allow_external,
        replacements={
            "SENSE_FACTS_JSON": canonical_json(_context(facts)),
            "PROFILE_JSON": canonical_json(profile),
            "EXISTING_JSON": canonical_json(existing) if existing else "null",
            "REPAIR_INSTRUCTION": repair_instruction or "None. Produce the initial grounding bundle.",
        },
    )
    grounding = document.get("grounding") if isinstance(document.get("grounding"), dict) else document
    return grounding, provenance, validate_grounding(grounding, facts)


def _candidate_id(example: dict[str, Any], index: int) -> str:
    semantic = {key: value for key, value in example.items() if key != "candidateId"}
    return f"example-{sha256_json(semantic)[:12]}-{index:02d}"


def _example_call(
    facts: dict[str, Any],
    profile: dict[str, Any],
    grounding: dict[str, Any],
    *,
    desired_usage: str,
    count: int,
    existing: list[dict[str, Any]],
    allow_external: bool,
    repair_instruction: str | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    document, provenance = _call(
        prompt_name="learning-examples.md",
        prompt_version="learning-examples-v1",
        allow_external=allow_external,
        replacements={
            "SENSE_FACTS_JSON": canonical_json(_context(facts)),
            "PROFILE_JSON": canonical_json(profile),
            "GROUNDING_JSON": canonical_json(grounding),
            "DESIRED_USAGE": desired_usage,
            "CANDIDATE_COUNT": str(count),
            "EXISTING_EXAMPLES_JSON": canonical_json(existing),
            "REPAIR_INSTRUCTION": repair_instruction or "None. Produce new candidates.",
        },
    )
    examples = document.get("examples")
    if not isinstance(examples, list):
        examples = []
    normalized: list[dict[str, Any]] = []
    for index, value in enumerate(examples, 1):
        if not isinstance(value, dict):
            continue
        candidate = dict(value)
        usages = candidate.get("usages")
        if not isinstance(usages, list):
            candidate["usages"] = [desired_usage]
        candidate["candidateId"] = _candidate_id(candidate, index)
        normalized.append(candidate)
    return normalized, provenance


def _select_examples(examples: list[dict[str, Any]], facts: dict[str, Any]) -> dict[str, list[str]]:
    valid: list[dict[str, Any]] = []
    for index, example in enumerate(examples):
        if not validate_example(example, facts, index=index):
            valid.append(example)
    study = [item["candidateId"] for item in valid if "study" in item.get("usages", [])][:3]
    used = set(study)
    cloze = [
        item["candidateId"]
        for item in valid
        if "cloze" in item.get("usages", []) and item["candidateId"] not in used
    ][:3]
    return {"study": study, "cloze": cloze}


def generate_examples(
    facts: dict[str, Any],
    profile: dict[str, Any],
    grounding: dict[str, Any],
    *,
    allow_external: bool,
    candidate_count: int = 4,
    existing: dict[str, Any] | None = None,
    repair_instruction: str | None = None,
    artifact_id: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]]]:
    existing_examples = [
        dict(item)
        for item in (existing or {}).get("examples", [])
        if isinstance(item, dict)
    ]
    calls: list[dict[str, Any]] = []
    if artifact_id:
        target = next((item for item in existing_examples if item.get("candidateId") == artifact_id), None)
        if target is None:
            return existing or {"examples": [], "selectedCandidateIds": {}}, {"method": "llm", "calls": []}, [
                issue("repair.artifact_unknown", f"Unknown Example candidate: {artifact_id}", stage="examples", artifact_id=artifact_id)
            ]
        desired_usage = "study" if "study" in target.get("usages", []) else "cloze"
        replacements, provenance = _example_call(
            facts,
            profile,
            grounding,
            desired_usage=desired_usage,
            count=1,
            existing=[item for item in existing_examples if item.get("candidateId") != artifact_id],
            allow_external=allow_external,
            repair_instruction=repair_instruction,
        )
        calls.append(provenance)
        if replacements:
            replacement = replacements[0]
            replacement["candidateId"] = artifact_id
            existing_examples = [replacement if item.get("candidateId") == artifact_id else item for item in existing_examples]
        examples = existing_examples
    else:
        examples = []
        for usage in ("study", "cloze"):
            generated, provenance = _example_call(
                facts,
                profile,
                grounding,
                desired_usage=usage,
                count=candidate_count,
                existing=existing_examples + examples,
                allow_external=allow_external,
                repair_instruction=repair_instruction,
            )
            calls.append(provenance)
            examples.extend(generated)
    payload = {"examples": examples, "selectedCandidateIds": _select_examples(examples, facts)}
    provenance = {"method": "llm", "promptVersion": "learning-examples-v1", "calls": calls}
    return payload, provenance, validate_examples(payload, facts)


def generate_conditions(
    facts: dict[str, Any],
    profile: dict[str, Any],
    *,
    allow_external: bool,
    repair_instruction: str | None = None,
    existing: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]]]:
    required = set(profile.get("requiredCapabilities") or [])
    boundary_targets = [
        item
        for item in profile.get("boundaryTargets", [])
        if isinstance(item, dict) and item.get("isRequired") is True
    ]
    needs_generation = "usage_pattern" in required or bool(boundary_targets)
    if not needs_generation:
        payload = {
            "usagePatterns": [],
            "usagePatternOmission": {"status": "omitted", "reason": "Not required by the approved Acquisition Profile."},
            "boundaries": [],
        }
        return payload, {"method": "deterministic", "reason": "no conditional resources required"}, validate_conditions(payload, facts, profile)
    if "usage_pattern" in required and not facts.get("targetDictionaryEvidence"):
        payload = {
            "usagePatterns": [],
            "usagePatternOmission": {"status": "omitted", "reason": "Target Sense has no source evidence from which to extract a Usage Pattern."},
            "boundaries": [],
        }
        problems = validate_conditions(payload, facts, profile)
        return payload, {"method": "deterministic", "reason": "required evidence unavailable"}, problems
    document, provenance = _call(
        prompt_name="conditional-resources.md",
        prompt_version="conditional-resources-v2",
        allow_external=allow_external,
        replacements={
            "SENSE_FACTS_JSON": canonical_json(_context(facts)),
            "PROFILE_JSON": canonical_json(profile),
            "EXISTING_JSON": canonical_json(existing) if existing else "null",
            "REPAIR_INSTRUCTION": repair_instruction or "None. Produce only required conditional resources.",
        },
    )
    payload = {
        "usagePatterns": document.get("usagePatterns") if isinstance(document.get("usagePatterns"), list) else [],
        "usagePatternOmission": document.get("usagePatternOmission"),
        "boundaries": document.get("boundaries") if isinstance(document.get("boundaries"), list) else [],
    }
    if not payload["usagePatterns"] and not isinstance(payload["usagePatternOmission"], dict):
        payload["usagePatternOmission"] = {"status": "omitted", "reason": "No evidence-grounded Usage Pattern was produced."}
    return payload, provenance, validate_conditions(payload, facts, profile)
