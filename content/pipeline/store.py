"""SQLite repository for Builds, immutable attempts and append-only events."""

from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from .model import (
    ATTEMPT_SCHEMA_VERSION,
    STAGE_ORDER,
    new_attempt_id,
    sha256_json,
    utc_now,
    validate_build,
)


class LeaseBusyError(RuntimeError):
    """Raised before work starts when another producer owns the Sense."""


class LeaseLostError(RuntimeError):
    """Raised when a producer can no longer commit under its original lease."""


class BuildLease:
    """Renewable single-host lease for one Sense and its selected Build."""

    def __init__(
        self,
        store: "BuildStore",
        *,
        sense_id: str,
        build_id: str,
        operation: str,
        lease_seconds: float,
        heartbeat_seconds: float,
    ):
        self.store = store
        self.sense_id = sense_id
        self.build_id = build_id
        self.operation = operation
        self.owner_id = f"producer-{uuid.uuid4().hex}"
        self.lease_seconds = lease_seconds
        self.heartbeat_seconds = heartbeat_seconds
        self._stop = threading.Event()
        self._lost = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> "BuildLease":
        if not self.store.acquire_lease(
            sense_id=self.sense_id,
            build_id=self.build_id,
            owner_id=self.owner_id,
            operation=self.operation,
            lease_seconds=self.lease_seconds,
        ):
            current = self.store.lease_info(self.sense_id)
            owner = current.get("ownerId") if current else "unknown"
            until = current.get("leaseUntil") if current else "unknown"
            raise LeaseBusyError(
                f"Sense {self.sense_id} is busy under producer {owner} until {until}"
            )
        self._thread = threading.Thread(
            target=self._heartbeat,
            name=f"sensa-lease-{self.sense_id}",
            daemon=True,
        )
        self._thread.start()
        return self

    def _heartbeat(self) -> None:
        while not self._stop.wait(self.heartbeat_seconds):
            if not self.store.renew_lease(self, lease_seconds=self.lease_seconds):
                self._lost.set()
                return

    def assert_owned(self) -> None:
        if self._lost.is_set() or not self.store.owns_lease(self):
            self._lost.set()
            raise LeaseLostError(
                f"Producer {self.owner_id} lost the lease for Sense {self.sense_id}"
            )

    def close(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=max(1.0, self.heartbeat_seconds * 2))
        self.store.release_lease(self)


class BuildStore:
    """Persist Pipeline state in SQLite rather than loose JSON/YAML files."""

    def __init__(self, db_path: Path):
        self.db_path = db_path
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(str(self.db_path), timeout=30.0)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute("PRAGMA synchronous = NORMAL")
        return connection

    def _init_schema(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS package_builds (
                    build_id       TEXT PRIMARY KEY,
                    sense_id       TEXT NOT NULL,
                    input_digest   TEXT NOT NULL,
                    status         TEXT NOT NULL,
                    revision       INTEGER NOT NULL,
                    is_current     INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
                    document_json  TEXT NOT NULL,
                    created_at     TEXT NOT NULL,
                    updated_at     TEXT NOT NULL
                );
                CREATE UNIQUE INDEX IF NOT EXISTS idx_package_build_current
                    ON package_builds(sense_id) WHERE is_current = 1;
                CREATE INDEX IF NOT EXISTS idx_package_build_sense
                    ON package_builds(sense_id, created_at DESC);

                CREATE TABLE IF NOT EXISTS package_build_attempts (
                    attempt_id      TEXT PRIMARY KEY,
                    build_id        TEXT NOT NULL REFERENCES package_builds(build_id) ON DELETE CASCADE,
                    sense_id        TEXT NOT NULL,
                    stage           TEXT NOT NULL,
                    status          TEXT NOT NULL,
                    input_digest    TEXT NOT NULL,
                    output_digest   TEXT NOT NULL,
                    document_json   TEXT NOT NULL,
                    created_at      TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_package_attempt_build_stage
                    ON package_build_attempts(build_id, stage, created_at DESC);

                CREATE TABLE IF NOT EXISTS package_build_events (
                    event_id        INTEGER PRIMARY KEY AUTOINCREMENT,
                    build_id        TEXT NOT NULL REFERENCES package_builds(build_id) ON DELETE CASCADE,
                    event           TEXT NOT NULL,
                    detail_json     TEXT NOT NULL,
                    created_at      TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_package_event_build
                    ON package_build_events(build_id, event_id);

                CREATE TABLE IF NOT EXISTS package_build_leases (
                    sense_id          TEXT PRIMARY KEY,
                    build_id          TEXT NOT NULL,
                    owner_id          TEXT NOT NULL,
                    operation         TEXT NOT NULL,
                    lease_until       REAL NOT NULL,
                    acquired_at       TEXT NOT NULL,
                    heartbeat_at      TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_package_build_lease_build
                    ON package_build_leases(build_id);

                CREATE TABLE IF NOT EXISTS package_media_cache (
                    cache_key          TEXT PRIMARY KEY,
                    media_sha256       TEXT NOT NULL,
                    source_text_digest TEXT NOT NULL,
                    mime_type          TEXT NOT NULL,
                    size_bytes         INTEGER NOT NULL,
                    duration_ms        INTEGER NOT NULL,
                    provider           TEXT NOT NULL,
                    model              TEXT NOT NULL,
                    voice              TEXT NOT NULL,
                    accent_locale      TEXT NOT NULL,
                    rate               TEXT NOT NULL,
                    created_at         TEXT NOT NULL
                );
                """
            )

    @staticmethod
    def _decode(raw: str) -> dict[str, Any]:
        document = json.loads(raw)
        if not isinstance(document, dict):
            raise ValueError("Stored Pipeline document must be an object")
        return document

    def acquire_lease(
        self,
        *,
        sense_id: str,
        build_id: str,
        owner_id: str,
        operation: str,
        lease_seconds: float,
    ) -> bool:
        if lease_seconds <= 0:
            raise ValueError("lease_seconds must be positive")
        now = time.time()
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT owner_id, lease_until FROM package_build_leases WHERE sense_id = ?",
                (sense_id,),
            ).fetchone()
            if row is not None and float(row["lease_until"]) > now and row["owner_id"] != owner_id:
                connection.rollback()
                return False
            connection.execute(
                """
                INSERT INTO package_build_leases (
                    sense_id, build_id, owner_id, operation, lease_until,
                    acquired_at, heartbeat_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(sense_id) DO UPDATE SET
                    build_id = excluded.build_id,
                    owner_id = excluded.owner_id,
                    operation = excluded.operation,
                    lease_until = excluded.lease_until,
                    acquired_at = excluded.acquired_at,
                    heartbeat_at = excluded.heartbeat_at
                """,
                (
                    sense_id, build_id, owner_id, operation, now + lease_seconds,
                    utc_now(), utc_now(),
                ),
            )
            connection.commit()
            return True
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def renew_lease(self, lease: BuildLease, *, lease_seconds: float) -> bool:
        now = time.time()
        with self._connect() as connection:
            result = connection.execute(
                """
                UPDATE package_build_leases
                SET lease_until = ?, heartbeat_at = ?
                WHERE sense_id = ? AND build_id = ? AND owner_id = ?
                  AND lease_until > ?
                """,
                (
                    now + lease_seconds, utc_now(), lease.sense_id,
                    lease.build_id, lease.owner_id, now,
                ),
            )
        return result.rowcount == 1

    def owns_lease(self, lease: BuildLease) -> bool:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT 1 FROM package_build_leases
                WHERE sense_id = ? AND build_id = ? AND owner_id = ?
                  AND lease_until > ?
                """,
                (lease.sense_id, lease.build_id, lease.owner_id, time.time()),
            ).fetchone()
        return row is not None

    def release_lease(self, lease: BuildLease) -> None:
        with self._connect() as connection:
            connection.execute(
                "DELETE FROM package_build_leases WHERE sense_id = ? AND build_id = ? AND owner_id = ?",
                (lease.sense_id, lease.build_id, lease.owner_id),
            )

    def lease_info(self, sense_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM package_build_leases WHERE sense_id = ? AND lease_until > ?",
                (sense_id, time.time()),
            ).fetchone()
        if row is None:
            return None
        return {
            "senseId": row["sense_id"],
            "buildId": row["build_id"],
            "ownerId": row["owner_id"],
            "operation": row["operation"],
            "leaseUntil": float(row["lease_until"]),
        }

    @contextmanager
    def lease(
        self,
        *,
        sense_id: str,
        build_id: str,
        operation: str,
        lease_seconds: float = 300.0,
        heartbeat_seconds: float | None = None,
    ) -> Iterator[BuildLease]:
        heartbeat = heartbeat_seconds or min(30.0, max(0.1, lease_seconds / 3))
        handle = BuildLease(
            self,
            sense_id=sense_id,
            build_id=build_id,
            operation=operation,
            lease_seconds=lease_seconds,
            heartbeat_seconds=heartbeat,
        ).start()
        try:
            yield handle
        finally:
            handle.close()

    @staticmethod
    def _require_lease(connection: sqlite3.Connection, lease: BuildLease) -> None:
        row = connection.execute(
            """
            SELECT 1 FROM package_build_leases
            WHERE sense_id = ? AND build_id = ? AND owner_id = ?
              AND lease_until > ?
            """,
            (lease.sense_id, lease.build_id, lease.owner_id, time.time()),
        ).fetchone()
        if row is None:
            raise LeaseLostError(
                f"Producer {lease.owner_id} no longer owns Sense {lease.sense_id}"
            )

    @staticmethod
    def prepare_attempt(
        build: dict[str, Any],
        *,
        stage: str,
        input_value: Any,
        payload: Any,
        issues: list[dict[str, Any]] | None = None,
        provenance: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if stage not in STAGE_ORDER:
            raise ValueError(f"Unknown build stage: {stage}")
        return {
            "schemaVersion": ATTEMPT_SCHEMA_VERSION,
            "attemptId": new_attempt_id(stage),
            "buildId": build["buildId"],
            "senseId": build["senseId"],
            "stage": stage,
            "status": "succeeded" if not issues else "failed",
            "inputDigest": sha256_json(input_value),
            "outputDigest": sha256_json(payload),
            "createdAt": utc_now(),
            "payload": payload,
            "issues": issues or [],
            "provenance": provenance or {"method": "deterministic"},
        }

    @staticmethod
    def _insert_attempt(connection: sqlite3.Connection, attempt: dict[str, Any]) -> None:
        connection.execute(
            """
            INSERT INTO package_build_attempts (
                attempt_id, build_id, sense_id, stage, status,
                input_digest, output_digest, document_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                attempt["attemptId"], attempt["buildId"], attempt["senseId"],
                attempt["stage"], attempt["status"], attempt["inputDigest"],
                attempt["outputDigest"],
                json.dumps(attempt, ensure_ascii=False, sort_keys=True),
                attempt["createdAt"],
            ),
        )

    def create(
        self,
        build: dict[str, Any],
        *,
        force_new: bool = False,
        initial_attempt: dict[str, Any] | None = None,
    ) -> tuple[dict[str, Any], bool]:
        errors = validate_build(build)
        if errors:
            raise ValueError("; ".join(errors))
        if initial_attempt is not None and (
            initial_attempt.get("buildId") != build.get("buildId")
            or initial_attempt.get("senseId") != build.get("senseId")
        ):
            raise ValueError("Initial attempt identity does not match Build")
        encoded = json.dumps(build, ensure_ascii=False, sort_keys=True)
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            current = connection.execute(
                """
                SELECT document_json, input_digest FROM package_builds
                WHERE sense_id = ? AND is_current = 1
                """,
                (build["senseId"],),
            ).fetchone()
            if (
                not force_new
                and current is not None
                and current["input_digest"] == build["inputDigest"]
            ):
                existing = self._decode(str(current["document_json"]))
                connection.rollback()
                return existing, False
            connection.execute(
                "UPDATE package_builds SET is_current = 0 WHERE sense_id = ?",
                (build["senseId"],),
            )
            connection.execute(
                """
                INSERT INTO package_builds (
                    build_id, sense_id, input_digest, status, revision,
                    is_current, document_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
                """,
                (
                    build["buildId"], build["senseId"], build["inputDigest"],
                    build["status"], build["revision"], encoded,
                    build["createdAt"], build["updatedAt"],
                ),
            )
            self._append_event(
                connection,
                build["buildId"],
                "build.created",
                {"inputDigest": build["inputDigest"]},
            )
            if initial_attempt is not None:
                self._insert_attempt(connection, initial_attempt)
                self._append_event(
                    connection,
                    build["buildId"],
                    "attempt.recorded",
                    {
                        "stage": initial_attempt["stage"],
                        "attemptId": initial_attempt["attemptId"],
                        "status": initial_attempt["status"],
                    },
                )
            connection.commit()
            return build, True
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def load(self, build_id: str, *, sense_id: str | None = None) -> dict[str, Any]:
        with self._connect() as connection:
            if sense_id is None:
                row = connection.execute(
                    "SELECT document_json FROM package_builds WHERE build_id = ?",
                    (build_id,),
                ).fetchone()
            else:
                row = connection.execute(
                    "SELECT document_json FROM package_builds WHERE build_id = ? AND sense_id = ?",
                    (build_id, sense_id),
                ).fetchone()
        if row is None:
            raise FileNotFoundError(f"Cannot resolve Build {build_id!r}")
        build = self._decode(str(row["document_json"]))
        errors = validate_build(build)
        if errors:
            raise ValueError(f"Invalid stored Build {build_id}: {'; '.join(errors)}")
        return build

    def current(self, sense_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT document_json FROM package_builds WHERE sense_id = ? AND is_current = 1",
                (sense_id,),
            ).fetchone()
        return self._decode(str(row["document_json"])) if row is not None else None

    def save(self, build: dict[str, Any], *, lease: BuildLease | None = None) -> None:
        next_build = dict(build)
        expected_revision = int(next_build.get("revision", 0))
        next_build["revision"] = expected_revision + 1
        next_build["updatedAt"] = utc_now()
        errors = validate_build(next_build)
        if errors:
            raise ValueError("; ".join(errors))
        encoded = json.dumps(next_build, ensure_ascii=False, sort_keys=True)
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            if lease is not None:
                self._require_lease(connection, lease)
            result = connection.execute(
                """
                UPDATE package_builds
                SET input_digest = ?, status = ?, revision = ?, document_json = ?, updated_at = ?
                WHERE build_id = ? AND revision = ?
                """,
                (
                    next_build["inputDigest"], next_build["status"],
                    next_build["revision"], encoded, next_build["updatedAt"],
                    next_build["buildId"], expected_revision,
                ),
            )
            if result.rowcount != 1:
                raise RuntimeError(
                    f"Concurrent Build update rejected: {next_build['buildId']} revision {expected_revision}"
                )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    @staticmethod
    def _append_event(
        connection: sqlite3.Connection,
        build_id: str,
        event: str,
        detail: dict[str, Any],
    ) -> None:
        connection.execute(
            "INSERT INTO package_build_events (build_id, event, detail_json, created_at) VALUES (?, ?, ?, ?)",
            (build_id, event, json.dumps(detail, ensure_ascii=False, sort_keys=True), utc_now()),
        )

    def append_event(self, build: dict[str, Any], event: str, detail: dict[str, Any]) -> None:
        with self._connect() as connection:
            with connection:
                self._append_event(connection, build["buildId"], event, detail)

    def record_attempt(
        self,
        build: dict[str, Any],
        *,
        stage: str,
        input_value: Any,
        payload: Any,
        issues: list[dict[str, Any]] | None = None,
        provenance: dict[str, Any] | None = None,
        select: bool = True,
        lease: BuildLease | None = None,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        attempt = self.prepare_attempt(
            build,
            stage=stage,
            input_value=input_value,
            payload=payload,
            issues=issues,
            provenance=provenance,
        )
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            if lease is not None:
                self._require_lease(connection, lease)
            self._insert_attempt(connection, attempt)
            self._append_event(
                connection,
                build["buildId"],
                "attempt.recorded",
                {
                    "stage": stage,
                    "attemptId": attempt["attemptId"],
                    "status": attempt["status"],
                },
            )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()
        if select and not issues:
            build = self.select_attempt(build, stage=stage, attempt_id=attempt["attemptId"])
        return build, attempt

    def select_attempt(self, build: dict[str, Any], *, stage: str, attempt_id: str) -> dict[str, Any]:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT status FROM package_build_attempts WHERE attempt_id = ? AND build_id = ? AND stage = ?",
                (attempt_id, build["buildId"], stage),
            ).fetchone()
        if row is None or row["status"] != "succeeded":
            raise ValueError(f"Cannot select missing or failed attempt: {attempt_id}")
        selected = dict(build.get("selectedAttempts") or {})
        selected[stage] = attempt_id
        stage_index = STAGE_ORDER.index(stage)
        for downstream in STAGE_ORDER[stage_index + 1 :]:
            selected.pop(downstream, None)
        build["selectedAttempts"] = selected
        build["issues"] = [
            item
            for item in build.get("issues", [])
            if item.get("stage") not in STAGE_ORDER[stage_index:]
        ]
        return build

    def selected_attempt(self, build: dict[str, Any], stage: str) -> dict[str, Any] | None:
        attempt_id = (build.get("selectedAttempts") or {}).get(stage)
        if not isinstance(attempt_id, str):
            return None
        with self._connect() as connection:
            row = connection.execute(
                "SELECT document_json FROM package_build_attempts WHERE attempt_id = ? AND build_id = ?",
                (attempt_id, build["buildId"]),
            ).fetchone()
        if row is None:
            raise ValueError(f"Selected attempt is missing: {attempt_id}")
        return self._decode(str(row["document_json"]))

    def selected_payload(self, build: dict[str, Any], stage: str) -> Any:
        attempt = self.selected_attempt(build, stage)
        return attempt.get("payload") if attempt else None

    def invalidate_from(self, build: dict[str, Any], stage: str, *, reason: str) -> dict[str, Any]:
        if stage not in STAGE_ORDER:
            raise ValueError(f"Unknown build stage: {stage}")
        selected = dict(build.get("selectedAttempts") or {})
        stage_index = STAGE_ORDER.index(stage)
        for name in STAGE_ORDER[stage_index:]:
            selected.pop(name, None)
        build["selectedAttempts"] = selected
        self.append_event(build, "build.invalidated", {"fromStage": stage, "reason": reason})
        return build
