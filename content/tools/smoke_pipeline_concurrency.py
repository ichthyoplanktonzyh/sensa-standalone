#!/usr/bin/env python3
"""Deterministic no-cost smoke for package-production concurrency invariants."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import sys
import tempfile
import threading
import time
from argparse import Namespace
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import pipeline.media as pipeline_media  # noqa: E402
import pipeline.orchestrator as orchestrator_module  # noqa: E402
from pipeline.orchestrator import Pipeline  # noqa: E402
from pipeline.store import BuildLease, LeaseBusyError, LeaseLostError  # noqa: E402
from tools.pipeline import _batch  # noqa: E402
from tools.tts import TTSResult, sha256_text  # noqa: E402


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
    for word, label, definition in (
        ("borrow", "借用", "To receive something temporarily and return it."),
        ("lend", "借出", "To give something temporarily and receive it back."),
    ):
        sense_id = f"{word}-01"
        entry_id = f"dict-entry-{sense_id}"
        connection.execute(
            "INSERT INTO senses VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                sense_id, word, word, 1, "verb", label, definition,
                "action", "possession", "transitive", "neutral", "core",
                json.dumps([entry_id]),
            ),
        )
        connection.execute(
            "INSERT INTO dictionary_entries VALUES (?, ?, ?, ?, ?, ?)",
            (entry_id, word, 1, "verb", definition, json.dumps([])),
        )
        connection.execute("INSERT INTO lexemes VALUES (?)", (word,))
    connection.commit()
    connection.close()


def concurrent_create(pipeline: Pipeline, sense_id: str) -> dict:
    workers = 8
    barrier = threading.Barrier(workers)

    def create() -> dict:
        barrier.wait()
        return pipeline.create(sense_id)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        builds = list(pool.map(lambda _: create(), range(workers)))
    build_ids = {build["buildId"] for build in builds}
    assert len(build_ids) == 1, build_ids
    with sqlite3.connect(pipeline.store.db_path) as connection:
        build_count = connection.execute(
            "SELECT count(*) FROM package_builds WHERE sense_id = ?",
            (sense_id,),
        ).fetchone()[0]
        fact_attempts = connection.execute(
            "SELECT count(*) FROM package_build_attempts WHERE sense_id = ? AND stage = 'facts'",
            (sense_id,),
        ).fetchone()[0]
    assert (build_count, fact_attempts) == (1, 1)
    return builds[0]


def lease_smoke(pipeline: Pipeline, borrow: dict, lend: dict) -> None:
    store = pipeline.store
    with store.lease(
        sense_id=borrow["senseId"], build_id=borrow["buildId"],
        operation="smoke-holder", lease_seconds=30, heartbeat_seconds=10,
    ):
        try:
            with store.lease(
                sense_id=borrow["senseId"], build_id=borrow["buildId"],
                operation="smoke-contender", lease_seconds=30, heartbeat_seconds=10,
            ):
                raise AssertionError("same-Sense lease contention unexpectedly succeeded")
        except LeaseBusyError:
            pass
        # A different Sense can be owned at the same time.
        with store.lease(
            sense_id=lend["senseId"], build_id=lend["buildId"],
            operation="smoke-independent", lease_seconds=30, heartbeat_seconds=10,
        ):
            assert store.lease_info(lend["senseId"]) is not None

        try:
            pipeline.run(
                borrow,
                until="profile_ready",
                allow_llm=False,
                allow_review=False,
                allow_tts=False,
            )
            raise AssertionError("run should reject contention before starting a stage")
        except LeaseBusyError:
            pass

    # Expired owners are recoverable without a cleanup process.
    assert store.acquire_lease(
        sense_id=borrow["senseId"], build_id=borrow["buildId"],
        owner_id="expired-owner", operation="smoke-expired", lease_seconds=30,
    )
    with sqlite3.connect(store.db_path) as connection:
        connection.execute(
            "UPDATE package_build_leases SET lease_until = 0 WHERE sense_id = ?",
            (borrow["senseId"],),
        )
        connection.commit()
    assert store.acquire_lease(
        sense_id=borrow["senseId"], build_id=borrow["buildId"],
        owner_id="recovery-owner", operation="smoke-recovery", lease_seconds=30,
    )
    with sqlite3.connect(store.db_path) as connection:
        connection.execute("DELETE FROM package_build_leases WHERE sense_id = ?", (borrow["senseId"],))
        connection.commit()

    # A producer that lost ownership cannot commit even with a fresh revision.
    lost = BuildLease(
        store,
        sense_id=borrow["senseId"],
        build_id=borrow["buildId"],
        operation="smoke-lost",
        lease_seconds=30,
        heartbeat_seconds=30,
    ).start()
    with sqlite3.connect(store.db_path) as connection:
        connection.execute(
            "UPDATE package_build_leases SET lease_until = 0 WHERE sense_id = ?",
            (borrow["senseId"],),
        )
        connection.commit()
    assert store.acquire_lease(
        sense_id=borrow["senseId"], build_id=borrow["buildId"],
        owner_id="replacement-owner", operation="smoke-replacement", lease_seconds=30,
    )
    try:
        store.save(store.load(borrow["buildId"]), lease=lost)
        raise AssertionError("lost lease unexpectedly committed a Build")
    except LeaseLostError:
        pass
    finally:
        lost.close()
        with sqlite3.connect(store.db_path) as connection:
            connection.execute("DELETE FROM package_build_leases WHERE sense_id = ?", (borrow["senseId"],))
            connection.commit()

    first = store.load(borrow["buildId"])
    stale = store.load(borrow["buildId"])
    store.save(first)
    try:
        store.save(stale)
        raise AssertionError("stale revision unexpectedly overwrote a Build")
    except RuntimeError as exc:
        assert "Concurrent Build update rejected" in str(exc)


def media_single_flight(root: Path, db_path: Path) -> None:
    original_synthesize = pipeline_media.synthesize
    original_inspect = pipeline_media.inspect_mp3
    original_lease_seconds = pipeline_media.MEDIA_LEASE_SECONDS
    original_wait_seconds = pipeline_media.MEDIA_WAIT_SECONDS
    calls = 0
    calls_lock = threading.Lock()
    workers = 6
    barrier = threading.Barrier(workers)

    def inspect(path: Path) -> tuple[str, int, int]:
        data = path.read_bytes()
        return hashlib.sha256(data).hexdigest(), len(data), 125

    def synthesize(*, text: str, out_path: Path, voice: str, rate: str, allow_external: bool) -> TTSResult:
        nonlocal calls
        assert allow_external
        with calls_lock:
            calls += 1
        time.sleep(0.1)
        data = f"fake-mp3:{text}:{voice}:{rate}".encode()
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(data)
        return TTSResult(
            media_path=out_path,
            media_sha256=hashlib.sha256(data).hexdigest(),
            source_text_digest=sha256_text(text),
            duration_ms=125,
            size_bytes=len(data),
            voice=voice,
            rate=rate,
        )

    pipeline_media.synthesize = synthesize
    pipeline_media.inspect_mp3 = inspect
    pipeline_media.MEDIA_LEASE_SECONDS = 2.0
    pipeline_media.MEDIA_WAIT_SECONDS = 5.0
    try:
        def produce() -> tuple[dict, bool]:
            barrier.wait()
            return pipeline_media._produce(
                text="Can I borrow your pen?",
                kind="study_example_audio",
                voice="smoke-voice",
                rate="+0%",
                media_root=root / "media",
                cache_db_path=db_path,
                allow_external=True,
            )

        with ThreadPoolExecutor(max_workers=workers) as pool:
            results = list(pool.map(lambda _: produce(), range(workers)))
        assert calls == 1, calls
        assert sum(cache_hit for _, cache_hit in results) == workers - 1
        assert len({item[0]["mediaSha256"] for item in results}) == 1
        assert not list((root / "media" / "audio").glob(".tmp-*.mp3"))
        with sqlite3.connect(db_path) as connection:
            assert connection.execute("SELECT count(*) FROM package_media_cache").fetchone()[0] == 1
            assert connection.execute("SELECT count(*) FROM package_media_leases").fetchone()[0] == 0
    finally:
        pipeline_media.synthesize = original_synthesize
        pipeline_media.inspect_mp3 = original_inspect
        pipeline_media.MEDIA_LEASE_SECONDS = original_lease_seconds
        pipeline_media.MEDIA_WAIT_SECONDS = original_wait_seconds


def atomic_export(pipeline: Pipeline, root: Path) -> None:
    original_run = orchestrator_module.subprocess.run
    barrier = threading.Barrier(2)
    target = root / "release"

    def successful_validator(*args, **kwargs):
        barrier.wait()
        return SimpleNamespace(
            stdout=json.dumps({"summary": {"errors": 0, "warnings": 0}}),
            stderr="",
            returncode=0,
        )

    orchestrator_module.subprocess.run = successful_validator
    try:
        def export():
            try:
                return pipeline.export([], target)
            except Exception as exc:
                return exc

        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(lambda _: export(), range(2)))
        assert sum(isinstance(item, dict) for item in outcomes) == 1, outcomes
        assert sum(isinstance(item, FileExistsError) for item in outcomes) == 1, outcomes
        assert target.is_dir() and (target / "expected-senses.json").is_file()
        assert not list(root.glob(".release.staging-*"))
        try:
            pipeline.export([], target)
            raise AssertionError("existing release root was overwritten")
        except FileExistsError:
            pass
    finally:
        orchestrator_module.subprocess.run = original_run


def batch_scheduler(root: Path, db_path: Path) -> None:
    report, succeeded = _batch(Namespace(
        senses=["borrow-01", "lend-01", "borrow-01"],
        sense_file=None,
        concurrency=2,
        llm_concurrency=1,
        review_concurrency=1,
        tts_concurrency=1,
        until="facts_ready",
        allow_llm=False,
        allow_review=False,
        allow_tts=False,
        db=str(db_path),
        store_db=str(db_path),
        media_dir=str(root / "media"),
    ))
    assert succeeded, report
    assert report["requested"] == 2
    assert [item["senseId"] for item in report["results"]] == ["borrow-01", "lend-01"]
    assert report["counts"] == {"succeeded": 2, "blocked": 0, "busy": 0, "failed": 0}


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="sensa-concurrency-smoke-") as temporary:
        root = Path(temporary)
        db_path = root / "senses.db"
        make_db(db_path)
        pipeline = Pipeline(db_path=db_path, store_db_path=db_path, media_root=root / "media")
        borrow = concurrent_create(pipeline, "borrow-01")
        lend = pipeline.create("lend-01")
        lease_smoke(pipeline, borrow, lend)
        batch_scheduler(root, db_path)
        media_single_flight(root, db_path)
        atomic_export(pipeline, root)
    print("concurrent package pipeline smoke passed")


if __name__ == "__main__":
    main()
