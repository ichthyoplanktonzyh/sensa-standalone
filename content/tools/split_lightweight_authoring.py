#!/usr/bin/env python3
"""Split lightweight authoring into reusable Target Cores and Support Overlays.

The existing combined authoring schema remains the materialized route contract.
This tool never calls models, image services, or TTS providers.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))

from content.tools.validate_lightweight_authoring import (
    DEFAULT_SCHEMA,
    _resolve_asset,
    _sense_key,
    _write_manifest,
    validate_batch,
)


CORE_VERSION = "sensa.lightweight-target-core.authoring.v1"
OVERLAY_VERSION = "sensa.lightweight-support-overlay.authoring.v1"
VISUAL_TEXT_KEYS = frozenset({"brief", "must_show", "must_avoid", "alt_text"})
LANGUAGE_TAG = re.compile(r"^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$")


def _canonical_sha256(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Expected JSON object: {path}")
    return value


def _check_fields(value: Any, required: set[str], optional: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    missing = required - value.keys()
    extra = value.keys() - required - optional
    if missing or extra:
        raise ValueError(f"{label} has missing keys {sorted(missing)} or extra keys {sorted(extra)}")
    return value


def _check_language(tag: str) -> str:
    if not isinstance(tag, str) or not LANGUAGE_TAG.fullmatch(tag):
        raise ValueError(f"Invalid language tag: {tag!r}")
    return tag


def _core_path(root: Path, target: str, sense_id: str) -> Path:
    return root / "core" / _check_language(target) / f"{_sense_key(sense_id)}.json"


def _overlay_path(root: Path, target: str, support: str, sense_id: str) -> Path:
    return root / "overlay" / _check_language(target) / _check_language(support) / f"{_sense_key(sense_id)}.json"


def _split_combined(doc: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    visual = doc["visual"]
    core = {
        "schema_version": CORE_VERSION,
        "sense_id": doc["sense"]["id"],
        "target_language": doc["route"]["target"],
        "target_core": doc["target_core"],
        "visual_shared": {key: value for key, value in visual.items() if key not in VISUAL_TEXT_KEYS},
        "research_notes": doc["research_notes"],
    }
    overlay = {
        "schema_version": OVERLAY_VERSION,
        "core_ref": {
            "sense_id": core["sense_id"],
            "target_language": core["target_language"],
            "sha256": _canonical_sha256(core),
        },
        "support_language": doc["route"]["support"],
        "sense_text": {key: value for key, value in doc["sense"].items() if key in {"idea", "avoid"}},
        "support_overlay": doc["support_overlay"],
        "visual_text": {key: value for key, value in visual.items() if key in VISUAL_TEXT_KEYS},
        "research_notes": [],
    }
    if "confidence_notes" in doc:
        overlay["confidence_notes"] = doc["confidence_notes"]
    return core, overlay


def _compose(core: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
    _check_fields(
        core,
        {"schema_version", "sense_id", "target_language", "target_core", "visual_shared", "research_notes"},
        set(),
        "Target Core",
    )
    _check_fields(
        overlay,
        {"schema_version", "core_ref", "support_language", "sense_text", "support_overlay", "visual_text", "research_notes"},
        {"confidence_notes"},
        "Support Overlay",
    )
    if core["schema_version"] != CORE_VERSION or overlay["schema_version"] != OVERLAY_VERSION:
        raise ValueError("Unsupported split authoring schema version")
    reference = _check_fields(overlay["core_ref"], {"sense_id", "target_language", "sha256"}, set(), "Core reference")
    if reference["sense_id"] != core["sense_id"] or reference["target_language"] != core["target_language"]:
        raise ValueError(f"Core reference identity mismatch for {core['sense_id']}")
    if reference["sha256"] != _canonical_sha256(core):
        raise ValueError(f"Stale Core reference for {core['sense_id']}; review this Overlay against the changed Core")
    sense_text = _check_fields(overlay["sense_text"], {"idea"}, {"avoid"}, "Support-language Sense text")
    visual_text = _check_fields(overlay["visual_text"], set(), VISUAL_TEXT_KEYS, "Visual text")
    visual_shared = _check_fields(core["visual_shared"], {"value", "status", "role", "purpose"}, {"media"}, "Shared visual")
    if not isinstance(core["research_notes"], list) or not isinstance(overlay["research_notes"], list):
        raise ValueError("Research notes must be arrays")
    expression = core["target_core"]["target_expression"]["text"]
    combined = {
        "schema_version": "sensa.lightweight-learning-package.authoring.v2",
        "sense": {"id": core["sense_id"], **sense_text, "target": expression},
        "route": {"target": core["target_language"], "support": overlay["support_language"]},
        "target_core": core["target_core"],
        "support_overlay": overlay["support_overlay"],
        "visual": {**visual_shared, **visual_text},
        "research_notes": [*core["research_notes"], *overlay["research_notes"]],
    }
    if "confidence_notes" in overlay:
        combined["confidence_notes"] = overlay["confidence_notes"]
    return combined


def _write_json(path: Path, value: dict[str, Any], *, immutable: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if immutable and path.exists():
        if _load_json(path) != value:
            raise ValueError(f"Existing authoring source differs; refusing to overwrite {path}")
        return
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, suffix=".tmp", delete=False) as handle:
        temporary = Path(handle.name)
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    os.replace(temporary, path)


def _asset_specs(doc: dict[str, Any]) -> list[dict[str, Any]]:
    core = doc["target_core"]
    specs = [core["pronunciation"]["audio"], core["scene_realization"]["audio"]]
    visual = doc["visual"]
    if visual["status"] == "ready":
        specs.append(visual["media"])
    return specs


def _copy_verified_asset(source_root: Path, output_root: Path, asset: dict[str, Any]) -> bool:
    relative = asset["asset"]
    source = _resolve_asset(source_root, relative)
    destination = _resolve_asset(output_root, relative)
    digest = asset["sha256"]
    if hashlib.sha256(source.read_bytes()).hexdigest() != digest:
        raise ValueError(f"Source media digest mismatch: {source}")
    if destination.exists():
        if hashlib.sha256(destination.read_bytes()).hexdigest() != digest:
            raise ValueError(f"Shared media path collision: {destination}")
        return False
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=destination.parent, suffix=".tmp", delete=False) as handle:
        temporary = Path(handle.name)
    try:
        shutil.copyfile(source, temporary)
        if hashlib.sha256(temporary.read_bytes()).hexdigest() != digest:
            raise ValueError(f"Copied media digest mismatch: {destination}")
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
    return True


def _migrate(root: Path, source_batches: list[Path]) -> None:
    seen_routes: set[tuple[str, str, str]] = set()
    cores: set[tuple[str, str]] = set()
    copied_assets = 0
    overlays = 0
    for source_root in source_batches:
        findings, packages = validate_batch(source_root, DEFAULT_SCHEMA, "final")
        if findings:
            preview = "; ".join(f"{item.package} {item.path}: {item.message}" for item in findings[:5])
            raise ValueError(f"Source batch is not final-valid: {source_root}: {preview}")
        for item in packages:
            source_doc = _load_json(source_root / item["file"])
            core, overlay = _split_combined(source_doc)
            identity = (core["sense_id"], core["target_language"], overlay["support_language"])
            if identity in seen_routes:
                raise ValueError(f"Duplicate source route for {identity}")
            seen_routes.add(identity)
            if _compose(core, overlay) != source_doc:
                raise ValueError(f"Split/compose round trip changed {source_root / item['file']}")
            _write_json(_core_path(root, core["target_language"], core["sense_id"]), core, immutable=True)
            _write_json(
                _overlay_path(root, core["target_language"], overlay["support_language"], core["sense_id"]),
                overlay,
                immutable=True,
            )
            cores.add((core["sense_id"], core["target_language"]))
            overlays += 1
            for asset in _asset_specs(source_doc):
                copied_assets += int(_copy_verified_asset(source_root, root, asset))
    print(f"MIGRATED: {len(cores)} Target Cores, {overlays} Support Overlays, {copied_assets} unique shared assets.")


def _originals_for_route(source_batches: list[Path], target: str, support: str) -> dict[str, dict[str, Any]]:
    originals: dict[str, dict[str, Any]] = {}
    for batch_root in source_batches:
        for path in sorted((batch_root / "packages").glob("*.json")):
            doc = _load_json(path)
            if doc["route"] != {"target": target, "support": support}:
                continue
            sense_id = doc["sense"]["id"]
            if sense_id in originals:
                raise ValueError(f"Duplicate original Sense in route comparison: {sense_id}")
            originals[sense_id] = doc
    return originals


def _init_overlay(root: Path, target: str, support: str, sense_id: str) -> None:
    core = _load_json(_core_path(root, target, sense_id))
    if core["sense_id"] != sense_id or core["target_language"] != target:
        raise ValueError(f"Core identity mismatch for {sense_id}")
    path = _overlay_path(root, target, support, sense_id)
    if path.exists():
        raise ValueError(f"Overlay already exists; refusing to overwrite {path}")
    visual_text = (
        {"brief": "", "must_show": [], "must_avoid": [], "alt_text": ""}
        if core["visual_shared"]["value"] != "none" else {}
    )
    overlay = {
        "schema_version": OVERLAY_VERSION,
        "core_ref": {"sense_id": sense_id, "target_language": target, "sha256": _canonical_sha256(core)},
        "support_language": support,
        "sense_text": {"idea": ""},
        "support_overlay": {
            "experience_recall_cue": {"text": ""},
            "sense_confirmation": {"text": ""},
            "scene_bridge": {"text": ""},
            "scene_translation": {"text": ""},
            "optional": {},
        },
        "visual_text": visual_text,
        "research_notes": [],
        "confidence_notes": [],
    }
    _write_json(path, overlay, immutable=True)
    print(f"INITIALIZED: {path}; fill the empty support-language text before assembly.")


def _assemble(root: Path, target: str, support: str, output_root: Path, comparisons: list[Path]) -> None:
    target = _check_language(target)
    support = _check_language(support)
    overlay_dir = root / "overlay" / target / support
    overlays = sorted(overlay_dir.glob("*.json"))
    if not overlays:
        raise ValueError(f"No Support Overlays found in {overlay_dir}")
    schema = json.loads(DEFAULT_SCHEMA.read_text(encoding="utf-8"))
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    output_packages = output_root / "packages"
    expected_names = {path.name for path in overlays}
    if output_packages.exists():
        stale = {path.name for path in output_packages.glob("*.json")} - expected_names
        if stale:
            raise ValueError(f"Generated route directory has stale packages: {sorted(stale)}")
    originals = _originals_for_route(comparisons, target, support) if comparisons else None
    generated: dict[str, dict[str, Any]] = {}
    for overlay_path in overlays:
        overlay = _load_json(overlay_path)
        reference = overlay["core_ref"]
        core_path = _core_path(root, reference["target_language"], reference["sense_id"])
        core = _load_json(core_path)
        if overlay_path.name != f"{_sense_key(core['sense_id'])}.json":
            raise ValueError(f"Overlay filename does not match its Core: {overlay_path}")
        doc = _compose(core, overlay)
        if doc["route"] != {"target": target, "support": support}:
            raise ValueError(f"Overlay route mismatch: {overlay_path}")
        errors = sorted(validator.iter_errors(doc), key=lambda item: list(item.absolute_path))
        if errors:
            raise ValueError(f"Materialized schema failed for {overlay_path}: {errors[0].message}")
        generated[core["sense_id"]] = doc
        if originals is not None and originals.get(core["sense_id"]) != doc:
            raise ValueError(f"Materialized route differs from original for {core['sense_id']}")
    if originals is not None and set(originals) != set(generated):
        raise ValueError(f"Round-trip Sense sets differ: missing={sorted(set(originals)-set(generated))}, extra={sorted(set(generated)-set(originals))}")
    output_root.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="sensa-route-stage-", dir=output_root.parent) as directory:
        staging_root = Path(directory)
        for sense_id, doc in generated.items():
            _write_json(staging_root / "packages" / f"{_sense_key(sense_id)}.json", doc, immutable=False)
        findings, packages = validate_batch(staging_root, DEFAULT_SCHEMA, "final", asset_root=root)
        if findings:
            preview = "; ".join(f"{item.package} {item.path}: {item.message}" for item in findings[:5])
            raise ValueError(f"Materialized route failed final validation: {preview}")
        _write_manifest(staging_root, packages)
        for path in sorted((staging_root / "packages").glob("*.json")):
            _write_json(output_packages / path.name, _load_json(path), immutable=False)
        _write_json(output_root / "batch-manifest.json", _load_json(staging_root / "batch-manifest.json"), immutable=False)
    print(f"ASSEMBLED: {len(packages)} {target} → {support} packages; shared media validated; round-trip comparison {'passed' if originals is not None else 'not requested'}.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    migrate = commands.add_parser("migrate", help="Losslessly split existing combined batches")
    migrate.add_argument("--root", type=Path, required=True)
    migrate.add_argument("--source-batch", type=Path, action="append", required=True)
    initialize = commands.add_parser("init-overlay", help="Create an empty Overlay bound to an existing Core")
    initialize.add_argument("--root", type=Path, required=True)
    initialize.add_argument("--target", required=True)
    initialize.add_argument("--support", required=True)
    initialize.add_argument("--sense-id", required=True)
    digest = commands.add_parser("core-digest", help="Print the current Core digest after reviewing a Core change")
    digest.add_argument("--root", type=Path, required=True)
    digest.add_argument("--target", required=True)
    digest.add_argument("--sense-id", required=True)
    assemble = commands.add_parser("assemble", help="Materialize one Target/Support route from split sources")
    assemble.add_argument("--root", type=Path, required=True)
    assemble.add_argument("--target", required=True)
    assemble.add_argument("--support", required=True)
    assemble.add_argument("--output", type=Path, required=True)
    assemble.add_argument("--compare-batch", type=Path, action="append", default=[])
    args = parser.parse_args()
    try:
        if args.command == "migrate":
            _migrate(args.root.resolve(), [path.resolve() for path in args.source_batch])
        elif args.command == "init-overlay":
            _init_overlay(args.root.resolve(), args.target, args.support, args.sense_id)
        elif args.command == "core-digest":
            core = _load_json(_core_path(args.root.resolve(), args.target, args.sense_id))
            if core["sense_id"] != args.sense_id or core["target_language"] != args.target:
                raise ValueError(f"Core identity mismatch for {args.sense_id}")
            print(_canonical_sha256(core))
        else:
            _assemble(
                args.root.resolve(), args.target, args.support, args.output.resolve(),
                [path.resolve() for path in args.compare_batch],
            )
    except (KeyError, OSError, TypeError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
