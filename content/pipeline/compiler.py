"""Compile reviewed build artifacts into the current V2 delivery contract."""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

from tools.automated_review import build_text_review_input, sha256_json as review_sha256_json

from .model import sha256_json, sha256_text, utc_now

ROOT = Path(__file__).resolve().parent.parent
REPOSITORY_ROOT = ROOT.parent
RELEASE_ID = "rel-2026-v1-candidate"


def _provenance(attempt: dict[str, Any] | None) -> dict[str, Any]:
    source = (attempt or {}).get("provenance") or {}
    if isinstance(source.get("calls"), list) and source["calls"]:
        source = source["calls"][0]
    return {
        "generatorProvider": source.get("provider") or source.get("method") or "deterministic",
        "generatorModel": source.get("model"),
        "promptVersion": source.get("promptVersion"),
    }


def _content_digest(value: dict[str, Any]) -> str:
    return sha256_json({
        key: item
        for key, item in value.items()
        if key not in {"contentDigest", "reviewStatus"}
    })


def _source_refs(facts: dict[str, Any]) -> list[str]:
    refs = [str(value) for value in facts.get("sourceEvidenceRefs", []) if str(value)]
    return refs or [f"sense-{facts['identity']['senseId']}"]


def _target_span(text: str, target: str) -> tuple[int, int]:
    lower = text.casefold()
    start = lower.find(target.casefold())
    if start < 0:
        raise ValueError(f"Target form {target!r} is absent from Example text")
    return start, start + len(target)


def _relation_lexeme_id(sense_id: str, fallback: str) -> str:
    if not isinstance(sense_id, str) or "-" not in sense_id:
        return fallback
    return f"lex-{sense_id.rsplit('-', 1)[0]}"


def compile_text_candidate(
    *,
    facts: dict[str, Any],
    profile_source: dict[str, Any],
    grounding: dict[str, Any],
    example_source: dict[str, Any],
    conditions: dict[str, Any],
    attempts: dict[str, dict[str, Any] | None],
    approved: bool,
) -> dict[str, Any]:
    identity = facts["identity"]
    target = facts["target"]
    review_status = "approved" if approved else "draft"
    release = {
        "contentReleaseId": identity.get("contentReleaseId", RELEASE_ID),
        "targetLanguage": identity.get("targetLanguage", "en"),
        "learnerLocale": identity.get("learnerLocale", "zh-Hans"),
        "schemaVersion": "sensa-content-kernel-v2",
        "status": "draft",
        "validatorVersion": "sensa-package-validator-v3",
    }
    lemma = str(target.get("lemma") or target.get("word"))
    lexeme_id = identity["lexemeId"]
    lexeme_version = {
        "contentReleaseId": release["contentReleaseId"],
        "lexemeVersionId": identity["lexemeVersionId"],
        "lexemeId": lexeme_id,
        "languageTag": release["targetLanguage"],
        "lemma": lemma,
        "forms": list(facts.get("validForms") or [lemma]),
        "pronunciationSourceDigest": sha256_text(lemma),
    }
    priority = target.get("teaching_priority")
    if priority not in {"core", "extended", "recognition"}:
        priority = "extended"
    sense_version = {
        "contentReleaseId": release["contentReleaseId"],
        "senseVersionId": identity["senseVersionId"],
        "senseId": identity["senseId"],
        "lexemeId": lexeme_id,
        "senseRank": int(target.get("sense_num") or 1),
        "partOfSpeech": str(target.get("pos")),
        "guideLabelL1": str(target.get("label_zh")),
        "definitionL2": str(target.get("definition")),
        "teachingPriority": priority,
        "reviewStatus": review_status,
    }
    relations: list[dict[str, Any]] = []
    for raw in facts.get("relations", []):
        relation_id = str(raw.get("senseRelationId"))
        source_sense = str(raw.get("source_sense_id"))
        target_sense = str(raw.get("target_sense_id"))
        relations.append({
            "contentReleaseId": release["contentReleaseId"],
            "senseRelationId": relation_id,
            "sourceSenseId": source_sense,
            "targetSenseId": target_sense,
            "sourceLexemeId": _relation_lexeme_id(source_sense, lexeme_id),
            "targetLexemeId": _relation_lexeme_id(target_sense, lexeme_id),
            "relationType": str(raw.get("relation") or "related"),
            "scope": "intra_word" if _relation_lexeme_id(source_sense, lexeme_id) == _relation_lexeme_id(target_sense, lexeme_id) else "cross_word",
            "distinguishingFeature": str(raw.get("distinction") or "Distinct approved Sense boundary."),
            "sourceEvidenceRefs": [relation_id],
            "reviewStatus": review_status,
        })

    profile = {
        "contentReleaseId": release["contentReleaseId"],
        "acquisitionProfileId": f"ap-{identity['senseId']}-zh-hans-v1",
        "senseVersionId": identity["senseVersionId"],
        "learnerLocale": release["learnerLocale"],
        "schemaVersion": "sensa-acquisition-profile-v1",
        "acquisitionNeeds": profile_source.get("acquisitionNeeds", []),
        "minimumSufficientExperience": profile_source.get("minimumSufficientExperience", ""),
        "distinguishingFeatures": profile_source.get("distinguishingFeatures", []),
        "preferredPrimitives": profile_source.get("preferredPrimitives", []),
        "requiredAssetCapabilities": profile_source.get("requiredCapabilities", []),
        "optionalAssetCapabilities": profile_source.get("optionalCapabilities", []),
        "fallbackPrimitives": profile_source.get("fallbackPrimitives", []),
        "domainBound": profile_source.get("domainBound", False),
        "domainConstraints": profile_source.get("domainConstraints", []),
        "boundaryTargets": [
            {
                "senseRelationId": item.get("senseRelationId"),
                "ordinal": index,
                "isRequired": item.get("isRequired", False),
            }
            for index, item in enumerate(profile_source.get("boundaryTargets", []), 1)
            if isinstance(item, dict)
        ],
        "reviewStatus": review_status,
    }
    profile.update({key: value for key, value in _provenance(attempts.get("profile")).items() if value is not None})

    assets: list[dict[str, Any]] = []
    ground_provenance = _provenance(attempts.get("grounding"))
    for kind, body, asset_id in (
        ("experience_sketch", grounding.get("experienceSketch"), f"ast-sketch-{identity['senseId']}"),
        ("l1_bridge", grounding.get("l1Bridge"), f"ast-bridge-{identity['senseId']}"),
    ):
        asset = {
            "learningAssetId": asset_id,
            "contentReleaseId": release["contentReleaseId"],
            "senseVersionId": identity["senseVersionId"],
            "kind": kind,
            "body": body,
            "learnerLocale": release["learnerLocale"],
            "sourceEvidenceRefs": _source_refs(facts),
            "reviewStatus": review_status,
            **{key: value for key, value in ground_provenance.items() if value is not None},
        }
        asset["contentDigest"] = _content_digest(asset)
        assets.append(asset)

    examples_by_id = {
        item.get("candidateId"): item
        for item in example_source.get("examples", [])
        if isinstance(item, dict)
    }
    selected = example_source.get("selectedCandidateIds") or {}
    ordered_examples: list[tuple[str, dict[str, Any]]] = []
    for role, usage in (("study", "study"), ("quiz", "cloze")):
        for candidate_id in selected.get(usage, []):
            if candidate_id in examples_by_id:
                ordered_examples.append((role, examples_by_id[candidate_id]))
    example_provenance = _provenance(attempts.get("examples"))
    for ordinal, (role, source) in enumerate(ordered_examples, 1):
        start, end = _target_span(str(source["textL2"]), str(source["targetForm"]))
        asset = {
            "learningAssetId": f"ast-ex-{identity['senseId']}-{ordinal:02d}",
            "contentReleaseId": release["contentReleaseId"],
            "senseVersionId": identity["senseVersionId"],
            "kind": "example",
            "ordinal": ordinal,
            "textL2": source["textL2"],
            "textL1": source["textL1"],
            "targetForm": source["targetForm"],
            "targetStart": start,
            "targetEnd": end,
            "construction": source["construction"],
            "sceneDomain": source["sceneDomain"],
            "disambiguatingCue": source.get("disambiguatingCue"),
            "collocations": source.get("collocations") or [],
            "variationNote": source.get("variationNote"),
            "role": role,
            "contextL2": source.get("contextL2") if role == "study" else None,
            "contextL1": source.get("contextL1") if role == "study" else None,
            "learnerLocale": release["learnerLocale"],
            "sourceEvidenceRefs": _source_refs(facts),
            "reviewStatus": review_status,
            **{key: value for key, value in example_provenance.items() if value is not None},
        }
        asset["contentDigest"] = _content_digest(asset)
        assets.append(asset)

    usage_patterns: list[dict[str, Any]] = []
    condition_provenance = _provenance(attempts.get("conditions"))
    for ordinal, source in enumerate(conditions.get("usagePatterns", []), 1):
        pattern = {
            "contentReleaseId": release["contentReleaseId"],
            "usagePatternId": f"up-{identity['senseId']}-{ordinal:02d}",
            "senseVersionId": identity["senseVersionId"],
            "ordinal": ordinal,
            "canonicalPattern": source.get("canonicalPattern"),
            "commonCollocations": source.get("commonCollocations") or [],
            "registerLabel": source.get("registerLabel"),
            "domainLabel": source.get("domainLabel"),
            "usageRestriction": source.get("usageRestriction"),
            "sourceEvidenceRefs": source.get("sourceEvidenceRefs") or [],
            "exampleAssetIds": [],
            "reviewStatus": review_status,
        }
        usage_patterns.append(pattern)
    for ordinal, source in enumerate(conditions.get("boundaries", []), 1):
        asset = {
            "learningAssetId": f"ast-contrast-{identity['senseId']}-{ordinal:02d}",
            "contentReleaseId": release["contentReleaseId"],
            "senseVersionId": identity["senseVersionId"],
            "kind": source.get("kind"),
            "senseRelationId": source.get("senseRelationId"),
            "positiveTextL2": source.get("positiveTextL2"),
            "positiveTextL1": source.get("positiveTextL1"),
            "negativeTextL2": source.get("negativeTextL2"),
            "negativeTextL1": source.get("negativeTextL1"),
            "distinguishingFeature": source.get("distinguishingFeature"),
            "learnerLocale": release["learnerLocale"],
            "sourceEvidenceRefs": [str(source.get("senseRelationId"))],
            "reviewStatus": review_status,
            **{key: value for key, value in condition_provenance.items() if value is not None},
        }
        asset["contentDigest"] = _content_digest(asset)
        assets.append(asset)

    return {
        "release": release,
        "lexemeVersion": lexeme_version,
        "senseVersion": sense_version,
        "relations": relations,
        "usagePatterns": usage_patterns,
        "profile": profile,
        "assets": assets,
    }


def build_review_subject(facts: dict[str, Any], candidate: dict[str, Any], conditions: dict[str, Any]) -> dict[str, Any]:
    return build_text_review_input(
        sense_id=facts["identity"]["senseId"],
        target=facts["target"],
        dictionary_entries=facts.get("dictionaryEntries", []),
        relations=facts.get("relations", []),
        profile=candidate["profile"],
        usage_patterns=candidate["usagePatterns"],
        text_assets=[asset for asset in candidate["assets"] if asset.get("kind") not in {"pronunciation_audio", "study_example_audio", "extended_audio"}],
        usage_pattern_status=conditions.get("usagePatternOmission") if not conditions.get("usagePatterns") else None,
    )


def add_media(candidate: dict[str, Any], media_payload: dict[str, Any]) -> dict[str, Any]:
    output = json.loads(json.dumps(candidate))
    output["assets"] = [
        asset for asset in output.get("assets", [])
        if asset.get("kind") not in {"pronunciation_audio", "study_example_audio"}
    ] + list(media_payload.get("assets") or [])
    return output


def run_package_validator(candidate_path: Path) -> dict[str, Any]:
    tsx = REPOSITORY_ROOT / "node_modules" / ".bin" / "tsx"
    command = [str(tsx), str(ROOT / "tools" / "run_validator.ts"), str(candidate_path)]
    process = subprocess.run(command, cwd=REPOSITORY_ROOT, capture_output=True, text=True)
    try:
        report = json.loads(process.stdout)
        if isinstance(report, dict):
            return report
    except json.JSONDecodeError:
        pass
    return {
        "status": "invalid",
        "validatorVersion": "sensa-package-validator-v3",
        "capabilityResolverVersion": "sensa-executable-learning-capability-resolver-v1",
        "packageDigest": "",
        "requirements": [],
        "issues": [{"code": "validator.output_invalid", "path": "$", "message": process.stderr or process.stdout}],
    }


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def export_release_candidate(
    *,
    output_root: Path,
    facts: dict[str, Any],
    candidate: dict[str, Any],
    validation: dict[str, Any],
    review_subject: dict[str, Any],
    semantic_review: dict[str, Any],
    conditions: dict[str, Any],
    media_source_root: Path,
) -> None:
    sense_id = facts["identity"]["senseId"]
    profiles = output_root / "profiles"
    assets_root = output_root / "assets" / sense_id
    packages = output_root / "packages"
    media = output_root / "media"
    write_json(profiles / f"{sense_id}.json", candidate["profile"])
    by_kind = {asset["kind"]: asset for asset in candidate["assets"] if asset.get("kind") in {"experience_sketch", "l1_bridge"}}
    write_json(assets_root / "experience_sketch.json", by_kind["experience_sketch"])
    write_json(assets_root / "l1_bridge.json", by_kind["l1_bridge"])
    write_json(assets_root / "examples.json", [asset for asset in candidate["assets"] if asset.get("kind") == "example"])
    write_json(assets_root / "usage_patterns.json", candidate.get("usagePatterns", []))
    if conditions.get("usagePatternOmission") and not candidate.get("usagePatterns"):
        write_json(assets_root / "usage_pattern_status.json", conditions["usagePatternOmission"])
    contrasts = [asset for asset in candidate["assets"] if asset.get("kind") in {"contrast_pair", "counterexample"}]
    if contrasts:
        write_json(assets_root / "contrast_pairs.json", contrasts)
    audio_assets = [asset for asset in candidate["assets"] if asset.get("kind") == "study_example_audio"]
    write_json(assets_root / "audio_assets.json", audio_assets)
    pronunciation = next((asset for asset in candidate["assets"] if asset.get("kind") == "pronunciation_audio"), None)
    if pronunciation:
        write_json(media / f"pronunciation_{candidate['lexemeVersion']['lemma']}.json", pronunciation)
    deterministic_review = {
        "schemaVersion": "sensa-deterministic-text-review-v2",
        "status": "passed",
        "validatorInputDigest": review_sha256_json(review_subject),
        "issues": [],
        "checkedAt": utc_now(),
    }
    write_json(assets_root / "deterministic_review.json", deterministic_review)
    write_json(assets_root / "semantic_review.json", semantic_review)
    manifest = {
        "contentReleaseId": candidate["release"]["contentReleaseId"],
        "senseVersionId": candidate["senseVersion"]["senseVersionId"],
        "validatorVersion": validation.get("validatorVersion"),
        "capabilityResolverVersion": validation.get("capabilityResolverVersion"),
        "packageDigest": validation.get("packageDigest"),
        "status": validation.get("status"),
        "validatedAt": utc_now(),
        "requirements": validation.get("requirements", []),
    }
    write_json(assets_root / "manifest.json", manifest)
    write_json(packages / f"{sense_id}.candidate.json", candidate)
    write_json(packages / f"{sense_id}.validation.json", validation)
    write_json(output_root / "expected-senses.json", [sense_id])
    for asset in candidate["assets"]:
        digest = asset.get("mediaSha256")
        if not isinstance(digest, str):
            continue
        source = media_source_root / "audio" / f"{digest}.mp3"
        if source.exists():
            destination = media / "audio" / source.name
            destination.parent.mkdir(parents=True, exist_ok=True)
            if not destination.exists():
                shutil.copy2(source, destination)
