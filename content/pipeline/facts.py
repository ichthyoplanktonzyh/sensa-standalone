"""Read the immutable authoring facts used by one package build."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from tools.lexeme_forms import verified_lexeme_forms

from .model import issue


def open_authoring_db(path: Path) -> sqlite3.Connection:
    if not path.exists():
        raise FileNotFoundError(f"Authoring database does not exist: {path}")
    connection = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only = ON")
    return connection


def _parse_array(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return [item.strip() for item in value.split(",") if item.strip()]
        return parsed if isinstance(parsed, list) else []
    return []


def _row(row: sqlite3.Row | None) -> dict[str, Any]:
    return dict(row) if row is not None else {}


def _relation_id(value: Any) -> str:
    text = str(value)
    return text if text.startswith("rel-") else f"rel-{text}"


def load_facts(
    db_path: Path,
    sense_id: str,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    problems: list[dict[str, Any]] = []
    connection = open_authoring_db(db_path)
    try:
        target_row = connection.execute("SELECT * FROM senses WHERE sense_id = ?", (sense_id,)).fetchone()
        if target_row is None:
            raise ValueError(f"Unknown Sense: {sense_id}")
        target = _row(target_row)
        word = str(target.get("word") or target.get("lemma") or "")
        siblings = [
            _row(item)
            for item in connection.execute(
                "SELECT * FROM senses WHERE word = ? AND sense_id <> ? ORDER BY sense_num",
                (word, sense_id),
            )
        ]
        relations = [
            _row(item)
            for item in connection.execute(
                "SELECT * FROM relations WHERE word = ? AND (source_sense_id = ? OR target_sense_id = ?)",
                (word, sense_id, sense_id),
            )
        ]
        dictionary_entries = [
            _row(item)
            for item in connection.execute(
                "SELECT * FROM dictionary_entries WHERE word = ? ORDER BY entry_order",
                (word,),
            )
        ]
        try:
            lexeme = _row(connection.execute("SELECT * FROM lexemes WHERE lemma = ?", (target.get("lemma"),)).fetchone())
        except sqlite3.Error:
            lexeme = {}
        valid_forms = verified_lexeme_forms(
            connection,
            str(target.get("lemma") or word),
            part_of_speech=str(target.get("pos") or ""),
        )
    finally:
        connection.close()

    required_target_fields = ("sense_id", "lemma", "pos", "label_zh", "definition", "sense_num")
    for key in required_target_fields:
        if target.get(key) in (None, ""):
            problems.append(issue("facts.target_field_missing", f"Target Sense lacks {key}", stage="facts", path=f"target.{key}"))

    source_entries = [str(value).strip() for value in _parse_array(target.get("source_entries")) if str(value).strip()]
    entries_by_id = {str(entry.get("entry_id")): entry for entry in dictionary_entries}
    target_evidence = [entries_by_id[value] for value in source_entries if value in entries_by_id]
    missing_evidence = [value for value in source_entries if value not in entries_by_id]
    if not source_entries:
        problems.append(issue("facts.evidence_missing", "Target Sense has no source_entries", stage="facts", path="target.source_entries"))
    if missing_evidence:
        problems.append(issue(
            "facts.evidence_reference_missing",
            f"Unknown dictionary evidence: {', '.join(missing_evidence)}",
            stage="facts",
            path="target.source_entries",
        ))
    if not valid_forms:
        problems.append(issue("facts.forms_missing", "No independently verified Lexeme forms", stage="facts", path="validForms"))

    relation_documents = []
    for relation in relations:
        relation_documents.append({**relation, "senseRelationId": _relation_id(relation.get("id"))})

    lemma = str(target.get("lemma") or word)
    facts = {
        "schemaVersion": "sensa-sense-fact-bundle-v1",
        "identity": {
            "senseId": sense_id,
            "senseVersionId": f"sv-{sense_id}",
            "lexemeId": f"lex-{lemma}",
            "lexemeVersionId": f"lv-{lemma}",
            "contentReleaseId": "rel-2026-v1-candidate",
            "targetLanguage": "en",
            "learnerLocale": "zh-Hans",
        },
        "target": target,
        "lexeme": lexeme,
        "validForms": valid_forms,
        "siblings": siblings,
        "relations": relation_documents,
        "dictionaryEntries": dictionary_entries,
        "targetDictionaryEvidence": target_evidence,
        "sourceEvidenceRefs": source_entries,
    }
    return facts, problems
