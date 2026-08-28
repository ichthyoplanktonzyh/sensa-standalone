"""Content-addressed TTS with SQLite metadata and binary MP3 objects."""

from __future__ import annotations

import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from tools.tts import inspect_mp3, sha256_text, synthesize

from .model import sha256_json, utc_now

PROVIDER = "microsoft-edge-tts"
MODEL = "neural-v1"
MEDIA_LEASE_SECONDS = 300.0
MEDIA_WAIT_SECONDS = 600.0


def _connect(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(str(path), timeout=30.0)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA synchronous = NORMAL")
    connection.execute(
        """
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
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS package_media_leases (
            cache_key       TEXT PRIMARY KEY,
            owner_id        TEXT NOT NULL,
            lease_until     REAL NOT NULL,
            heartbeat_at    TEXT NOT NULL
        )
        """
    )
    return connection


def _cache_key(*, kind: str, text: str, voice: str, rate: str) -> str:
    return sha256_json({"provider": PROVIDER, "model": MODEL, "kind": kind, "text": text, "voice": voice, "rate": rate})


def _metadata(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "mediaSha256": row["media_sha256"],
        "sourceTextDigest": row["source_text_digest"],
        "mimeType": row["mime_type"],
        "sizeBytes": row["size_bytes"],
        "durationMs": row["duration_ms"],
        "provider": row["provider"],
        "model": row["model"],
        "voice": row["voice"],
        "accentLocale": row["accent_locale"],
        "rate": row["rate"],
    }


def _cached(db_path: Path, audio_dir: Path, key: str, text: str) -> dict[str, Any] | None:
    with _connect(db_path) as connection:
        row = connection.execute(
            "SELECT * FROM package_media_cache WHERE cache_key = ?",
            (key,),
        ).fetchone()
    if row is None:
        return None
    document = _metadata(row)
    media_path = audio_dir / f"{document['mediaSha256']}.mp3"
    try:
        digest, size, duration = inspect_mp3(media_path)
    except (OSError, ValueError):
        return None
    if document["sourceTextDigest"] != sha256_text(text):
        return None
    if (digest, size, duration) != (
        document["mediaSha256"],
        document["sizeBytes"],
        document["durationMs"],
    ):
        return None
    return document


def _claim(db_path: Path, key: str, owner_id: str, *, lease_seconds: float) -> bool:
    now = time.time()
    connection = _connect(db_path)
    try:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            "SELECT owner_id, lease_until FROM package_media_leases WHERE cache_key = ?",
            (key,),
        ).fetchone()
        if row is not None and float(row["lease_until"]) > now and row["owner_id"] != owner_id:
            connection.rollback()
            return False
        connection.execute(
            """
            INSERT INTO package_media_leases (cache_key, owner_id, lease_until, heartbeat_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(cache_key) DO UPDATE SET
                owner_id = excluded.owner_id,
                lease_until = excluded.lease_until,
                heartbeat_at = excluded.heartbeat_at
            """,
            (key, owner_id, now + lease_seconds, utc_now()),
        )
        connection.commit()
        return True
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _renew(db_path: Path, key: str, owner_id: str, *, lease_seconds: float) -> bool:
    now = time.time()
    with _connect(db_path) as connection:
        result = connection.execute(
            """
            UPDATE package_media_leases
            SET lease_until = ?, heartbeat_at = ?
            WHERE cache_key = ? AND owner_id = ? AND lease_until > ?
            """,
            (now + lease_seconds, utc_now(), key, owner_id, now),
        )
    return result.rowcount == 1


def _release(db_path: Path, key: str, owner_id: str) -> None:
    with _connect(db_path) as connection:
        connection.execute(
            "DELETE FROM package_media_leases WHERE cache_key = ? AND owner_id = ?",
            (key, owner_id),
        )


def _store(db_path: Path, key: str, document: dict[str, Any], *, owner_id: str) -> None:
    connection = _connect(db_path)
    try:
        connection.execute("BEGIN IMMEDIATE")
        owned = connection.execute(
            """
            SELECT 1 FROM package_media_leases
            WHERE cache_key = ? AND owner_id = ? AND lease_until > ?
            """,
            (key, owner_id, time.time()),
        ).fetchone()
        if owned is None:
            raise RuntimeError(f"Lost media single-flight claim for {key}")
        connection.execute(
                """
                INSERT INTO package_media_cache (
                    cache_key, media_sha256, source_text_digest, mime_type,
                    size_bytes, duration_ms, provider, model, voice,
                    accent_locale, rate, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(cache_key) DO UPDATE SET
                    media_sha256 = excluded.media_sha256,
                    source_text_digest = excluded.source_text_digest,
                    mime_type = excluded.mime_type,
                    size_bytes = excluded.size_bytes,
                    duration_ms = excluded.duration_ms,
                    provider = excluded.provider,
                    model = excluded.model,
                    voice = excluded.voice,
                    accent_locale = excluded.accent_locale,
                    rate = excluded.rate
                """,
                (
                    key, document["mediaSha256"], document["sourceTextDigest"],
                    document["mimeType"], document["sizeBytes"], document["durationMs"],
                    document["provider"], document["model"], document["voice"],
                    document["accentLocale"], document["rate"], utc_now(),
                ),
            )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _produce(
    *,
    text: str,
    kind: str,
    voice: str,
    rate: str,
    media_root: Path,
    cache_db_path: Path,
    allow_external: bool,
) -> tuple[dict[str, Any], bool]:
    audio_dir = media_root / "audio"
    key = _cache_key(kind=kind, text=text, voice=voice, rate=rate)
    owner_id = f"media-{uuid.uuid4().hex}"
    deadline = time.monotonic() + MEDIA_WAIT_SECONDS
    while True:
        cached = _cached(cache_db_path, audio_dir, key, text)
        if cached is not None:
            return cached, True
        if _claim(
            cache_db_path,
            key,
            owner_id,
            lease_seconds=MEDIA_LEASE_SECONDS,
        ):
            break
        if time.monotonic() >= deadline:
            raise TimeoutError(f"Timed out waiting for media cache key {key}")
        time.sleep(0.05)

    stop = threading.Event()
    lost = threading.Event()

    def heartbeat() -> None:
        while not stop.wait(MEDIA_LEASE_SECONDS / 3):
            if not _renew(
                cache_db_path,
                key,
                owner_id,
                lease_seconds=MEDIA_LEASE_SECONDS,
            ):
                lost.set()
                return

    heartbeat_thread = threading.Thread(
        target=heartbeat,
        name=f"sensa-media-{key[:12]}",
        daemon=True,
    )
    heartbeat_thread.start()
    temporary = audio_dir / f".tmp-{key}-{owner_id}.mp3"
    try:
        # The cache may have completed just before this contender acquired an
        # expired/released claim. Recheck before making an external call.
        cached = _cached(cache_db_path, audio_dir, key, text)
        if cached is not None:
            return cached, True
        result = synthesize(
            text=text,
            out_path=temporary,
            voice=voice,
            rate=rate,
            allow_external=allow_external,
        )
        if lost.is_set():
            raise RuntimeError(f"Lost media single-flight claim for {key}")
        final = audio_dir / f"{result.media_sha256}.mp3"
        final.parent.mkdir(parents=True, exist_ok=True)
        if final.exists():
            temporary.unlink(missing_ok=True)
        else:
            temporary.replace(final)
        document = {
            "mediaSha256": result.media_sha256,
            "sourceTextDigest": result.source_text_digest,
            "mimeType": result.mime_type,
            "sizeBytes": result.size_bytes,
            "durationMs": result.duration_ms,
            "provider": result.provider,
            "model": result.model,
            "voice": result.voice,
            "accentLocale": result.accent_locale,
            "rate": result.rate,
        }
        _store(cache_db_path, key, document, owner_id=owner_id)
        return document, False
    finally:
        stop.set()
        heartbeat_thread.join(timeout=1.0)
        temporary.unlink(missing_ok=True)
        _release(cache_db_path, key, owner_id)


def produce_package_media(
    candidate: dict[str, Any],
    *,
    media_root: Path,
    cache_db_path: Path,
    allow_external: bool,
    pronunciation_voice: str = "en-US-AriaNeural",
    pronunciation_rate: str = "-4%",
    example_voice: str = "en-US-JennyNeural",
    example_rate: str = "+0%",
) -> dict[str, Any]:
    release_id = candidate["release"]["contentReleaseId"]
    locale = candidate["release"]["learnerLocale"]
    sense_version_id = candidate["senseVersion"]["senseVersionId"]
    lemma = candidate["lexemeVersion"]["lemma"]
    pronunciation_meta, pron_hit = _produce(
        text=lemma,
        kind="pronunciation_audio",
        voice=pronunciation_voice,
        rate=pronunciation_rate,
        media_root=media_root,
        cache_db_path=cache_db_path,
        allow_external=allow_external,
    )
    pronunciation = {
        "learningAssetId": f"ast-audio-pron-{lemma}",
        "contentReleaseId": release_id,
        "kind": "pronunciation_audio",
        "lexemeVersionId": candidate["lexemeVersion"]["lexemeVersionId"],
        "mediaBlobId": f"blob-{pronunciation_meta['mediaSha256']}",
        "contentDigest": pronunciation_meta["mediaSha256"],
        "sourceEvidenceRefs": ["tts-generated"],
        "reviewStatus": "approved",
        **pronunciation_meta,
    }
    assets = [pronunciation]
    hits = 1 if pron_hit else 0
    generated = 0 if pron_hit else 1
    study_examples = [
        asset
        for asset in candidate.get("assets", [])
        if asset.get("kind") == "example" and asset.get("role") == "study"
    ]
    for index, example in enumerate(study_examples, 1):
        metadata, hit = _produce(
            text=example["textL2"],
            kind="study_example_audio",
            voice=example_voice,
            rate=example_rate,
            media_root=media_root,
            cache_db_path=cache_db_path,
            allow_external=allow_external,
        )
        hits += 1 if hit else 0
        generated += 0 if hit else 1
        assets.append({
            "learningAssetId": f"ast-audio-{candidate['senseVersion']['senseId']}-study-{index:02d}",
            "contentReleaseId": release_id,
            "kind": "study_example_audio",
            "senseVersionId": sense_version_id,
            "sourceExampleAssetId": example["learningAssetId"],
            "learnerLocale": locale,
            "mediaBlobId": f"blob-{metadata['mediaSha256']}",
            "contentDigest": metadata["mediaSha256"],
            "sourceEvidenceRefs": ["tts-generated"],
            "reviewStatus": "approved",
            **metadata,
        })
    return {"assets": assets, "cacheHits": hits, "generated": generated}
