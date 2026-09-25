#!/usr/bin/env python3
"""Generate and bind Edge TTS audio for lightweight authoring documents."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Any


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))

from content.tools.tts import inspect_mp3, synthesize  # noqa: E402


VOICE_CONFIG = {
    "en": {"voice": "en-US-JennyNeural", "locale": "en-US", "rate": "+0%"},
}


def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _sense_key(sense_id: str) -> str:
    key = re.sub(r"[^a-z0-9]+", "-", sense_id.lower()).strip("-")
    if not key:
        raise ValueError("Sense ID does not produce a usable file key")
    return key


def _ready_audio_is_current(audio: dict[str, Any], source_text: str, media_path: Path, config: dict[str, str]) -> bool:
    if audio.get("status") != "ready" or audio.get("source_text_digest") != _sha256_text(source_text):
        return False
    if any(audio.get(key) != value for key, value in {"provider": "microsoft-edge-tts", **config}.items()):
        return False
    try:
        sha256, size_bytes, duration_ms = inspect_mp3(media_path)
    except ValueError:
        return False
    return (
        audio.get("sha256") == sha256
        and audio.get("size_bytes") == size_bytes
        and audio.get("duration_ms") == duration_ms
    )


def _generate_one(
    package_path: Path,
    kinds: set[str],
    allow_external: bool,
    force: bool,
) -> tuple[int, int]:
    doc = json.loads(package_path.read_text(encoding="utf-8"))
    schema_version = doc.get("schema_version")
    if schema_version == "sensa.lightweight-target-core.authoring.v1":
        target_language = doc["target_language"]
        sense_id = doc["sense_id"]
        batch_root = package_path.parents[2]
    elif schema_version == "sensa.lightweight-learning-package.authoring.v2":
        target_language = doc["route"]["target"]
        sense_id = doc["sense"]["id"]
        batch_root = package_path.parent.parent
    else:
        raise ValueError(f"Unsupported authoring schema in {package_path}: {schema_version!r}")
    try:
        config = VOICE_CONFIG[target_language]
    except KeyError as exc:
        raise ValueError(f"No approved Edge TTS configuration for target language {target_language!r}") from exc

    sense_key = _sense_key(sense_id)
    specs = {
        "expression": (
            doc["target_core"]["pronunciation"]["tts_text"],
            doc["target_core"]["pronunciation"]["audio"],
        ),
        "scene": (
            doc["target_core"]["scene_realization"]["example"],
            doc["target_core"]["scene_realization"]["audio"],
        ),
    }

    generated = 0
    reused = 0
    for kind in ("expression", "scene"):
        if kind not in kinds:
            continue
        source_text, audio = specs[kind]
        relative_asset = f"assets/audio/{sense_key}.{kind}.{config['locale']}.edge-tts.mp3"
        media_path = batch_root / relative_asset
        if not force and _ready_audio_is_current(audio, source_text, media_path, config):
            reused += 1
            continue
        if not allow_external:
            raise RuntimeError(
                f"{package_path.name} {kind} audio needs synthesis; rerun with --allow-external after explicit approval"
            )

        media_path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix=f"sensa-{sense_key}-{kind}-") as directory:
            temporary = Path(directory) / "audio.mp3"
            result = synthesize(
                source_text,
                temporary,
                voice=config["voice"],
                rate=config["rate"],
                accent_locale=config["locale"],
                allow_external=True,
            )
            os.replace(temporary, media_path)
        audio.clear()
        audio.update(
            {
                "status": "ready",
                "asset": relative_asset,
                "provider": result.provider,
                "voice": result.voice,
                "locale": result.accent_locale,
                "rate": result.rate,
                "mime_type": result.mime_type,
                "sha256": result.media_sha256,
                "source_text_digest": result.source_text_digest,
                "duration_ms": result.duration_ms,
                "size_bytes": result.size_bytes,
            }
        )
        generated += 1

    if generated:
        temporary_package = package_path.with_suffix(".json.tmp")
        temporary_package.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary_package, package_path)
    return generated, reused


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("packages", nargs="+", type=Path, help="One or more canonical single-Sense package files")
    parser.add_argument("--kind", choices=("all", "expression", "scene"), default="all")
    parser.add_argument("--allow-external", action="store_true", help="Explicitly allow Edge TTS network calls")
    parser.add_argument("--force", action="store_true", help="Regenerate even when the bound audio is current")
    args = parser.parse_args()

    kinds = {"expression", "scene"} if args.kind == "all" else {args.kind}
    generated_total = 0
    reused_total = 0
    for package in args.packages:
        generated, reused = _generate_one(package, kinds, args.allow_external, args.force)
        generated_total += generated
        reused_total += reused
    print(f"TTS complete: generated={generated_total}, reused={reused_total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
