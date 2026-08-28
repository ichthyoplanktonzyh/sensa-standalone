#!/usr/bin/env python3
"""Operator CLI for state-driven Sense Learning Package builds."""

from __future__ import annotations

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from pipeline.orchestrator import STATUS_RANK, ExternalCallLimits, Pipeline  # noqa: E402
from pipeline.store import LeaseBusyError  # noqa: E402

DEFAULT_DB = ROOT / "data" / "senses.db"
DEFAULT_MEDIA = ROOT / "data" / "media"


def _json(value: Any) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2))


def _pipeline(
    args: argparse.Namespace,
    *,
    external_limits: ExternalCallLimits | None = None,
) -> Pipeline:
    return Pipeline(
        db_path=Path(args.db),
        store_db_path=Path(args.store_db),
        media_root=Path(args.media_dir),
        external_limits=external_limits,
    )


def _add_paths(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--db", default=str(DEFAULT_DB))
    parser.add_argument("--store-db", default=str(DEFAULT_DB), help="SQLite store for Builds, attempts and media metadata")
    parser.add_argument("--media-dir", default=str(DEFAULT_MEDIA))


def _resolve(pipeline: Pipeline, args: argparse.Namespace) -> dict[str, Any]:
    return pipeline.resolve(build_id=getattr(args, "build", None), sense_id=getattr(args, "sense", None))


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="State-driven Sensa Sense Learning Package pipeline")
    sub = root.add_subparsers(dest="command", required=True)

    create = sub.add_parser("create", help="Create an isolated Build and load authoritative facts")
    create.add_argument("--sense", required=True)
    create.add_argument("--new", action="store_true", help="Create a new Build even when the current facts digest matches")
    _add_paths(create)

    plan = sub.add_parser("plan", help="Show the next stage without external calls")
    plan.add_argument("--build")
    plan.add_argument("--sense")
    _add_paths(plan)

    inspect = sub.add_parser("inspect", help="Show Build state, selected attempts and issues")
    inspect.add_argument("--build")
    inspect.add_argument("--sense")
    _add_paths(inspect)

    run = sub.add_parser("run", help="Advance a Build until the requested state")
    run.add_argument("--build")
    run.add_argument("--sense")
    run.add_argument(
        "--until",
        default="package_valid",
        choices=("facts_ready", "profile_ready", "authoring", "review_pending", "text_approved", "compiled", "media_ready", "package_valid"),
    )
    run.add_argument("--allow-llm", action="store_true", help="Allow acquisition/content generation provider calls")
    run.add_argument("--allow-review", action="store_true", help="Allow the separately configured semantic reviewer")
    run.add_argument("--allow-tts", action="store_true", help="Allow TTS only for media cache misses")
    _add_paths(run)

    repair = sub.add_parser("repair", help="Replace one selected stage/artifact and invalidate only downstream attempts")
    repair.add_argument("--build")
    repair.add_argument("--sense")
    repair.add_argument("--stage", required=True, choices=("profile", "grounding", "examples", "conditions"))
    repair.add_argument("--artifact-id")
    repair.add_argument("--instruction", required=True)
    repair.add_argument("--allow-llm", action="store_true", required=True)
    _add_paths(repair)

    retry = sub.add_parser("retry", help="Retry a transient review, media or package-gate failure")
    retry.add_argument("--build")
    retry.add_argument("--sense")
    retry.add_argument("--stage", required=True, choices=("semantic_review", "media", "package_gate"))
    retry.add_argument("--allow-review", action="store_true", help="Allow a fresh semantic review call")
    retry.add_argument("--allow-tts", action="store_true", help="Allow TTS for media cache misses")
    _add_paths(retry)

    rebuild = sub.add_parser("rebuild-text", help="Invalidate compiled/review/media stages after a compiler change")
    rebuild.add_argument("--build")
    rebuild.add_argument("--sense")
    _add_paths(rebuild)

    release = sub.add_parser("release", help="Export package-valid Builds and run the no-cost release gate")
    release.add_argument("--build", action="append", required=True, dest="builds")
    release.add_argument("--out", required=True)
    _add_paths(release)

    batch = sub.add_parser("batch", help="Create/reuse and concurrently advance explicitly listed Senses")
    batch.add_argument("--sense", action="append", default=[], dest="senses")
    batch.add_argument("--sense-file", help="UTF-8 file with one Sense ID per line; blank lines and # comments are ignored")
    batch.add_argument("--concurrency", type=int, default=4)
    batch.add_argument("--llm-concurrency", type=int, default=1)
    batch.add_argument("--review-concurrency", type=int, default=1)
    batch.add_argument("--tts-concurrency", type=int, default=1)
    batch.add_argument(
        "--until",
        default="package_valid",
        choices=("facts_ready", "profile_ready", "authoring", "review_pending", "text_approved", "compiled", "media_ready", "package_valid"),
    )
    batch.add_argument("--allow-llm", action="store_true")
    batch.add_argument("--allow-review", action="store_true")
    batch.add_argument("--allow-tts", action="store_true")
    _add_paths(batch)
    return root


def _batch_senses(args: argparse.Namespace) -> list[str]:
    values = [str(value).strip() for value in args.senses]
    if args.sense_file:
        for line in Path(args.sense_file).read_text(encoding="utf-8").splitlines():
            value = line.strip()
            if value and not value.startswith("#"):
                values.append(value)
    return list(dict.fromkeys(value for value in values if value))


def _batch(args: argparse.Namespace) -> tuple[dict[str, Any], bool]:
    senses = _batch_senses(args)
    if not senses:
        raise ValueError("batch requires at least one explicit --sense or --sense-file entry")
    caps = {
        "concurrency": args.concurrency,
        "llmConcurrency": args.llm_concurrency,
        "reviewConcurrency": args.review_concurrency,
        "ttsConcurrency": args.tts_concurrency,
    }
    if args.concurrency < 1:
        raise ValueError("--concurrency must be positive")
    for name, value in caps.items():
        if value < 1 or (name != "concurrency" and value > args.concurrency):
            raise ValueError(f"{name} must be between 1 and --concurrency")
    limits = ExternalCallLimits(
        acquisition=args.llm_concurrency,
        review=args.review_concurrency,
        tts=args.tts_concurrency,
    )
    pipeline = _pipeline(args, external_limits=limits)

    def produce(sense_id: str) -> dict[str, Any]:
        try:
            build = pipeline.create(sense_id)
            result = pipeline.run(
                build,
                until=args.until,
                allow_llm=args.allow_llm,
                allow_review=args.allow_review,
                allow_tts=args.allow_tts,
            )
            selected = result.get("selectedAttempts") or {}
            reached = (
                all(stage in selected for stage in ("grounding", "examples", "conditions"))
                if args.until == "authoring"
                else STATUS_RANK.get(result.get("status"), -1) >= STATUS_RANK[args.until]
            )
            outcome = (
                "blocked" if result.get("status") == "blocked"
                else "succeeded" if reached
                else "failed"
            )
            return {
                "senseId": sense_id,
                "buildId": result.get("buildId"),
                "outcome": outcome,
                "buildStatus": result.get("status"),
                "reachedTarget": reached,
                "issues": result.get("issues", []),
            }
        except LeaseBusyError as exc:
            return {"senseId": sense_id, "buildId": None, "outcome": "busy", "error": str(exc)}
        except Exception as exc:
            return {"senseId": sense_id, "buildId": None, "outcome": "failed", "error": str(exc)}

    by_sense: dict[str, dict[str, Any]] = {}
    with ThreadPoolExecutor(max_workers=args.concurrency, thread_name_prefix="sensa-package") as pool:
        futures = {pool.submit(produce, sense_id): sense_id for sense_id in senses}
        for future in as_completed(futures):
            result = future.result()
            by_sense[result["senseId"]] = result
    results = [by_sense[sense_id] for sense_id in senses]
    counts = {
        outcome: sum(item["outcome"] == outcome for item in results)
        for outcome in ("succeeded", "blocked", "busy", "failed")
    }
    report = {
        "schemaVersion": "sensa-package-batch-v1",
        "requested": len(senses),
        "until": args.until,
        "limits": caps,
        "counts": counts,
        "results": results,
    }
    return report, counts["blocked"] == counts["busy"] == counts["failed"] == 0


def main() -> None:
    args = parser().parse_args()
    try:
        if args.command == "batch":
            report, succeeded = _batch(args)
            _json(report)
            if not succeeded:
                raise SystemExit(2)
            return
        pipeline = _pipeline(args)
        if args.command == "create":
            _json(pipeline.create(args.sense, force_new=args.new))
        elif args.command == "plan":
            _json(pipeline.plan(_resolve(pipeline, args)))
        elif args.command == "inspect":
            build = _resolve(pipeline, args)
            _json({**build, "plan": pipeline.plan(build)})
        elif args.command == "run":
            build = _resolve(pipeline, args)
            result = pipeline.run(
                build,
                until=args.until,
                allow_llm=args.allow_llm,
                allow_review=args.allow_review,
                allow_tts=args.allow_tts,
            )
            _json({**result, "plan": pipeline.plan(result)})
            if result.get("status") == "blocked":
                raise SystemExit(2)
        elif args.command == "repair":
            result = pipeline.repair(
                _resolve(pipeline, args),
                stage=args.stage,
                instruction=args.instruction,
                artifact_id=args.artifact_id,
                allow_llm=args.allow_llm,
            )
            _json({**result, "plan": pipeline.plan(result)})
            if result.get("status") == "blocked":
                raise SystemExit(2)
        elif args.command == "retry":
            result = pipeline.retry(
                _resolve(pipeline, args),
                stage=args.stage,
                allow_review=args.allow_review,
                allow_tts=args.allow_tts,
            )
            _json({**result, "plan": pipeline.plan(result)})
            if result.get("status") == "blocked":
                raise SystemExit(2)
        elif args.command == "rebuild-text":
            result = pipeline.rebuild_text(_resolve(pipeline, args))
            _json({**result, "plan": pipeline.plan(result)})
        elif args.command == "release":
            builds = [pipeline.resolve(build_id=value) for value in args.builds]
            report = pipeline.export(builds, Path(args.out))
            _json(report)
            if (report.get("summary") or {}).get("errors", 1):
                raise SystemExit(2)
    except (FileNotFoundError, FileExistsError, PermissionError, ValueError, RuntimeError) as exc:
        print(f"pipeline: {exc}", file=sys.stderr)
        raise SystemExit(2) from exc


if __name__ == "__main__":
    main()
