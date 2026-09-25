#!/usr/bin/env python3
"""No-cost validation and manifest generation for lightweight authoring batches."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Iterable

from jsonschema import Draft202012Validator, FormatChecker
from mutagen.mp3 import MP3
from PIL import Image


CONTENT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SCHEMA = CONTENT_ROOT / "schema" / "lightweight-learning-package-authoring.schema.json"
SCHEMA_VERSION = "sensa.lightweight-learning-package.authoring.v2"
MANIFEST_VERSION = "sensa.lightweight-learning-package.batch-manifest.v1"


@dataclass(frozen=True)
class Finding:
    package: str
    sense_id: str | None
    code: str
    path: str
    message: str


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _json_pointer(parts: Iterable[Any]) -> str:
    encoded = [str(part).replace("~", "~0").replace("/", "~1") for part in parts]
    return "/" + "/".join(encoded) if encoded else "/"


def _sense_key(sense_id: str) -> str:
    key = re.sub(r"[^a-z0-9]+", "-", sense_id.lower()).strip("-")
    if not key:
        raise ValueError("Sense ID does not produce a usable file key")
    return key


def _resolve_asset(batch_root: Path, asset: str) -> Path:
    relative = PurePosixPath(asset)
    if relative.is_absolute() or ".." in relative.parts or not relative.parts:
        raise ValueError("asset path must be a safe path relative to the batch root")
    resolved = (batch_root / Path(*relative.parts)).resolve()
    root = batch_root.resolve()
    if resolved != root and root not in resolved.parents:
        raise ValueError("asset path escapes the batch root")
    return resolved


def _finding(
    findings: list[Finding],
    package: Path,
    sense_id: str | None,
    code: str,
    path: str,
    message: str,
) -> None:
    findings.append(Finding(package.name, sense_id, code, path, message))


def _validate_audio(
    batch_root: Path,
    package: Path,
    sense_id: str,
    sense_key: str,
    path: str,
    audio: dict[str, Any],
    source_text: str,
    kind: str,
    stage: str,
    findings: list[Finding],
) -> tuple[str, str, str] | None:
    status = audio.get("status")
    if stage == "final" and status != "ready":
        _finding(findings, package, sense_id, "audio.not_ready", path + "/status", "final validation requires ready audio")
        return None
    if status != "ready":
        return None

    asset = audio.get("asset", "")
    expected = f"assets/audio/{sense_key}.{kind}.{audio.get('locale', '')}.edge-tts.mp3"
    if asset != expected:
        _finding(findings, package, sense_id, "audio.path", path + "/asset", f"expected {expected!r}, got {asset!r}")

    expected_digest = _sha256_text(source_text)
    if audio.get("source_text_digest") != expected_digest:
        _finding(
            findings,
            package,
            sense_id,
            "audio.source_digest",
            path + "/source_text_digest",
            "source text digest does not match the current JSON text",
        )

    try:
        media_path = _resolve_asset(batch_root, asset)
    except ValueError as exc:
        _finding(findings, package, sense_id, "asset.path", path + "/asset", str(exc))
        return None
    if not media_path.is_file():
        _finding(findings, package, sense_id, "asset.missing", path + "/asset", f"missing file: {asset}")
        return None

    data = media_path.read_bytes()
    if not data:
        _finding(findings, package, sense_id, "asset.empty", path + "/asset", f"empty file: {asset}")
        return None
    if audio.get("size_bytes") != len(data):
        _finding(findings, package, sense_id, "audio.size", path + "/size_bytes", f"expected {len(data)} bytes")
    if audio.get("sha256") != _sha256_bytes(data):
        _finding(findings, package, sense_id, "audio.sha256", path + "/sha256", "SHA-256 does not match the MP3")
    try:
        duration_ms = int(round(float(MP3(str(media_path)).info.length) * 1000))
    except Exception as exc:
        _finding(findings, package, sense_id, "audio.invalid", path + "/asset", f"invalid MP3: {exc}")
    else:
        if audio.get("duration_ms") != duration_ms:
            _finding(findings, package, sense_id, "audio.duration", path + "/duration_ms", f"expected {duration_ms} ms")

    return str(audio.get("provider", "")), str(audio.get("voice", "")), str(audio.get("locale", ""))


def _validate_image(
    batch_root: Path,
    package: Path,
    sense_id: str,
    sense_key: str,
    visual: dict[str, Any],
    stage: str,
    findings: list[Finding],
) -> None:
    status = visual.get("status")
    if status != "ready":
        return

    media = visual.get("media", {})
    asset = media.get("asset", "")
    expected_prefix = f"assets/images/{sense_key}."
    if not asset.startswith(expected_prefix):
        _finding(
            findings,
            package,
            sense_id,
            "image.path",
            "/visual/media/asset",
            f"image path must start with {expected_prefix!r}",
        )
    try:
        media_path = _resolve_asset(batch_root, asset)
    except ValueError as exc:
        _finding(findings, package, sense_id, "asset.path", "/visual/media/asset", str(exc))
        return
    if not media_path.is_file():
        _finding(findings, package, sense_id, "asset.missing", "/visual/media/asset", f"missing file: {asset}")
        return

    data = media_path.read_bytes()
    if not data:
        _finding(findings, package, sense_id, "asset.empty", "/visual/media/asset", f"empty file: {asset}")
        return
    if media.get("size_bytes") != len(data):
        _finding(findings, package, sense_id, "image.size", "/visual/media/size_bytes", f"expected {len(data)} bytes")
    if media.get("sha256") != _sha256_bytes(data):
        _finding(findings, package, sense_id, "image.sha256", "/visual/media/sha256", "SHA-256 does not match the image")

    try:
        with Image.open(media_path) as image:
            image.verify()
        with Image.open(media_path) as image:
            width, height = image.size
            actual_mime = Image.MIME.get(image.format or "")
    except Exception as exc:
        _finding(findings, package, sense_id, "image.invalid", "/visual/media/asset", f"invalid image: {exc}")
        return
    if "width" in media and media.get("width") != width or "height" in media and media.get("height") != height:
        _finding(findings, package, sense_id, "image.dimensions", "/visual/media", f"expected declared dimensions {width}x{height}")
    if "mime_type" in media and media.get("mime_type") != actual_mime:
        _finding(findings, package, sense_id, "image.mime", "/visual/media/mime_type", f"expected {actual_mime!r}")


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def validate_batch(
    batch_root: Path,
    schema_path: Path,
    stage: str,
    asset_root: Path | None = None,
) -> tuple[list[Finding], list[dict[str, Any]]]:
    findings: list[Finding] = []
    package_summaries: list[dict[str, Any]] = []
    package_dir = batch_root / "packages"
    if not package_dir.is_dir():
        return [Finding("(batch)", None, "batch.packages_missing", "/", "packages/ directory is missing")], []

    try:
        schema = _load_json(schema_path)
        Draft202012Validator.check_schema(schema)
    except Exception as exc:
        return [Finding("(schema)", None, "schema.invalid", "/", str(exc))], []
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    media_root = asset_root if asset_root is not None else batch_root

    package_paths = sorted(package_dir.glob("*.json"))
    if not package_paths:
        return [Finding("(batch)", None, "batch.empty", "/", "packages/ contains no JSON files")], []

    seen_senses: dict[str, str] = {}
    seen_assets: dict[str, str] = {}
    routes: set[tuple[str, str]] = set()
    tts_configs: set[tuple[str, str, str]] = set()

    for package_path in package_paths:
        try:
            doc = _load_json(package_path)
        except Exception as exc:
            _finding(findings, package_path, None, "json.invalid", "/", str(exc))
            continue
        sense_id = doc.get("sense", {}).get("id") if isinstance(doc, dict) else None
        for error in sorted(validator.iter_errors(doc), key=lambda item: list(item.absolute_path)):
            _finding(findings, package_path, sense_id, "schema", _json_pointer(error.absolute_path), error.message)
        if not isinstance(sense_id, str):
            continue
        try:
            sense_key = _sense_key(sense_id)
        except ValueError as exc:
            _finding(findings, package_path, sense_id, "sense.key", "/sense/id", str(exc))
            continue
        expected_name = f"{sense_key}.json"
        if package_path.name != expected_name:
            _finding(findings, package_path, sense_id, "package.filename", "/sense/id", f"expected filename {expected_name!r}")
        if sense_id in seen_senses:
            _finding(findings, package_path, sense_id, "sense.duplicate", "/sense/id", f"also present in {seen_senses[sense_id]}")
        else:
            seen_senses[sense_id] = package_path.name

        route = doc.get("route", {})
        if isinstance(route, dict) and isinstance(route.get("target"), str) and isinstance(route.get("support"), str):
            routes.add((route["target"], route["support"]))

        target_core = doc.get("target_core", {})
        pronunciation = target_core.get("pronunciation", {}) if isinstance(target_core, dict) else {}
        scene = target_core.get("scene_realization", {}) if isinstance(target_core, dict) else {}
        audio_specs = [
            ("/target_core/pronunciation/audio", pronunciation.get("audio", {}), pronunciation.get("tts_text", ""), "expression"),
            ("/target_core/scene_realization/audio", scene.get("audio", {}), scene.get("example", ""), "scene"),
        ]
        for path, audio, source_text, kind in audio_specs:
            if not isinstance(audio, dict) or not isinstance(source_text, str):
                continue
            config = _validate_audio(
                media_root,
                package_path,
                sense_id,
                sense_key,
                path,
                audio,
                source_text,
                kind,
                stage,
                findings,
            )
            if config and all(config):
                tts_configs.add(config)
            asset = audio.get("asset")
            if isinstance(asset, str):
                if asset in seen_assets:
                    _finding(findings, package_path, sense_id, "asset.duplicate", path + "/asset", f"also used by {seen_assets[asset]}")
                else:
                    seen_assets[asset] = package_path.name

        visual = doc.get("visual", {})
        if isinstance(visual, dict):
            _validate_image(media_root, package_path, sense_id, sense_key, visual, stage, findings)
            media = visual.get("media")
            if isinstance(media, dict) and isinstance(media.get("asset"), str):
                asset = media["asset"]
                if asset in seen_assets:
                    _finding(findings, package_path, sense_id, "asset.duplicate", "/visual/media/asset", f"also used by {seen_assets[asset]}")
                else:
                    seen_assets[asset] = package_path.name

        recall = doc.get("support_overlay", {}).get("experience_recall_cue", {}).get("text", "")
        target = doc.get("sense", {}).get("target", "")
        if isinstance(recall, str) and isinstance(target, str) and target and re.search(rf"(?i)(?<![A-Za-z]){re.escape(target)}(?![A-Za-z])", recall):
            _finding(findings, package_path, sense_id, "recall.target_leak", "/support_overlay/experience_recall_cue/text", "recall cue contains the target expression")

        package_summaries.append(
            {
                "sense_id": sense_id,
                "target_expression": target,
                "file": f"packages/{package_path.name}",
                "sha256": _sha256_bytes(package_path.read_bytes()),
                "visual_value": visual.get("value") if isinstance(visual, dict) else None,
                "visual_status": visual.get("status") if isinstance(visual, dict) else None,
            }
        )

    if len(routes) != 1:
        findings.append(Finding("(batch)", None, "route.mixed", "/route", f"expected one route, found {sorted(routes)}"))
    if stage == "final" and len(tts_configs) != 1:
        findings.append(Finding("(batch)", None, "tts.config_mixed", "/target_core", f"expected one TTS provider/voice/locale configuration, found {sorted(tts_configs)}"))

    return findings, package_summaries


def _write_manifest(batch_root: Path, packages: list[dict[str, Any]]) -> Path:
    routes = set()
    for package in sorted((batch_root / "packages").glob("*.json")):
        doc = _load_json(package)
        routes.add((doc["route"]["target"], doc["route"]["support"]))
    target, support = next(iter(routes))
    manifest = {
        "schema_version": MANIFEST_VERSION,
        "package_schema_version": SCHEMA_VERSION,
        "route": {"target": target, "support": support},
        "media_contract": {"generated_image_format": "unconstrained", "audio_format": "mp3"},
        "package_count": len(packages),
        "packages": sorted(packages, key=lambda item: item["sense_id"]),
    }
    path = batch_root / "batch-manifest.json"
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("batch_root", type=Path, help="Batch root containing packages/ and assets/")
    parser.add_argument("--schema", type=Path, default=DEFAULT_SCHEMA)
    parser.add_argument("--asset-root", type=Path, help="Shared media root when route JSONs are materialized separately")
    parser.add_argument("--stage", choices=("text-ready", "final"), default="final")
    parser.add_argument("--write-manifest", action="store_true")
    parser.add_argument("--json", action="store_true", dest="json_output")
    args = parser.parse_args()

    findings, packages = validate_batch(args.batch_root, args.schema, args.stage, args.asset_root)
    report = {
        "ok": not findings,
        "stage": args.stage,
        "package_count": len(packages),
        "finding_count": len(findings),
        "findings": [asdict(item) for item in findings],
    }
    if args.json_output:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    elif findings:
        for item in findings:
            print(f"ERROR {item.package} {item.path} [{item.code}] {item.message}")
        print(f"FAIL: {len(findings)} finding(s) across {len(packages)} package(s)")
    else:
        print(f"PASS: {len(packages)} package(s) satisfy {args.stage} validation")

    if not findings and args.write_manifest:
        manifest = _write_manifest(args.batch_root, packages)
        if not args.json_output:
            print(f"WROTE: {manifest}")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
