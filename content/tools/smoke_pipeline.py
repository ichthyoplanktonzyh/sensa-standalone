#!/usr/bin/env python3
"""No-cost smoke for Build state, compilation, invalidation and package gate."""

from __future__ import annotations

import json
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from pipeline.model import issue, sha256_text, utc_now  # noqa: E402
from pipeline.orchestrator import Pipeline  # noqa: E402
from pipeline.validation import validate_conditions, validate_examples, validate_grounding, validate_profile  # noqa: E402
from tools.automated_review import (  # noqa: E402
    REQUIRED_CHECKS,
    REVIEW_PROMPT_VERSION,
    REVIEW_SCHEMA_VERSION,
    sha256_json,
)


def make_db(path: Path) -> None:
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        CREATE TABLE senses (
          sense_id TEXT PRIMARY KEY, word TEXT, lemma TEXT, sense_num INTEGER,
          pos TEXT, label_zh TEXT, definition TEXT, semantic_type TEXT,
          dimension TEXT, valency TEXT, register TEXT, teaching_priority TEXT,
          source_entries TEXT
        );
        CREATE TABLE relations (
          id INTEGER PRIMARY KEY, word TEXT, source_sense_id TEXT,
          target_sense_id TEXT, relation TEXT, distinction TEXT
        );
        CREATE TABLE dictionary_entries (
          entry_id TEXT PRIMARY KEY, word TEXT, entry_order INTEGER,
          pos TEXT, gloss TEXT, examples TEXT
        );
        CREATE TABLE lexemes (lemma TEXT PRIMARY KEY);
        """
    )
    connection.execute(
        "INSERT INTO senses VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            "borrow-01", "borrow", "borrow", 1, "verb", "借用",
            "To receive something temporarily with an obligation to return it.",
            "action", "possession", "transitive", "neutral", "core",
            json.dumps(["dict-entry-borrow-01"]),
        ),
    )
    connection.execute(
        "INSERT INTO dictionary_entries VALUES (?, ?, ?, ?, ?, ?)",
        (
            "dict-entry-borrow-01", "borrow", 1, "verb",
            "receive something temporarily and return it",
            json.dumps(["Can I borrow your pen?"]),
        ),
    )
    connection.execute("INSERT INTO lexemes VALUES (?)", ("borrow",))
    connection.commit()
    connection.close()


def attempt_provenance(stage: str) -> dict[str, str]:
    return {"method": "fixture", "provider": "smoke", "model": "smoke", "promptVersion": f"{stage}-smoke-v1"}


def record(pipeline: Pipeline, build: dict, stage: str, payload: object, status: str) -> dict:
    build, _ = pipeline.store.record_attempt(
        build,
        stage=stage,
        input_value={"stage": stage},
        payload=payload,
        provenance=attempt_provenance(stage),
    )
    build["status"] = status
    build["issues"] = []
    pipeline.store.save(build)
    return pipeline.store.load(build["buildId"], sense_id=build["senseId"])


def fake_media(candidate: dict) -> dict:
    release = candidate["release"]["contentReleaseId"]
    lemma = candidate["lexemeVersion"]["lemma"]
    pron_digest = sha256_text("pron-audio")
    assets = [{
        "learningAssetId": f"ast-audio-pron-{lemma}",
        "contentReleaseId": release,
        "kind": "pronunciation_audio",
        "lexemeVersionId": candidate["lexemeVersion"]["lexemeVersionId"],
        "mediaBlobId": f"blob-{pron_digest}",
        "mediaSha256": pron_digest,
        "sourceTextDigest": sha256_text(lemma),
        "mimeType": "audio/mp3",
        "sizeBytes": 10,
        "durationMs": 100,
        "provider": "smoke-tts",
        "model": "smoke-v1",
        "voice": "smoke",
        "accentLocale": "en-US",
        "contentDigest": pron_digest,
        "sourceEvidenceRefs": ["tts-generated"],
        "reviewStatus": "approved",
    }]
    studies = [asset for asset in candidate["assets"] if asset.get("kind") == "example" and asset.get("role") == "study"]
    for index, example in enumerate(studies, 1):
        digest = sha256_text(f"study-audio-{index}")
        assets.append({
            "learningAssetId": f"ast-audio-borrow-01-study-{index:02d}",
            "contentReleaseId": release,
            "kind": "study_example_audio",
            "senseVersionId": candidate["senseVersion"]["senseVersionId"],
            "sourceExampleAssetId": example["learningAssetId"],
            "learnerLocale": "zh-Hans",
            "mediaBlobId": f"blob-{digest}",
            "mediaSha256": digest,
            "sourceTextDigest": sha256_text(example["textL2"]),
            "mimeType": "audio/mp3",
            "sizeBytes": 10,
            "durationMs": 100,
            "provider": "smoke-tts",
            "model": "smoke-v1",
            "voice": "smoke",
            "accentLocale": "en-US",
            "contentDigest": digest,
            "sourceEvidenceRefs": ["tts-generated"],
            "reviewStatus": "approved",
        })
    return {"assets": assets, "cacheHits": 4, "generated": 0}


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="sensa-pipeline-smoke-") as temporary:
        root = Path(temporary)
        db = root / "senses.db"
        make_db(db)
        pipeline = Pipeline(
            db_path=db,
            store_db_path=db,
            media_root=root / "media",
        )
        build = pipeline.create("borrow-01")
        assert build["status"] == "facts_ready", build
        facts = pipeline.store.selected_payload(build, "facts")
        profile = {
            "acquisitionNeeds": ["perceptual_grounding", "form_binding"],
            "minimumSufficientExperience": "暂时拿走一件东西，同时明确知道之后必须归还。",
            "distinguishingFeatures": ["temporary possession", "obligation to return"],
            "preferredPrimitives": ["social_micro_scenario"],
            "fallbackPrimitives": ["contextual_variation"],
            "requiredCapabilities": ["meaning_grounding", "l1_mediation"],
            "optionalCapabilities": ["usage_pattern", "boundary_contrast"],
            "domainBound": False,
            "domainConstraints": [],
            "boundaryTargets": [],
        }
        assert not validate_profile(profile, facts)
        boundary_without_target = {
            **profile,
            "acquisitionNeeds": [*profile["acquisitionNeeds"], "boundary_formation"],
        }
        assert "profile.boundary_target_missing" in {
            problem["code"] for problem in validate_profile(boundary_without_target, facts)
        }
        build = record(pipeline, build, "profile", profile, "profile_ready")
        grounding = {
            "experienceSketch": "你从朋友那里拿走一本书，读完以后还要原样还给对方。",
            "l1Bridge": "中文都说“借”，这个表达强调拿入自己手中，并且以后要归还。",
        }
        assert not validate_grounding(grounding, facts)
        build = record(pipeline, build, "grounding", grounding, "authoring")
        study_texts = [
            ("Can I borrow your pen for a minute?", "我能借一下你的笔吗？", "A form needs signing right now.", "这张表现在就要签字。"),
            ("Students may borrow books from this library.", "学生可以从这座图书馆借书。", "The research project needs several references.", "这个研究项目需要几份参考资料。"),
            ("We had to borrow money from the bank.", "我们不得不向银行借钱。", "The repair cost was higher than expected.", "维修费用比预想的高。"),
        ]
        cloze_texts = [
            ("She asked to borrow my umbrella.", "她提出要借我的伞。"),
            ("Could we borrow two chairs for the meeting?", "我们能为会议借两把椅子吗？"),
            ("He will borrow a camera for the weekend.", "他周末会借一台相机。"),
        ]
        examples = []
        for index, (l2, l1, c2, c1) in enumerate(study_texts, 1):
            examples.append({
                "candidateId": f"study-{index}", "textL2": l2, "textL1": l1,
                "contextL2": c2, "contextL1": c1, "targetForm": "borrow",
                "usages": ["study"], "construction": "head_verb",
                "sceneDomain": "daily_life", "disambiguatingCue": None,
                "collocations": [], "variationNote": None,
            })
        for index, (l2, l1) in enumerate(cloze_texts, 1):
            examples.append({
                "candidateId": f"cloze-{index}", "textL2": l2, "textL1": l1,
                "contextL2": None, "contextL1": None, "targetForm": "borrow",
                "usages": ["cloze"], "construction": "head_verb",
                "sceneDomain": "daily_life", "disambiguatingCue": None,
                "collocations": [], "variationNote": None,
            })
        example_payload = {
            "examples": examples,
            "selectedCandidateIds": {
                "study": [f"study-{index}" for index in range(1, 4)],
                "cloze": [f"cloze-{index}" for index in range(1, 4)],
            },
        }
        assert not validate_examples(example_payload, facts)
        build = record(pipeline, build, "examples", example_payload, "authoring")
        conditions = {
            "usagePatterns": [],
            "usagePatternOmission": {"status": "omitted", "reason": "Optional and not needed for this smoke package."},
            "boundaries": [],
        }
        assert not validate_conditions(conditions, facts, profile)
        build = record(pipeline, build, "conditions", conditions, "authoring")
        build = pipeline._compile_text(build, approved=False, stage="text_compile")
        assert build["status"] == "review_pending"
        subject = pipeline.store.selected_payload(build, "text_compile")["reviewSubject"]
        now = utc_now()
        semantic = {
            "schemaVersion": REVIEW_SCHEMA_VERSION,
            "reviewMethod": "automated_semantic",
            "reviewPromptVersion": REVIEW_PROMPT_VERSION,
            "provider": "smoke-reviewer",
            "model": "smoke-v1",
            "inputDigest": sha256_json(subject),
            "requestedAt": now,
            "reviewedAt": now,
            "verdict": "approved",
            "checks": {name: {"status": "pass"} for name in REQUIRED_CHECKS},
            "issues": [],
        }
        build = record(pipeline, build, "semantic_review", semantic, "text_approved")
        build = pipeline._compile_text(build, approved=True, stage="final_compile")
        candidate = pipeline.store.selected_payload(build, "final_compile")["candidate"]
        build = record(pipeline, build, "media", fake_media(candidate), "media_ready")
        build = pipeline._package_gate(build)
        assert build["status"] == "package_valid", build.get("issues")

        # A transient package-gate failure can be retried in place without
        # regenerating or re-reviewing any authoring artifacts.
        build = pipeline.store.invalidate_from(build, "package_gate", reason="smoke transient gate failure")
        build["status"] = "blocked"
        build["issues"] = [issue("package_gate.transient", "smoke", stage="package_gate")]
        pipeline.store.save(build)
        build = pipeline.store.load(build["buildId"], sense_id=build["senseId"])
        assert pipeline.plan(build)["nextAction"] == "inspect_package_gate_or_repair_authoring"
        build = pipeline.retry(build, stage="package_gate", allow_review=False, allow_tts=False)
        assert build["status"] == "package_valid", build.get("issues")

        # A replacement at the grounding seam preserves facts/profile and
        # invalidates only dependent authoring/review/media/package attempts.
        build, _ = pipeline.store.record_attempt(
            build,
            stage="grounding",
            input_value={"repair": True},
            payload=grounding,
            provenance=attempt_provenance("grounding-repair"),
        )
        assert "facts" in build["selectedAttempts"] and "profile" in build["selectedAttempts"]
        assert "examples" not in build["selectedAttempts"] and "package_gate" not in build["selectedAttempts"]
        print("state-driven pipeline smoke passed")


if __name__ == "__main__":
    main()
