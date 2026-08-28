#!/usr/bin/env python3
"""Sensa V1 Unified TTS Module.

提供基于 Edge TTS 的本地极速语音合成、时长提取与 SHA-256 哈希绑定。
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import edge_tts
import mutagen.mp3

DEFAULT_VOICE = "en-US-JennyNeural"
DEFAULT_RATE = "+0%"
DEFAULT_LOCALE = "en-US"


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class TTSResult:
    media_path: Path
    media_sha256: str
    source_text_digest: str
    duration_ms: int
    size_bytes: int
    mime_type: str = "audio/mp3"
    provider: str = "microsoft-edge-tts"
    model: str = "neural-v1"
    voice: str = DEFAULT_VOICE
    accent_locale: str = DEFAULT_LOCALE
    rate: str = DEFAULT_RATE

    def to_asset_dict(
        self,
        asset_id: str,
        content_release_id: str,
        kind: str,
        sense_version_id: str | None = None,
        lexeme_version_id: str | None = None,
        source_example_asset_id: str | None = None,
        review_status: str = "draft",
    ) -> dict[str, Any]:
        doc: dict[str, Any] = {
            "learningAssetId": asset_id,
            "contentReleaseId": content_release_id,
            "kind": kind,
            # Media identity is content-addressed.  Reusing an asset ID with a
            # different blob must never make mediaBlobId point at two hashes.
            "mediaBlobId": f"blob-{self.media_sha256}",
            "mediaSha256": self.media_sha256,
            "sourceTextDigest": self.source_text_digest,
            "mimeType": self.mime_type,
            "sizeBytes": self.size_bytes,
            "durationMs": self.duration_ms,
            "provider": self.provider,
            "model": self.model,
            "voice": self.voice,
            "accentLocale": self.accent_locale,
            "rate": self.rate,
            "contentDigest": self.media_sha256,
            "sourceEvidenceRefs": ["tts-generated"],
            "reviewStatus": review_status,
        }
        if kind == "study_example_audio":
            doc["senseVersionId"] = sense_version_id
            doc["sourceExampleAssetId"] = source_example_asset_id
            doc["learnerLocale"] = "zh-Hans"
        elif kind == "pronunciation_audio":
            doc["lexemeVersionId"] = lexeme_version_id
        return doc


async def _synthesize_edge_async(text: str, voice: str, rate: str, out_path: Path) -> TTSResult:
    communicate = edge_tts.Communicate(text, voice, rate=rate)
    await communicate.save(str(out_path))

    media_sha, size_bytes, duration_ms = inspect_mp3(out_path)
    src_digest = sha256_text(text)

    return TTSResult(
        media_path=out_path,
        media_sha256=media_sha,
        source_text_digest=src_digest,
        duration_ms=duration_ms,
        size_bytes=size_bytes,
        voice=voice,
        rate=rate,
    )


def inspect_mp3(path: Path) -> tuple[str, int, int]:
    """Validate a non-empty MP3 and return content hash, size, duration."""

    if not path.exists() or not path.is_file():
        raise ValueError(f"MP3 file does not exist: {path}")
    data = path.read_bytes()
    if not data:
        raise ValueError(f"MP3 file is empty: {path}")
    try:
        mp3 = mutagen.mp3.MP3(str(path))
        duration_ms = int(round(float(mp3.info.length) * 1000))
    except Exception as exc:
        raise ValueError(f"MP3 metadata is invalid: {path.name}: {exc}") from exc
    if duration_ms <= 0:
        raise ValueError(f"MP3 duration must be positive: {path.name}")
    return sha256_bytes(data), len(data), duration_ms


def synthesize(
    text: str,
    out_path: Path,
    voice: str = DEFAULT_VOICE,
    rate: str = DEFAULT_RATE,
    accent_locale: str = DEFAULT_LOCALE,
    allow_external: bool = False,
) -> TTSResult:
    """同步阻塞调用 Edge TTS 合成音频并计算精确元数据。"""
    if not allow_external:
        raise RuntimeError(
            "External TTS is disabled by default; pass allow_external=True from an explicitly approved operator command"
        )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    return asyncio.run(_synthesize_edge_async(text, voice, rate, out_path))
