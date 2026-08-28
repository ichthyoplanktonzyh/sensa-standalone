"""State machine for one isolated SensePackageBuild."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import threading
from contextlib import contextmanager, nullcontext
from pathlib import Path
from typing import Any, Iterator

from tools.automated_review import review_is_approved, run_semantic_review, sha256_json as review_sha256_json

from .compiler import (
    add_media,
    build_review_subject,
    compile_text_candidate,
    export_release_candidate,
    run_package_validator,
    write_json,
)
from .facts import load_facts
from .media import produce_package_media
from .model import issue, make_build, utc_now
from .stages import generate_conditions, generate_examples, generate_grounding, generate_profile
from .store import BuildLease, BuildStore

ROOT = Path(__file__).resolve().parent.parent
REPOSITORY_ROOT = ROOT.parent

STATUS_RANK = {
    "facts_pending": 0,
    "facts_ready": 1,
    "profile_ready": 2,
    "authoring": 3,
    "review_pending": 4,
    "text_approved": 5,
    "compiled": 6,
    "media_ready": 7,
    "package_valid": 8,
}


class ExternalCallLimits:
    """Independent in-process caps for paid/external pipeline stages."""

    def __init__(self, *, acquisition: int = 1, review: int = 1, tts: int = 1):
        values = {"acquisition": acquisition, "review": review, "tts": tts}
        for name, value in values.items():
            if value < 1:
                raise ValueError(f"{name} concurrency must be positive")
        self._limits = {
            name: threading.BoundedSemaphore(value)
            for name, value in values.items()
        }

    def permit(self, kind: str, *, enabled: bool):
        return self._limits[kind] if enabled else nullcontext()

    def call(self, kind: str, function, /, *args, enabled: bool, **kwargs):
        with self.permit(kind, enabled=enabled):
            return function(*args, **kwargs)


class Pipeline:
    def __init__(
        self,
        *,
        db_path: Path,
        store_db_path: Path | None,
        media_root: Path,
        external_limits: ExternalCallLimits | None = None,
        lease_seconds: float = 300.0,
        heartbeat_seconds: float | None = None,
    ):
        self.db_path = db_path
        self.media_root = media_root
        self.store = BuildStore(store_db_path or db_path)
        self.external_limits = external_limits or ExternalCallLimits()
        self.lease_seconds = lease_seconds
        self.heartbeat_seconds = heartbeat_seconds
        self._lease_local = threading.local()

    def create(self, sense_id: str, *, force_new: bool = False) -> dict[str, Any]:
        facts, problems = load_facts(self.db_path, sense_id)
        build = make_build(sense_id=sense_id, facts=facts)
        attempt = self.store.prepare_attempt(
            build,
            stage="facts",
            input_value={"db": str(self.db_path), "senseId": sense_id},
            payload=facts,
            issues=problems,
            provenance={"method": "authoritative_facts", "database": str(self.db_path)},
        )
        if problems:
            build["status"] = "blocked"
            build["issues"] = problems
        else:
            build["status"] = "facts_ready"
            build["selectedAttempts"] = {"facts": attempt["attemptId"]}
        stored, _ = self.store.create(
            build,
            force_new=force_new,
            initial_attempt=attempt,
        )
        return stored

    def resolve(self, *, build_id: str | None = None, sense_id: str | None = None) -> dict[str, Any]:
        if build_id:
            return self.store.load(build_id, sense_id=sense_id)
        if not sense_id:
            raise ValueError("Either build_id or sense_id is required")
        current = self.store.current(sense_id)
        if current is None:
            raise FileNotFoundError(f"No Build exists for {sense_id}; run create first")
        return current

    def _selected(self, build: dict[str, Any], stage: str) -> Any:
        return self.store.selected_payload(build, stage)

    def _attempts(self, build: dict[str, Any]) -> dict[str, dict[str, Any] | None]:
        return {stage: self.store.selected_attempt(build, stage) for stage in ("profile", "grounding", "examples", "conditions")}

    def _active_lease(self) -> BuildLease:
        lease = getattr(self._lease_local, "value", None)
        if not isinstance(lease, BuildLease):
            raise RuntimeError("A Build mutation was attempted without an active producer lease")
        lease.assert_owned()
        return lease

    @contextmanager
    def _exclusive(self, build: dict[str, Any], *, operation: str) -> Iterator[dict[str, Any]]:
        with self.store.lease(
            sense_id=build["senseId"],
            build_id=build["buildId"],
            operation=operation,
            lease_seconds=self.lease_seconds,
            heartbeat_seconds=self.heartbeat_seconds,
        ) as lease:
            previous = getattr(self._lease_local, "value", None)
            self._lease_local.value = lease
            try:
                current = self.store.load(build["buildId"], sense_id=build["senseId"])
                yield current
            finally:
                self._lease_local.value = previous

    def _save(self, build: dict[str, Any]) -> dict[str, Any]:
        lease = self._active_lease()
        self.store.save(build, lease=lease)
        return self.store.load(build["buildId"], sense_id=build["senseId"])

    def _record(
        self,
        build: dict[str, Any],
        *,
        stage: str,
        input_value: Any,
        payload: Any,
        provenance: dict[str, Any],
        problems: list[dict[str, Any]],
        success_status: str,
    ) -> dict[str, Any]:
        if not isinstance(getattr(self._lease_local, "value", None), BuildLease):
            with self._exclusive(build, operation=f"stage:{stage}") as current:
                return self._record(
                    current,
                    stage=stage,
                    input_value=input_value,
                    payload=payload,
                    provenance=provenance,
                    problems=problems,
                    success_status=success_status,
                )
        lease = self._active_lease()
        build, _ = self.store.record_attempt(
            build,
            stage=stage,
            input_value=input_value,
            payload=payload,
            issues=problems,
            provenance=provenance,
            lease=lease,
        )
        if problems:
            build["status"] = "blocked"
            build["issues"] = problems
        else:
            build["status"] = success_status
            build["issues"] = []
        lease.assert_owned()
        self.store.save(build, lease=lease)
        return self.store.load(build["buildId"], sense_id=build["senseId"])

    def plan(self, build: dict[str, Any]) -> dict[str, Any]:
        selected = build.get("selectedAttempts") or {}
        if build.get("status") == "blocked":
            issue_stages = {
                str(item.get("stage"))
                for item in build.get("issues", [])
                if isinstance(item, dict) and item.get("stage")
            }
            if "facts" not in selected:
                next_action = "fix_inventory_and_create_new_build"
            elif issue_stages == {"media"}:
                next_action = "retry_media"
            elif issue_stages == {"package_gate"}:
                next_action = "inspect_package_gate_or_repair_authoring"
            elif issue_stages == {"semantic_review"}:
                next_action = "repair_rejected_artifacts_or_retry_review"
            else:
                next_action = "repair"
            return {
                "buildId": build["buildId"],
                "status": "blocked",
                "nextAction": next_action,
                "issues": build.get("issues", []),
            }
        sequence = (
            ("facts", "load_facts", "none"),
            ("profile", "generate_profile", "llm"),
            ("grounding", "generate_grounding", "llm"),
            ("examples", "generate_examples", "llm"),
            ("conditions", "generate_conditions", "conditional_llm"),
            ("text_compile", "compile_review_subject", "none"),
            ("semantic_review", "semantic_review", "review_llm"),
            ("final_compile", "compile_approved_text", "none"),
            ("media", "produce_media", "tts_or_cache"),
            ("package_gate", "validate_package", "none"),
        )
        for stage, action, external in sequence:
            if stage not in selected:
                return {
                    "buildId": build["buildId"],
                    "status": build["status"],
                    "nextStage": stage,
                    "nextAction": action,
                    "externalRequirement": external,
                }
        return {"buildId": build["buildId"], "status": "package_valid", "nextAction": None}

    def _generate_profile(self, build: dict[str, Any], *, allow_llm: bool) -> dict[str, Any]:
        facts = self._selected(build, "facts")
        with self.external_limits.permit("acquisition", enabled=allow_llm):
            payload, provenance, problems = generate_profile(facts, allow_external=allow_llm)
        return self._record(build, stage="profile", input_value=facts, payload=payload, provenance=provenance, problems=problems, success_status="profile_ready")

    def _generate_grounding(self, build: dict[str, Any], *, allow_llm: bool) -> dict[str, Any]:
        facts = self._selected(build, "facts")
        profile = self._selected(build, "profile")
        with self.external_limits.permit("acquisition", enabled=allow_llm):
            payload, provenance, problems = generate_grounding(facts, profile, allow_external=allow_llm)
        return self._record(build, stage="grounding", input_value={"facts": facts, "profile": profile}, payload=payload, provenance=provenance, problems=problems, success_status="authoring")

    def _generate_examples(self, build: dict[str, Any], *, allow_llm: bool) -> dict[str, Any]:
        facts = self._selected(build, "facts")
        profile = self._selected(build, "profile")
        grounding = self._selected(build, "grounding")
        with self.external_limits.permit("acquisition", enabled=allow_llm):
            payload, provenance, problems = generate_examples(facts, profile, grounding, allow_external=allow_llm)
        return self._record(build, stage="examples", input_value={"facts": facts, "profile": profile, "grounding": grounding}, payload=payload, provenance=provenance, problems=problems, success_status="authoring")

    def _generate_conditions(self, build: dict[str, Any], *, allow_llm: bool) -> dict[str, Any]:
        facts = self._selected(build, "facts")
        profile = self._selected(build, "profile")
        with self.external_limits.permit("acquisition", enabled=allow_llm):
            payload, provenance, problems = generate_conditions(facts, profile, allow_external=allow_llm)
        return self._record(build, stage="conditions", input_value={"facts": facts, "profile": profile}, payload=payload, provenance=provenance, problems=problems, success_status="authoring")

    def _compile_text(self, build: dict[str, Any], *, approved: bool, stage: str) -> dict[str, Any]:
        facts = self._selected(build, "facts")
        profile = self._selected(build, "profile")
        grounding = self._selected(build, "grounding")
        examples = self._selected(build, "examples")
        conditions = self._selected(build, "conditions")
        candidate = compile_text_candidate(
            facts=facts,
            profile_source=profile,
            grounding=grounding,
            example_source=examples,
            conditions=conditions,
            attempts=self._attempts(build),
            approved=approved,
        )
        subject = build_review_subject(facts, candidate, conditions)
        payload = {"candidate": candidate, "reviewSubject": subject}
        status = "compiled" if approved else "review_pending"
        return self._record(
            build,
            stage=stage,
            input_value={"selectedAttempts": build["selectedAttempts"], "approved": approved},
            payload=payload,
            provenance={"method": "deterministic_compiler", "compilerVersion": "sensa-v2-delivery-compiler-v2"},
            problems=[],
            success_status=status,
        )

    def _semantic_review(
        self,
        build: dict[str, Any],
        *,
        allow_review: bool,
        force: bool = False,
    ) -> dict[str, Any]:
        if not allow_review:
            raise PermissionError("Independent semantic review requires explicit --allow-review")
        compiled = self._selected(build, "text_compile")
        subject = compiled["reviewSubject"]
        with self.external_limits.permit("review", enabled=True):
            with tempfile.TemporaryDirectory(prefix="sensa-semantic-review-") as temporary:
                report = run_semantic_review(
                    subject,
                    report_path=Path(temporary) / "semantic-review.json",
                    force=force,
                )
        digest = review_sha256_json(subject)
        approved = review_is_approved(report, digest)
        problems: list[dict[str, Any]] = []
        if not approved:
            raw_issues = report.get("issues") if isinstance(report, dict) else []
            for item in raw_issues if isinstance(raw_issues, list) else []:
                problems.append(issue(
                    str(item.get("code") or "review.needs_revision"),
                    str(item.get("message") or "Semantic review needs revision"),
                    stage="semantic_review",
                    path=str(item.get("path") or "$"),
                    artifact_id=item.get("artifactId") if isinstance(item.get("artifactId"), str) else None,
                ))
            if not problems:
                problems.append(issue("review.not_approved", "Semantic reviewer did not approve this exact build", stage="semantic_review"))
        return self._record(
            build,
            stage="semantic_review",
            input_value=subject,
            payload=report,
            provenance={
                "method": "independent_semantic_review",
                "provider": report.get("provider") if isinstance(report, dict) else None,
                "model": report.get("model") if isinstance(report, dict) else None,
                "promptVersion": report.get("reviewPromptVersion") if isinstance(report, dict) else None,
                "inputDigest": digest,
            },
            problems=problems,
            success_status="text_approved",
        )

    def _media(self, build: dict[str, Any], *, allow_tts: bool) -> dict[str, Any]:
        candidate = self._selected(build, "final_compile")["candidate"]
        try:
            with self.external_limits.permit("tts", enabled=allow_tts):
                payload = produce_package_media(
                    candidate,
                    media_root=self.media_root,
                    cache_db_path=self.store.db_path,
                    allow_external=allow_tts,
                )
            problems: list[dict[str, Any]] = []
        except Exception as exc:
            payload = {"assets": [], "cacheHits": 0, "generated": 0}
            problems = [issue("media.production_failed", str(exc), stage="media")]
        return self._record(
            build,
            stage="media",
            input_value={"candidateDigest": self.store.selected_attempt(build, "final_compile")["outputDigest"]},
            payload=payload,
            provenance={"method": "content_addressed_tts", "provider": "microsoft-edge-tts", "model": "neural-v1"},
            problems=problems,
            success_status="media_ready",
        )

    def _package_gate(self, build: dict[str, Any]) -> dict[str, Any]:
        candidate = add_media(self._selected(build, "final_compile")["candidate"], self._selected(build, "media"))
        with tempfile.TemporaryDirectory(prefix="sensa-package-gate-") as temporary:
            candidate_path = Path(temporary) / "package.candidate.json"
            write_json(candidate_path, candidate)
            validation = run_package_validator(candidate_path)
        validation["packageStorage"] = "sqlite:package_build_attempts"
        validation["checkedAt"] = utc_now()
        problems = [
            issue(str(item.get("code")), str(item.get("message")), stage="package_gate", path=str(item.get("path") or "$"))
            for item in validation.get("issues", [])
        ] if validation.get("status") != "satisfied" else []
        payload = {"candidate": candidate, "validation": validation}
        return self._record(
            build,
            stage="package_gate",
            input_value=candidate,
            payload=payload,
            provenance={"method": "sensa-package-validator-v3"},
            problems=problems,
            success_status="package_valid",
        )

    def run(
        self,
        build: dict[str, Any],
        *,
        until: str,
        allow_llm: bool,
        allow_review: bool,
        allow_tts: bool,
    ) -> dict[str, Any]:
        with self._exclusive(build, operation=f"run:{until}") as current:
            return self._run_claimed(
                current,
                until=until,
                allow_llm=allow_llm,
                allow_review=allow_review,
                allow_tts=allow_tts,
            )

    def _run_claimed(
        self,
        build: dict[str, Any],
        *,
        until: str,
        allow_llm: bool,
        allow_review: bool,
        allow_tts: bool,
    ) -> dict[str, Any]:
        if until not in STATUS_RANK:
            raise ValueError(f"Unsupported --until status: {until}")
        def reached() -> bool:
            if until == "authoring":
                selected = build.get("selectedAttempts") or {}
                return all(stage in selected for stage in ("grounding", "examples", "conditions"))
            return STATUS_RANK.get(build.get("status"), -1) >= STATUS_RANK[until]

        while build.get("status") != "blocked" and not reached():
            action = self.plan(build).get("nextStage")
            if action == "profile":
                build = self._generate_profile(build, allow_llm=allow_llm)
            elif action == "grounding":
                build = self._generate_grounding(build, allow_llm=allow_llm)
            elif action == "examples":
                build = self._generate_examples(build, allow_llm=allow_llm)
            elif action == "conditions":
                build = self._generate_conditions(build, allow_llm=allow_llm)
            elif action == "text_compile":
                build = self._compile_text(build, approved=False, stage="text_compile")
            elif action == "semantic_review":
                build = self._semantic_review(build, allow_review=allow_review)
            elif action == "final_compile":
                build = self._compile_text(build, approved=True, stage="final_compile")
            elif action == "media":
                build = self._media(build, allow_tts=allow_tts)
            elif action == "package_gate":
                build = self._package_gate(build)
            elif action is None:
                break
            else:
                raise RuntimeError(f"Unexpected next stage: {action}")
        return build

    def retry(
        self,
        build: dict[str, Any],
        *,
        stage: str,
        allow_review: bool,
        allow_tts: bool,
    ) -> dict[str, Any]:
        with self._exclusive(build, operation=f"retry:{stage}") as current:
            return self._retry_claimed(
                current,
                stage=stage,
                allow_review=allow_review,
                allow_tts=allow_tts,
            )

    def _retry_claimed(
        self,
        build: dict[str, Any],
        *,
        stage: str,
        allow_review: bool,
        allow_tts: bool,
    ) -> dict[str, Any]:
        """Retry a transient review/media/gate failure without changing authoring."""

        if build.get("status") != "blocked":
            raise ValueError("Only a blocked Build can be retried")
        if stage not in {"semantic_review", "media", "package_gate"}:
            raise ValueError("Retry stage must be semantic_review, media, or package_gate")
        issue_stages = {
            str(item.get("stage"))
            for item in build.get("issues", [])
            if isinstance(item, dict) and item.get("stage")
        }
        if issue_stages and stage not in issue_stages:
            raise ValueError(f"Build is not blocked at {stage}; current issue stages: {sorted(issue_stages)}")

        build = self.store.invalidate_from(build, stage, reason=f"explicit retry of {stage}")
        build["issues"] = []
        if stage == "semantic_review":
            if self._selected(build, "text_compile") is None:
                raise ValueError("Cannot retry semantic review without a compiled review subject")
            build["status"] = "review_pending"
        elif stage == "media":
            if self._selected(build, "final_compile") is None:
                raise ValueError("Cannot retry media without approved compiled text")
            build["status"] = "compiled"
        else:
            if self._selected(build, "media") is None:
                raise ValueError("Cannot retry package gate without selected media")
            build["status"] = "media_ready"
        build = self._save(build)

        if stage == "semantic_review":
            return self._semantic_review(build, allow_review=allow_review, force=True)
        if stage == "media":
            return self._media(build, allow_tts=allow_tts)
        return self._package_gate(build)

    def rebuild_text(self, build: dict[str, Any]) -> dict[str, Any]:
        with self._exclusive(build, operation="rebuild-text") as current:
            return self._rebuild_text_claimed(current)

    def _rebuild_text_claimed(self, build: dict[str, Any]) -> dict[str, Any]:
        """Re-run deterministic compilation/review after a compiler contract change."""

        required = {"facts", "profile", "grounding", "examples", "conditions"}
        selected = set((build.get("selectedAttempts") or {}).keys())
        if not required.issubset(selected):
            raise ValueError("Cannot rebuild text until all authoring stages are selected")
        build = self.store.invalidate_from(
            build,
            "text_compile",
            reason="explicit deterministic compiler rebuild",
        )
        build["issues"] = []
        build["status"] = "authoring"
        return self._save(build)

    def repair(
        self,
        build: dict[str, Any],
        *,
        stage: str,
        instruction: str,
        artifact_id: str | None,
        allow_llm: bool,
    ) -> dict[str, Any]:
        with self._exclusive(build, operation=f"repair:{stage}") as current:
            return self._repair_claimed(
                current,
                stage=stage,
                instruction=instruction,
                artifact_id=artifact_id,
                allow_llm=allow_llm,
            )

    def _repair_claimed(
        self,
        build: dict[str, Any],
        *,
        stage: str,
        instruction: str,
        artifact_id: str | None,
        allow_llm: bool,
    ) -> dict[str, Any]:
        if stage not in {"profile", "grounding", "examples", "conditions"}:
            raise ValueError("Repair stage must be profile, grounding, examples, or conditions")
        facts = self._selected(build, "facts")
        if facts is None:
            raise ValueError("Facts are not available; create a new Build after fixing inventory data")
        existing = self._selected(build, stage)
        if stage == "profile":
            payload, provenance, problems = self.external_limits.call(
                "acquisition", generate_profile, facts,
                enabled=allow_llm,
                allow_external=allow_llm,
                repair_instruction=instruction,
            )
            status = "profile_ready"
        elif stage == "grounding":
            generated, provenance, problems = self.external_limits.call(
                "acquisition", generate_grounding,
                facts,
                self._selected(build, "profile"),
                enabled=allow_llm,
                allow_external=allow_llm,
                repair_instruction=instruction,
                existing=existing,
            )
            if artifact_id in {"experience_sketch", "l1_bridge"} and isinstance(existing, dict):
                key = "experienceSketch" if artifact_id == "experience_sketch" else "l1Bridge"
                payload = {**existing, key: generated.get(key)}
                from .validation import validate_grounding

                problems = validate_grounding(payload, facts)
            else:
                payload = generated
            status = "authoring"
        elif stage == "examples":
            payload, provenance, problems = self.external_limits.call(
                "acquisition", generate_examples,
                facts,
                self._selected(build, "profile"),
                self._selected(build, "grounding"),
                enabled=allow_llm,
                allow_external=allow_llm,
                existing=existing,
                repair_instruction=instruction,
                artifact_id=artifact_id,
            )
            status = "authoring"
        else:
            payload, provenance, problems = self.external_limits.call(
                "acquisition", generate_conditions,
                facts,
                self._selected(build, "profile"),
                enabled=allow_llm,
                allow_external=allow_llm,
                existing=existing,
                repair_instruction=instruction,
            )
            status = "authoring"
        build = self.store.invalidate_from(build, stage, reason=instruction)
        build["issues"] = []
        build["status"] = status
        return self._record(
            build,
            stage=stage,
            input_value={"existing": existing, "instruction": instruction, "artifactId": artifact_id},
            payload=payload,
            provenance=provenance,
            problems=problems,
            success_status=status,
        )

    def export(self, builds: list[dict[str, Any]], output_root: Path) -> dict[str, Any]:
        output_root = output_root.resolve()
        if output_root.exists():
            raise FileExistsError(f"Release output already exists: {output_root}")
        output_root.parent.mkdir(parents=True, exist_ok=True)
        staging = Path(tempfile.mkdtemp(
            prefix=f".{output_root.name}.staging-",
            dir=output_root.parent,
        ))
        try:
            senses: list[str] = []
            for build in builds:
                if build.get("status") != "package_valid":
                    raise ValueError(f"Build is not package_valid: {build['buildId']}")
                facts = self._selected(build, "facts")
                gate = self._selected(build, "package_gate")
                text_compile = self._selected(build, "text_compile")
                semantic_review = self._selected(build, "semantic_review")
                conditions = self._selected(build, "conditions")
                export_release_candidate(
                    output_root=staging,
                    facts=facts,
                    candidate=gate["candidate"],
                    validation=gate["validation"],
                    review_subject=text_compile["reviewSubject"],
                    semantic_review=semantic_review,
                    conditions=conditions,
                    media_source_root=self.media_root,
                )
                senses.append(build["senseId"])
            write_json(staging / "expected-senses.json", sorted(senses))
            command = [
                sys.executable,
                str(ROOT / "tools" / "validate_release.py"),
                "--db", str(self.db_path),
                "--profiles-dir", str(staging / "profiles"),
                "--assets-dir", str(staging / "assets"),
                "--packages-dir", str(staging / "packages"),
                "--media-dir", str(staging / "media"),
                "--expected-senses", str(staging / "expected-senses.json"),
                "--report", str(staging / "release-validation.json"),
            ]
            process = subprocess.run(command, cwd=REPOSITORY_ROOT, capture_output=True, text=True)
            try:
                report = json.loads(process.stdout)
            except json.JSONDecodeError:
                report = {"summary": {"errors": 1}, "stderr": process.stderr, "stdout": process.stdout}
            if (report.get("summary") or {}).get("errors", 1):
                return report
            if output_root.exists():
                raise FileExistsError(f"Release output was created concurrently: {output_root}")
            try:
                staging.rename(output_root)
            except OSError as exc:
                if output_root.exists():
                    raise FileExistsError(
                        f"Release output was created concurrently: {output_root}"
                    ) from exc
                raise
            return report
        finally:
            if staging.exists():
                shutil.rmtree(staging)
