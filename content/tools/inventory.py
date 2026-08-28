#!/usr/bin/env python3
"""SQLite-first Sense Inventory workflow.

Drafts, frozen dictionary evidence and approved inventories all live in
``content/data/senses.db``. YAML is not a production or audit store.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

import dictionary
import docio
import inventory_db
import llm

ROOT = Path(__file__).resolve().parent.parent
PROMPTS = ROOT / "prompts"
SCHEMA_NAME = "sense-inventory.schema.json"
EVIDENCE_SCHEMA_NAME = "dictionary-evidence.schema.json"
WORD_PATTERN = re.compile(r"^[a-z][a-z_]*$")
EVIDENCE_PROVIDER = "wiktionary"
SUPPORTED_LANGUAGE = "en"
IDENTITY_SIGNATURE_FIELDS = (
    "semantic_type",
    "dimension",
    "change_of_state",
    "causative",
    "valency",
)


class InventoryError(RuntimeError):
    """An approved inventory cannot safely drive downstream production."""


def compute_evidence_digest(entries: list[dict]) -> str:
    canonical = [
        {
            "entry_id": entry.get("entry_id"),
            "pos": entry.get("pos"),
            "gloss": entry.get("gloss"),
            "labels": list(entry.get("labels") or []),
            "examples": list(entry.get("examples") or []),
        }
        for entry in entries
    ]
    canonical.sort(key=lambda entry: entry["entry_id"] or "")
    payload = json.dumps(canonical, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()


def identity_payload(inventory_sense: dict) -> dict:
    signature = inventory_sense.get("semantic_signature")
    signature = signature if isinstance(signature, dict) else {}
    return {
        "id": inventory_sense.get("id"),
        "lemma": inventory_sense.get("lemma"),
        "pos": inventory_sense.get("pos"),
        "semantic_signature": {
            field: signature.get(field)
            for field in IDENTITY_SIGNATURE_FIELDS
        },
    }


def compute_identity_digest(inventory_sense: dict) -> str:
    payload = json.dumps(identity_payload(inventory_sense), sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _sense_number(word: str, sense_id: str) -> int | None:
    match = re.fullmatch(rf"{re.escape(word)}-([0-9]{{2}})", sense_id or "")
    return int(match.group(1)) if match else None


def validate_inventory_content(doc: dict, entries: list[dict], word: str) -> list[str]:
    """Validate identity, evidence coverage and relation integrity deterministically."""

    errors: list[str] = []
    senses = [item for item in doc.get("senses") or [] if isinstance(item, dict)]
    deferred = [item for item in doc.get("deferred_entries") or [] if isinstance(item, dict)]
    relations = [item for item in doc.get("relations") or [] if isinstance(item, dict)]
    entry_ids = {str(item.get("entry_id")) for item in entries if item.get("entry_id")}

    if doc.get("word") != word:
        errors.append(f"word must be {word!r}; found {doc.get('word')!r}")
    if doc.get("language") != SUPPORTED_LANGUAGE:
        errors.append(f"language must be {SUPPORTED_LANGUAGE!r}")
    source = doc.get("source") if isinstance(doc.get("source"), dict) else {}
    if source.get("provider") != EVIDENCE_PROVIDER:
        errors.append(f"source.provider must be {EVIDENCE_PROVIDER!r}")
    if source.get("entry_count") != len(entries):
        errors.append(f"source.entry_count must be {len(entries)}")
    expected_digest = compute_evidence_digest(entries)
    if source.get("evidence_digest") != expected_digest:
        errors.append("source.evidence_digest does not match frozen dictionary evidence")

    sense_ids: set[str] = set()
    numbers: list[int] = []
    entry_to_senses: dict[str, list[dict]] = defaultdict(list)
    for sense in senses:
        sense_id = str(sense.get("id") or "")
        if sense_id in sense_ids:
            errors.append(f"duplicate Sense ID: {sense_id}")
        sense_ids.add(sense_id)
        number = _sense_number(word, sense_id)
        if number is None:
            errors.append(f"Sense ID must match {word}-NN: {sense_id!r}")
        else:
            numbers.append(number)
        if sense.get("lemma") != word:
            errors.append(f"{sense_id}: lemma must equal {word!r}")
        if not str(sense.get("definition") or "").strip():
            errors.append(f"{sense_id}: definition is required")
        decision = sense.get("decision") if isinstance(sense.get("decision"), dict) else {}
        if not str(decision.get("reason") or "").strip():
            errors.append(f"{sense_id}: decision.reason is required")
        for entry_id in sense.get("source_entries") or []:
            if entry_id not in entry_ids:
                errors.append(f"{sense_id}: unknown source entry {entry_id!r}")
            entry_to_senses[str(entry_id)].append(sense)
    if numbers and sorted(numbers) != list(range(1, len(numbers) + 1)):
        errors.append(f"Sense numbering must be contiguous from 01; found {sorted(numbers)}")

    deferred_ids: set[str] = set()
    for item in deferred:
        entry_id = str(item.get("source_entry") or "")
        deferred_ids.add(entry_id)
        if entry_id not in entry_ids:
            errors.append(f"deferred entry is unknown: {entry_id!r}")
        if not str(item.get("reason") or "").strip():
            errors.append(f"deferred entry {entry_id!r} needs a reason")
    for entry_id, mapped in entry_to_senses.items():
        if entry_id in deferred_ids:
            errors.append(f"dictionary entry {entry_id!r} is both used and deferred")
        if len(mapped) > 1 and any((sense.get("decision") or {}).get("type") != "split" for sense in mapped):
            errors.append(f"dictionary entry {entry_id!r} maps to multiple non-split Senses")
    unhandled = sorted(entry_ids - set(entry_to_senses) - deferred_ids)
    if unhandled:
        errors.append(f"unhandled dictionary entries: {', '.join(unhandled)}")

    seen_relations: set[tuple[str, str, str]] = set()
    for relation in relations:
        source_id = str(relation.get("source") or "")
        target_id = str(relation.get("target") or "")
        relation_type = str(relation.get("relation") or "")
        key = (source_id, target_id, relation_type)
        if source_id not in sense_ids or target_id not in sense_ids:
            errors.append(f"relation references unknown Sense: {source_id} -> {target_id}")
        if source_id == target_id:
            errors.append(f"self relation is not allowed: {source_id}")
        if key in seen_relations:
            errors.append(f"duplicate relation: {key}")
        seen_relations.add(key)
        if not str(relation.get("distinction") or "").strip():
            errors.append(f"relation {source_id} -> {target_id} needs a distinction")
    return errors


def _all_errors(doc: dict, entries: list[dict], word: str) -> list[str]:
    validator = docio.load_schema(SCHEMA_NAME)
    errors = docio.schema_check(doc, validator, f"sqlite:inventory_drafts/{word}")
    errors.extend(f"  ✗ {word}: {message}" for message in validate_inventory_content(doc, entries, word))
    return errors


def _apply_machine_fields(doc: dict, word: str, entries: list[dict]) -> None:
    doc["schema_version"] = "1.0"
    doc["word"] = word
    doc["language"] = SUPPORTED_LANGUAGE
    doc["status"] = "draft"
    doc.setdefault("inventory_version", 1)
    source = doc.get("source") if isinstance(doc.get("source"), dict) else {}
    source.update({
        "provider": EVIDENCE_PROVIDER,
        "entry_count": len(entries),
        "evidence_digest": compute_evidence_digest(entries),
    })
    doc["source"] = source


def _build_evidence_doc(word: str, entries: list[dict]) -> dict:
    return {
        "schema_version": "1.0",
        "word": word,
        "language": SUPPORTED_LANGUAGE,
        "provider": EVIDENCE_PROVIDER,
        "captured_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "entries": [
            {
                "entry_id": entry["entry_id"],
                "pos": entry["pos"],
                "gloss": entry["gloss"],
                "labels": list(entry.get("labels") or []),
                "examples": list(entry.get("examples") or []),
            }
            for entry in entries
        ],
    }


def _format_evidence(entries: list[dict]) -> str:
    lines: list[str] = []
    for entry in entries:
        lines.extend([
            f"- entry_id: {entry['entry_id']}",
            f"  pos: {entry['pos']}",
            f"  gloss: {entry['gloss']}",
            f"  labels: {json.dumps(entry.get('labels') or [], ensure_ascii=False)}",
            f"  examples: {json.dumps(entry.get('examples') or [], ensure_ascii=False)}",
        ])
    return "\n".join(lines)


def _build_prompt(word: str, entries: list[dict], evidence_digest: str) -> str:
    template = docio.read(PROMPTS / "inventory-draft.md")
    schema = docio.read(ROOT / "schema" / SCHEMA_NAME)
    return (
        template
        .replace("{{SCHEMA}}", schema)
        .replace("{{WORD}}", word)
        .replace("{{ENTRY_COUNT}}", str(len(entries)))
        .replace("{{EVIDENCE_DIGEST}}", evidence_digest)
        .replace("{{DICTIONARY_EVIDENCE}}", _format_evidence(entries))
    )


def _fetch_entries(word: str, stage: str) -> list[dict]:
    try:
        entries = dictionary.get_filtered_entries(word)
    except (LookupError, requests.RequestException) as exc:
        raise InventoryError(f"[{word}] {stage}: dictionary evidence failed: {exc}") from exc
    if not entries:
        raise InventoryError(f"[{word}] {stage}: no usable dictionary evidence")
    return entries


def load_approved_evidence_entries(word: str) -> list[dict]:
    entries = inventory_db.get_evidence_entries(word)
    if entries is None:
        raise InventoryError(f"[{word}] approved dictionary evidence is missing from SQLite")
    return entries


def load_approved_inventory(word: str) -> dict:
    word = word.strip().lower()
    document = inventory_db.get_inventory(word)
    if document is None or document.get("status") != "approved":
        raise InventoryError(f"No approved SQLite Sense Inventory for {word!r}")
    entries = load_approved_evidence_entries(word)
    if (document.get("source") or {}).get("evidence_digest") != compute_evidence_digest(entries):
        raise InventoryError(f"[{word}] approved inventory/evidence digest mismatch")
    errors = _all_errors(document, entries, word)
    if errors:
        raise InventoryError("\n".join(errors))
    return document


def _draft(word: str) -> tuple[dict, dict, str | None]:
    value = inventory_db.get_inventory_draft(word)
    if value is None:
        raise InventoryError(f"[{word}] no SQLite inventory draft; run draft first")
    return value


def _validate(document: dict, evidence: dict, word: str, stage: str) -> list[dict]:
    entries = evidence.get("entries") if isinstance(evidence.get("entries"), list) else []
    evidence_errors = docio.schema_check(
        evidence,
        docio.load_schema(EVIDENCE_SCHEMA_NAME),
        f"sqlite:inventory_drafts/{word}/evidence",
    )
    errors = evidence_errors + _all_errors(document, entries, word)
    if errors:
        raise InventoryError(f"[{word}] {stage} failed:\n" + "\n".join(errors))
    return entries


def cmd_draft(args: argparse.Namespace) -> None:
    if not args.allow_external:
        raise InventoryError("inventory draft requires --allow-external")
    word = args.word.strip().lower()
    if not WORD_PATTERN.fullmatch(word):
        raise InventoryError(f"invalid word: {word!r}")
    if inventory_db.get_inventory_draft(word) is not None and not args.force:
        raise InventoryError(f"[{word}] SQLite draft already exists; use --force")
    entries = _fetch_entries(word, "draft")
    prompt = _build_prompt(word, entries, compute_evidence_digest(entries))
    raw = llm.generate(prompt)
    try:
        document = docio.extract_json_doc(raw)
        _apply_machine_fields(document, word, entries)
        evidence = _build_evidence_doc(word, entries)
        _validate(document, evidence, word, "draft")
    except Exception as exc:
        inventory_db.record_inventory_failure(word, raw, str(exc))
        raise InventoryError(f"[{word}] draft rejected; raw response stored in SQLite: {exc}") from exc
    inventory_db.save_inventory_draft(document, evidence, raw_output=raw)
    print(f"✓ [{word}] draft and frozen evidence stored in {inventory_db.DEFAULT_DB_PATH}")


def cmd_validate(args: argparse.Namespace) -> None:
    word = args.word.strip().lower()
    draft = inventory_db.get_inventory_draft(word)
    if draft is not None:
        document, evidence, _ = draft
        _validate(document, evidence, word, "validate")
        source = "inventory_drafts"
    else:
        document = load_approved_inventory(word)
        source = "inventories"
    print(f"✓ PASS [{word}] SQLite {source}")


def cmd_mark_reviewed(args: argparse.Namespace) -> None:
    word = args.word.strip().lower()
    document, evidence, _ = _draft(word)
    _validate(document, evidence, word, "mark-reviewed")
    if document.get("status") == "reviewed":
        print(f"✓ [{word}] draft is already reviewed")
        return
    if document.get("status") != "draft":
        raise InventoryError(f"[{word}] only draft status can become reviewed")
    inventory_db.set_inventory_draft_status(word, "reviewed")
    print(f"✓ [{word}] SQLite draft marked reviewed")


def _identity_map(document: dict) -> dict[str, str]:
    return {
        str(item["id"]): compute_identity_digest(item)
        for item in document.get("senses") or []
        if isinstance(item, dict) and item.get("id")
    }


def cmd_approve(args: argparse.Namespace) -> None:
    word = args.word.strip().lower()
    document, evidence, _ = _draft(word)
    entries = _validate(document, evidence, word, "approve")
    if document.get("status") != "reviewed":
        raise InventoryError(f"[{word}] only a reviewed draft can be approved")
    existing = inventory_db.get_inventory(word)
    if existing is not None and not args.force:
        raise InventoryError(f"[{word}] approved inventory already exists; use --force")
    if existing is not None and _identity_map(existing) != _identity_map(document):
        old_version = existing.get("inventory_version")
        new_version = document.get("inventory_version")
        if not isinstance(old_version, int) or not isinstance(new_version, int) or new_version <= old_version:
            raise InventoryError(
                f"[{word}] identity changed without an inventory_version increase "
                f"({old_version!r} -> {new_version!r})"
            )
    approved = dict(document)
    approved["status"] = "approved"
    errors = _all_errors(approved, entries, word)
    if errors:
        raise InventoryError("\n".join(errors))
    inventory_db.save_inventory_and_evidence(approved, evidence)
    print(f"✓ [{word}] approved inventory and evidence committed to SQLite")


def cmd_show(args: argparse.Namespace) -> None:
    word = args.word.strip().lower()
    draft = inventory_db.get_inventory_draft(word)
    if draft is not None:
        document, _, _ = draft
        source = "inventory_drafts"
    else:
        document = load_approved_inventory(word)
        source = "inventories"
    print(f"# SQLite {source}/{word}")
    print(json.dumps(document, ensure_ascii=False, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description="SQLite-first Sensa Sense Inventory tool")
    sub = parser.add_subparsers(dest="command", required=True)

    draft = sub.add_parser("draft")
    draft.add_argument("word")
    draft.add_argument("--force", action="store_true")
    draft.add_argument("--allow-external", action="store_true")
    draft.set_defaults(func=cmd_draft)

    validate = sub.add_parser("validate")
    validate.add_argument("word")
    validate.set_defaults(func=cmd_validate)

    reviewed = sub.add_parser("mark-reviewed")
    reviewed.add_argument("word")
    reviewed.set_defaults(func=cmd_mark_reviewed)

    approve = sub.add_parser("approve")
    approve.add_argument("word")
    approve.add_argument("--force", action="store_true")
    approve.set_defaults(func=cmd_approve)

    show = sub.add_parser("show")
    show.add_argument("word")
    show.set_defaults(func=cmd_show)

    args = parser.parse_args()
    try:
        args.func(args)
    except InventoryError as exc:
        print(exc, file=sys.stderr)
        raise SystemExit(2) from exc


if __name__ == "__main__":
    main()
