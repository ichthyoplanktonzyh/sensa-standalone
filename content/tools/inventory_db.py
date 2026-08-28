#!/usr/bin/env python3
"""Sensa Sense Inventory SQLite 数据库模块。

提供 Stage 1 词义库存 (Sense Inventory) 与词典证据 (Dictionary Evidence) 的
统一存储、关系检索、事务写入与导出功能。

默认数据库文件: data/senses.db
"""

from __future__ import annotations

import gzip
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Generator, Iterable

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB_PATH = ROOT / "data" / "senses.db"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@contextmanager
def get_db_connection(db_path: Path | str = DEFAULT_DB_PATH) -> Generator[sqlite3.Connection, None, None]:
    """获取 SQLite 数据库连接上下文管理器，自动开启外键支持与行字典映射。"""
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = NORMAL;")
    try:
        yield conn
    finally:
        conn.close()


def init_db(db_path: Path | str = DEFAULT_DB_PATH) -> None:
    """幂等初始化所有数据表与索引。"""
    with get_db_connection(db_path) as conn:
        with conn:
            conn.executescript("""
            CREATE TABLE IF NOT EXISTS inventories (
                word                TEXT PRIMARY KEY,
                language            TEXT NOT NULL DEFAULT 'en',
                status              TEXT NOT NULL DEFAULT 'approved',
                inventory_version   INTEGER NOT NULL DEFAULT 1,
                provider            TEXT,
                entry_count         INTEGER NOT NULL DEFAULT 0,
                evidence_digest     TEXT,
                senses_count        INTEGER NOT NULL DEFAULT 0,
                deferred_count      INTEGER NOT NULL DEFAULT 0,
                relations_count     INTEGER NOT NULL DEFAULT 0,
                raw_json            TEXT NOT NULL,
                created_at          TEXT NOT NULL,
                updated_at          TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS senses (
                sense_id            TEXT PRIMARY KEY,
                word                TEXT NOT NULL REFERENCES inventories(word) ON DELETE CASCADE,
                sense_num           INTEGER NOT NULL,
                lemma               TEXT NOT NULL,
                pos                 TEXT NOT NULL,
                label_zh            TEXT NOT NULL,
                definition          TEXT NOT NULL,
                semantic_type       TEXT,
                dimension           TEXT,
                change_of_state     INTEGER NOT NULL DEFAULT 0,
                causative           INTEGER NOT NULL DEFAULT 0,
                valency             TEXT,
                decision_type       TEXT,
                decision_reason     TEXT,
                teaching_priority   TEXT NOT NULL,
                currency            TEXT,
                productivity        TEXT,
                register            TEXT,
                source_entries      TEXT NOT NULL,
                raw_json            TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS dictionary_evidence (
                word                TEXT PRIMARY KEY,
                language            TEXT NOT NULL DEFAULT 'en',
                provider            TEXT NOT NULL DEFAULT 'wiktionary',
                captured_at         TEXT NOT NULL,
                evidence_digest     TEXT NOT NULL,
                entry_count         INTEGER NOT NULL DEFAULT 0,
                raw_json            TEXT NOT NULL,
                updated_at          TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS dictionary_entries (
                entry_id            TEXT PRIMARY KEY,
                word                TEXT NOT NULL REFERENCES dictionary_evidence(word) ON DELETE CASCADE,
                entry_order         INTEGER NOT NULL,
                pos                 TEXT NOT NULL,
                gloss               TEXT NOT NULL,
                labels              TEXT NOT NULL,
                examples            TEXT NOT NULL,
                raw_json            TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS deferred_entries (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                word                TEXT NOT NULL REFERENCES inventories(word) ON DELETE CASCADE,
                source_entry        TEXT NOT NULL,
                decision            TEXT NOT NULL,
                reason              TEXT NOT NULL,
                required_evidence   TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS relations (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                word                TEXT NOT NULL REFERENCES inventories(word) ON DELETE CASCADE,
                source_sense_id     TEXT NOT NULL,
                target_sense_id     TEXT NOT NULL,
                relation            TEXT NOT NULL,
                distinction         TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS inventory_drafts (
                word                TEXT PRIMARY KEY,
                status              TEXT NOT NULL CHECK (status IN ('draft', 'reviewed')),
                inventory_json      TEXT NOT NULL,
                evidence_json       TEXT NOT NULL,
                raw_output          TEXT,
                created_at          TEXT NOT NULL,
                updated_at          TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS inventory_generation_failures (
                failure_id          INTEGER PRIMARY KEY AUTOINCREMENT,
                word                TEXT NOT NULL,
                raw_output          TEXT NOT NULL,
                error               TEXT NOT NULL,
                created_at          TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS dictionary_snapshots (
                word                TEXT PRIMARY KEY,
                source_url          TEXT NOT NULL,
                license_note        TEXT NOT NULL,
                content_sha256      TEXT NOT NULL,
                raw_jsonl_gzip      BLOB NOT NULL,
                captured_at         TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS lexeme_forms (
                lemma               TEXT NOT NULL,
                part_of_speech      TEXT NOT NULL,
                form                TEXT NOT NULL,
                source              TEXT NOT NULL,
                source_digest       TEXT NOT NULL,
                PRIMARY KEY (lemma, part_of_speech, form)
            );
            CREATE INDEX IF NOT EXISTS idx_lexeme_forms_lemma
                ON lexeme_forms(lemma, part_of_speech);

            -- Indexes
            CREATE INDEX IF NOT EXISTS idx_senses_word ON senses(word);
            CREATE INDEX IF NOT EXISTS idx_senses_pos ON senses(pos);
            CREATE INDEX IF NOT EXISTS idx_senses_priority ON senses(teaching_priority);
            CREATE INDEX IF NOT EXISTS idx_senses_semantic_type ON senses(semantic_type);
            CREATE INDEX IF NOT EXISTS idx_dict_entries_word ON dictionary_entries(word);
            CREATE INDEX IF NOT EXISTS idx_relations_word ON relations(word);
            CREATE INDEX IF NOT EXISTS idx_deferred_word ON deferred_entries(word);
            """)


def save_inventory_draft(
    inventory_doc: dict,
    evidence_doc: dict,
    *,
    raw_output: str | None = None,
    db_path: Path | str = DEFAULT_DB_PATH,
) -> None:
    """Atomically store the one mutable draft and its frozen evidence snapshot."""

    init_db(db_path)
    word = str(inventory_doc["word"]).strip().lower()
    status = inventory_doc.get("status")
    if status not in {"draft", "reviewed"}:
        raise ValueError("Inventory draft status must be draft or reviewed")
    now = _utc_now_iso()
    with get_db_connection(db_path) as connection:
        with connection:
            connection.execute(
                """
                INSERT INTO inventory_drafts (
                    word, status, inventory_json, evidence_json,
                    raw_output, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(word) DO UPDATE SET
                    status = excluded.status,
                    inventory_json = excluded.inventory_json,
                    evidence_json = excluded.evidence_json,
                    raw_output = excluded.raw_output,
                    updated_at = excluded.updated_at
                """,
                (
                    word,
                    status,
                    json.dumps(inventory_doc, ensure_ascii=False),
                    json.dumps(evidence_doc, ensure_ascii=False),
                    raw_output,
                    now,
                    now,
                ),
            )


def get_inventory_draft(
    word: str,
    db_path: Path | str = DEFAULT_DB_PATH,
) -> tuple[dict, dict, str | None] | None:
    """Load draft inventory, frozen evidence and optional raw model output."""

    init_db(db_path)
    with get_db_connection(db_path) as connection:
        row = connection.execute(
            "SELECT inventory_json, evidence_json, raw_output FROM inventory_drafts WHERE word = ?",
            (word.strip().lower(),),
        ).fetchone()
    if row is None:
        return None
    return (
        json.loads(row["inventory_json"]),
        json.loads(row["evidence_json"]),
        row["raw_output"],
    )


def set_inventory_draft_status(
    word: str,
    status: str,
    db_path: Path | str = DEFAULT_DB_PATH,
) -> None:
    if status not in {"draft", "reviewed"}:
        raise ValueError("Inventory draft status must be draft or reviewed")
    draft = get_inventory_draft(word, db_path=db_path)
    if draft is None:
        raise KeyError(word)
    inventory_doc, evidence_doc, raw_output = draft
    inventory_doc["status"] = status
    save_inventory_draft(
        inventory_doc,
        evidence_doc,
        raw_output=raw_output,
        db_path=db_path,
    )


def record_inventory_failure(
    word: str,
    raw_output: str,
    error: str,
    db_path: Path | str = DEFAULT_DB_PATH,
) -> None:
    init_db(db_path)
    with get_db_connection(db_path) as connection:
        with connection:
            connection.execute(
                "INSERT INTO inventory_generation_failures (word, raw_output, error, created_at) VALUES (?, ?, ?, ?)",
                (word.strip().lower(), raw_output, error, _utc_now_iso()),
            )


def save_inventory_and_evidence(
    doc: dict,
    evidence_doc: dict | None = None,
    db_path: Path | str = DEFAULT_DB_PATH,
) -> None:
    """原子事务写入整词 inventory 及其 dictionary evidence。"""
    init_db(db_path)
    word = doc["word"].strip().lower()
    now_iso = _utc_now_iso()

    senses = doc.get("senses") or []
    deferred = doc.get("deferred_entries") or []
    relations = doc.get("relations") or []
    source = doc.get("source") or {}

    with get_db_connection(db_path) as conn:
        with conn:
            # 1. 保存/更新 dictionary_evidence (如果有)
            if evidence_doc:
                evi_word = evidence_doc["word"].strip().lower()
                evi_entries = evidence_doc.get("entries") or []
                evidence_digest = source.get("evidence_digest") or evidence_doc.get("evidence_digest", "")

                # 插入/更新 evidence 主表
                conn.execute(
                    """
                    INSERT INTO dictionary_evidence (
                        word, language, provider, captured_at, evidence_digest,
                        entry_count, raw_json, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(word) DO UPDATE SET
                        language = excluded.language,
                        provider = excluded.provider,
                        captured_at = excluded.captured_at,
                        evidence_digest = excluded.evidence_digest,
                        entry_count = excluded.entry_count,
                        raw_json = excluded.raw_json,
                        updated_at = excluded.updated_at
                    """,
                    (
                        evi_word,
                        evidence_doc.get("language", "en"),
                        evidence_doc.get("provider", "wiktionary"),
                        evidence_doc.get("captured_at", now_iso),
                        evidence_digest,
                        len(evi_entries),
                        json.dumps(evidence_doc, ensure_ascii=False),
                        now_iso,
                    ),
                )

                # 清理并重写 dictionary_entries
                conn.execute("DELETE FROM dictionary_entries WHERE word = ?", (evi_word,))
                for order, entry in enumerate(evi_entries, 1):
                    conn.execute(
                        """
                        INSERT INTO dictionary_entries (
                            entry_id, word, entry_order, pos, gloss, labels, examples, raw_json
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            entry["entry_id"],
                            evi_word,
                            order,
                            entry.get("pos", ""),
                            entry.get("gloss", ""),
                            json.dumps(entry.get("labels") or [], ensure_ascii=False),
                            json.dumps(entry.get("examples") or [], ensure_ascii=False),
                            json.dumps(entry, ensure_ascii=False),
                        ),
                    )

            # 2. 插入/更新 inventories 主表
            conn.execute(
                """
                INSERT INTO inventories (
                    word, language, status, inventory_version, provider, entry_count,
                    evidence_digest, senses_count, deferred_count, relations_count,
                    raw_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(word) DO UPDATE SET
                    language = excluded.language,
                    status = excluded.status,
                    inventory_version = excluded.inventory_version,
                    provider = excluded.provider,
                    entry_count = excluded.entry_count,
                    evidence_digest = excluded.evidence_digest,
                    senses_count = excluded.senses_count,
                    deferred_count = excluded.deferred_count,
                    relations_count = excluded.relations_count,
                    raw_json = excluded.raw_json,
                    updated_at = excluded.updated_at
                """,
                (
                    word,
                    doc.get("language", "en"),
                    doc.get("status", "approved"),
                    doc.get("inventory_version", 1),
                    source.get("provider", "wiktionary"),
                    source.get("entry_count", 0),
                    source.get("evidence_digest", ""),
                    len(senses),
                    len(deferred),
                    len(relations),
                    json.dumps(doc, ensure_ascii=False),
                    now_iso,
                    now_iso,
                ),
            )

            # 3. 清理旧 senses, deferred_entries, relations
            conn.execute("DELETE FROM senses WHERE word = ?", (word,))
            conn.execute("DELETE FROM deferred_entries WHERE word = ?", (word,))
            conn.execute("DELETE FROM relations WHERE word = ?", (word,))

            # 4. 插入 senses
            for order, s in enumerate(senses, 1):
                sig = s.get("semantic_signature") or {}
                dec = s.get("decision") or {}
                usage = s.get("usage") or {}
                conn.execute(
                    """
                    INSERT INTO senses (
                        sense_id, word, sense_num, lemma, pos, label_zh, definition,
                        semantic_type, dimension, change_of_state, causative, valency,
                        decision_type, decision_reason, teaching_priority,
                        currency, productivity, register, source_entries, raw_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        s["id"],
                        word,
                        order,
                        s.get("lemma", word),
                        s.get("pos", ""),
                        s.get("label_zh", ""),
                        s.get("definition", ""),
                        sig.get("semantic_type"),
                        sig.get("dimension"),
                        1 if sig.get("change_of_state") else 0,
                        1 if sig.get("causative") else 0,
                        sig.get("valency"),
                        dec.get("type"),
                        dec.get("reason"),
                        s.get("teaching_priority", "core"),
                        usage.get("currency"),
                        usage.get("productivity"),
                        usage.get("register"),
                        json.dumps(s.get("source_entries") or [], ensure_ascii=False),
                        json.dumps(s, ensure_ascii=False),
                    ),
                )

            # 5. 插入 deferred_entries
            for d in deferred:
                conn.execute(
                    """
                    INSERT INTO deferred_entries (
                        word, source_entry, decision, reason, required_evidence
                    ) VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        word,
                        d.get("source_entry", ""),
                        d.get("decision", "defer"),
                        d.get("reason", ""),
                        json.dumps(d.get("required_evidence") or [], ensure_ascii=False),
                    ),
                )

            # 6. 插入 relations
            for r in relations:
                conn.execute(
                    """
                    INSERT INTO relations (
                        word, source_sense_id, target_sense_id, relation, distinction
                    ) VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        word,
                        r.get("source", ""),
                        r.get("target", ""),
                        r.get("relation", ""),
                        r.get("distinction", ""),
                    ),
                )

            # 7. Materialize independently sourced forms for the approved
            # inventory. The compressed snapshot remains in SQLite; no loose
            # JSONL compatibility source is consulted by package production.
            if doc.get("status", "approved") == "approved":
                from lexeme_forms import verified_forms_from_jsonl

                conn.execute("DELETE FROM lexeme_forms WHERE lemma = ?", (word,))
                snapshot = conn.execute(
                    "SELECT raw_jsonl_gzip, content_sha256 FROM dictionary_snapshots WHERE word = ?",
                    (word,),
                ).fetchone()
                if snapshot is not None:
                    raw_text = gzip.decompress(bytes(snapshot["raw_jsonl_gzip"])).decode("utf-8")
                    forms_by_pos = verified_forms_from_jsonl(raw_text, word)
                    authored_pos = {str(s.get("pos") or "") for s in senses}
                    for part_of_speech in sorted(authored_pos):
                        for form in forms_by_pos.get(part_of_speech, [word]):
                            conn.execute(
                                """
                                INSERT OR IGNORE INTO lexeme_forms (
                                    lemma, part_of_speech, form, source, source_digest
                                ) VALUES (?, ?, ?, 'wiktionary_snapshot', ?)
                                """,
                                (word, part_of_speech, form, snapshot["content_sha256"]),
                            )


def get_inventory(word: str, db_path: Path | str = DEFAULT_DB_PATH) -> dict | None:
    """从数据库加载指定单词的完整 Inventory 字典。"""
    word = word.strip().lower()
    path = Path(db_path)
    if not path.exists():
        return None

    with get_db_connection(db_path) as conn:
        row = conn.execute(
            "SELECT raw_json FROM inventories WHERE word = ?",
            (word,),
        ).fetchone()
        if row:
            return json.loads(row["raw_json"])
    return None


def get_evidence_doc(word: str, db_path: Path | str = DEFAULT_DB_PATH) -> dict | None:
    """从数据库加载指定单词的完整 Dictionary Evidence 字典。"""
    word = word.strip().lower()
    path = Path(db_path)
    if not path.exists():
        return None

    with get_db_connection(db_path) as conn:
        row = conn.execute(
            "SELECT raw_json FROM dictionary_evidence WHERE word = ?",
            (word,),
        ).fetchone()
        if row:
            return json.loads(row["raw_json"])
    return None


def get_evidence_entries(word: str, db_path: Path | str = DEFAULT_DB_PATH) -> list[dict] | None:
    """从数据库获取指定单词的证据条目列表。"""
    evi = get_evidence_doc(word, db_path=db_path)
    if evi and isinstance(evi.get("entries"), list):
        return evi["entries"]
    return None


def get_sense(sense_id: str, db_path: Path | str = DEFAULT_DB_PATH) -> dict | None:
    """根据 sense_id (如 act-01) 快速查询单个义项信息。"""
    path = Path(db_path)
    if not path.exists():
        return None

    with get_db_connection(db_path) as conn:
        row = conn.execute(
            "SELECT raw_json FROM senses WHERE sense_id = ?",
            (sense_id,),
        ).fetchone()
        if row:
            return json.loads(row["raw_json"])
    return None


def list_words(status: str | None = "approved", db_path: Path | str = DEFAULT_DB_PATH) -> list[str]:
    """获取数据库中所有单词列表。"""
    path = Path(db_path)
    if not path.exists():
        return []

    with get_db_connection(db_path) as conn:
        if status:
            rows = conn.execute(
                "SELECT word FROM inventories WHERE status = ? ORDER BY word ASC",
                (status,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT word FROM inventories ORDER BY word ASC",
            ).fetchall()
        return [r["word"] for r in rows]


def query_senses(
    pos: str | None = None,
    teaching_priority: str | None = None,
    semantic_type: str | None = None,
    decision_type: str | None = None,
    keyword: str | None = None,
    limit: int | None = None,
    db_path: Path | str = DEFAULT_DB_PATH,
) -> list[dict]:
    """多维度结构化义项检索。"""
    path = Path(db_path)
    if not path.exists():
        return []

    clauses = []
    params: list[Any] = []

    if pos:
        clauses.append("pos = ?")
        params.append(pos)
    if teaching_priority:
        clauses.append("teaching_priority = ?")
        params.append(teaching_priority)
    if semantic_type:
        clauses.append("semantic_type = ?")
        params.append(semantic_type)
    if decision_type:
        clauses.append("decision_type = ?")
        params.append(decision_type)
    if keyword:
        clauses.append("(word LIKE ? OR label_zh LIKE ? OR definition LIKE ?)")
        kw_like = f"%{keyword}%"
        params.extend([kw_like, kw_like, kw_like])

    where_sql = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    limit_sql = f"LIMIT {limit}" if limit and limit > 0 else ""

    sql = f"""
    SELECT raw_json FROM senses
    {where_sql}
    ORDER BY word ASC, sense_num ASC
    {limit_sql}
    """

    with get_db_connection(db_path) as conn:
        rows = conn.execute(sql, params).fetchall()
        return [json.loads(r["raw_json"]) for r in rows]


def get_db_stats(db_path: Path | str = DEFAULT_DB_PATH) -> dict:
    """获取数据库全局统计指标。"""
    path = Path(db_path)
    if not path.exists():
        return {
            "total_words": 0,
            "total_senses": 0,
            "total_evidence": 0,
            "pos_distribution": {},
            "priority_distribution": {},
            "decision_distribution": {},
        }

    with get_db_connection(db_path) as conn:
        total_words = conn.execute("SELECT COUNT(*) FROM inventories").fetchone()[0]
        total_senses = conn.execute("SELECT COUNT(*) FROM senses").fetchone()[0]
        total_evidence = conn.execute("SELECT COUNT(*) FROM dictionary_evidence").fetchone()[0]

        pos_rows = conn.execute(
            "SELECT pos, COUNT(*) as cnt FROM senses GROUP BY pos ORDER BY cnt DESC"
        ).fetchall()
        pos_dist = {r["pos"]: r["cnt"] for r in pos_rows}

        pr_rows = conn.execute(
            "SELECT teaching_priority, COUNT(*) as cnt FROM senses GROUP BY teaching_priority ORDER BY cnt DESC"
        ).fetchall()
        pr_dist = {r["teaching_priority"]: r["cnt"] for r in pr_rows}

        dec_rows = conn.execute(
            "SELECT decision_type, COUNT(*) as cnt FROM senses GROUP BY decision_type ORDER BY cnt DESC"
        ).fetchall()
        dec_dist = {r["decision_type"]: r["cnt"] for r in dec_rows}

        return {
            "total_words": total_words,
            "total_senses": total_senses,
            "total_evidence": total_evidence,
            "pos_distribution": pos_dist,
            "priority_distribution": pr_dist,
            "decision_distribution": dec_dist,
        }
