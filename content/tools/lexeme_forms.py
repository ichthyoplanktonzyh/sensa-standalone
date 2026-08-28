#!/usr/bin/env python3
"""Read the independently sourced Lexeme form inventory.

Generated examples are never allowed to expand this inventory. Reviewed forms
are materialized from the compressed Wiktionary snapshot into the canonical
SQLite ``lexeme_forms`` table when an inventory is approved. A database
``forms_json`` value is not an approval source; when no reviewed row exists the
safe fallback is the lemma itself.
"""

from __future__ import annotations

import json
import sqlite3
from typing import Any
import re

EXCLUDED_FORM_TAGS = {
    "alternative",
    "archaic",
    "contraction",
    "dated",
    "dialectal",
    "inflection-template",
    "obsolete",
    "nonstandard",
    "poetic",
    "pronunciation-spelling",
    "rare",
    "table-tags",
}

SENSA_POS_BY_WIKTIONARY_POS = {
    "adj": "adjective",
    "adv": "adverb",
    "conj": "conjunction",
    "det": "determiner",
    "intj": "interjection",
    "noun": "noun",
    "particle": "particle",
    "prep": "preposition",
    "pron": "pronoun",
    "verb": "verb",
}

FORM_RE = re.compile(r"^[A-Za-z]+(?:[-'][A-Za-z]+)*$")

# Wiktextract occasionally omits a usage tag carried by the source entry.
# Keep the small exception list explicit and reviewable instead of accepting a
# known archaic form as modern production vocabulary.
EXCLUDED_FORMS_BY_LEMMA = {
    "be": {"art"},
}


def _unique_forms(lemma: str, values: list[Any]) -> list[str]:
    forms: dict[str, str] = {lemma.casefold(): lemma}
    for value in values:
        if not isinstance(value, str):
            continue
        text = value.strip()
        # Wiktextract also emits table sentinels (for example ``-`` and
        # ``inflection-table-top``), symbols, and clitic fragments such as
        # ``'m``.  None can be used by the whole-word Example contract.
        if (
            text
            and FORM_RE.fullmatch(text)
            and text.casefold() not in EXCLUDED_FORMS_BY_LEMMA.get(lemma.casefold(), set())
        ):
            forms.setdefault(text.casefold(), text)
    return sorted(forms.values(), key=lambda value: (value.casefold(), value))


def verified_forms_from_jsonl(text: str, lemma: str) -> dict[str, list[str]]:
    """Extract reviewed form sets by canonical Sensa part of speech."""

    values: dict[str, list[Any]] = {}
    found: set[str] = set()
    for line in text.splitlines():
        try:
            document = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(document, dict):
            continue
        part_of_speech = SENSA_POS_BY_WIKTIONARY_POS.get(str(document.get("pos") or ""))
        if part_of_speech is None or not isinstance(document.get("forms"), list):
            continue
        found.add(part_of_speech)
        target = values.setdefault(part_of_speech, [])
        for item in document["forms"]:
            if not isinstance(item, dict):
                continue
            tags = {
                str(tag).strip().casefold()
                for tag in item.get("tags", [])
                if str(tag).strip()
            }
            if tags.intersection(EXCLUDED_FORM_TAGS):
                continue
            target.append(item.get("form"))
    return {
        part_of_speech: _unique_forms(lemma, values.get(part_of_speech, []))
        for part_of_speech in found
    }


def verified_lexeme_forms(
    conn: sqlite3.Connection,
    lemma: str,
    *,
    part_of_speech: str | None = None,
) -> list[str]:
    """Return a stable, independently sourced form inventory.

    An unavailable or malformed source intentionally yields ``[lemma]``.  It
    is safer to produce fewer examples and ask for repair than to accept an
    inflection invented by the example generator.
    """

    try:
        rows = conn.execute(
            "SELECT form FROM lexeme_forms WHERE lemma = ? AND part_of_speech = ? ORDER BY lower(form), form",
            (lemma, part_of_speech or ""),
        ).fetchall()
    except sqlite3.Error:
        rows = []
    if rows:
        return _unique_forms(lemma, [row[0] for row in rows])

    return [lemma]


def verified_release_lexeme_forms(
    conn: sqlite3.Connection,
    lemma: str,
) -> list[str]:
    """Return one stable Lexeme snapshot across all authored Sense POS values.

    Generation uses the narrower target-Sense POS inventory. A release Lexeme
    is shared by every sibling Sense, so its snapshot is the union of the POS
    values actually present in the authoring inventory—not every homographic
    Wiktionary entry.
    """

    try:
        parts_of_speech = [
            str(row[0])
            for row in conn.execute(
                "SELECT DISTINCT pos FROM senses WHERE lemma = ? ORDER BY pos",
                (lemma,),
            )
            if row[0]
        ]
    except sqlite3.Error:
        parts_of_speech = []
    values: list[str] = []
    for part_of_speech in parts_of_speech:
        values.extend(
            verified_lexeme_forms(
                conn,
                lemma,
                part_of_speech=part_of_speech,
            )
        )
    return _unique_forms(lemma, values)
