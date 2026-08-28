#!/usr/bin/env python3
"""Wiktionary 词典事实源适配器。

角色定位 (与 AGENT.md 一致):
- 词典事实是起草与审核的**事实锚点** (word / pos / IPA / 义项清单),
  不是内容来源——Sensa 的语义骨架与释义必须自行撰写, 不抄词典原文。
- 数据来自 kaikki.org 对 Wiktionary 的机器解析 (CC-BY-SA), 逐词在线获取并
  以压缩快照存入 data/senses.db; 快照保留原始数据与署名信息。

用法:
    python3 tools/dictionary.py <word>            # 查看事实摘要
    python3 tools/dictionary.py <word> --refresh  # 强制重新抓取
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

import requests

import inventory_db

ROOT = Path(__file__).resolve().parent.parent
KAIKKI_URL = ("https://kaikki.org/dictionary/English/meaning/"
              "{a}/{ab}/{word}.jsonl")
LICENSE_NOTE = "Wiktionary via kaikki.org, CC-BY-SA 3.0/4.0"
TIMEOUT = 30
# 教学词库关心的词类; 其余 (缩写、专名等) 摘要时忽略
POS_KEEP = {"noun", "verb", "adj", "adjective", "adv", "adverb", "prep",
            "preposition", "conj", "conjunction", "pron", "pronoun",
            "det", "determiner", "intj", "interjection", "num", "particle",
            "name", "propn", "postp"}
# 标记了这些标签的义项不适合核心教学词汇
EXCLUDE_TAGS = {"obsolete", "archaic", "rare", "dated", "poetic", "dialectal",
                "nonstandard", "humorous", "slang"}
# 义项显示优先级（按词性）
POS_ORDER = {"verb": 0, "noun": 1, "name": 1, "propn": 1, "adj": 2, "adjective": 2,
             "adv": 3, "adverb": 3, "prep": 4, "preposition": 4, "postp": 4,
             "conj": 5, "det": 6, "pron": 7, "intj": 8, "particle": 9}
# 摘要视图（dictionary.py show）的显示上限。
#
# 注意: 这个上限只作用于人看的摘要输出, **不作用于 inventory 规划的证据输入**。
# 曾经它是 teachable_senses() 的返回截断 (senses[:8])，导致 46.6% 的词、
# 其中词频 top 500 的 59% 只拿到任意的 8 条证据 —— 而 Wiktionary 的义项排序是
# 词源/历史顺序而非频率顺序，被砍掉的未必是罕见义 (run 的 111 条证据里
# "To control or manage" 就被砍掉了)。
#
# 该截断哪些义项不值得教学，是 inventory prompt 的 merge / defer 判断，
# 不是这一层的任意截断。证据层必须给全。
SUMMARY_DISPLAY_LIMIT = 8


def _example_texts(raw_examples: Any) -> list[str]:
    """把词典用例统一成纯文本。

    kaikki 的用例是对象 ({text, type, bold_text_offsets, ref, ...}), 但下游
    (inventory 提示词、evidence snapshot、evidence digest) 消费的是句子本身。
    偏移量与 ref 是排版信息, 不是语义证据, 丢弃它们不损失词义判据。少数早期
    条目直接就是字符串, 一并接受; 没有 text 的对象没有可用证据, 直接跳过。
    """
    texts: list[str] = []
    for example in raw_examples or []:
        if isinstance(example, str):
            text = example
        elif isinstance(example, dict):
            text = example.get("text") or ""
        else:
            continue
        text = " ".join(str(text).split())
        if text:
            texts.append(text)
    return texts


def teachable_senses(word: str, refresh: bool = False) -> list[dict]:
    """返回该词**全部**经标签过滤的词典义项，按词性优先级排序。

    每条义项包含:
      - pos: 词性
      - glosses: 释义列表
      - tags: 标签列表（语法标记如 transitive，已排除 obsolete 等）
      - examples: 用例（最多2条）
      - has_raw: 是否有 raw_glosses（需要人工复核）

    不做数量截断: 哪些义项不值得成为教学义项，由 inventory 规划阶段的
    merge / defer 决定 (见 prompts/inventory-draft.md 的全覆盖约束)。
    """
    entries = fetch(word, refresh)
    senses: list[dict] = []
    seen_gloss: set[str] = set()

    sorted_entries = sorted(
        entries,
        key=lambda e: POS_ORDER.get(e.get("pos", ""), 99),
    )

    for entry in sorted_entries:
        pos = entry.get("pos", "")
        if pos not in POS_KEEP:
            continue
        for raw_sense in entry.get("senses") or []:
            tags = set(raw_sense.get("tags") or [])
            if EXCLUDE_TAGS & tags:
                continue
            glosses = raw_sense.get("glosses") or []
            if not glosses:
                continue
            key = "; ".join(glosses).strip()
            if not key or key in seen_gloss:
                continue
            seen_gloss.add(key)
            senses.append({
                "pos": pos,
                "glosses": glosses,
                "tags": sorted(tags - EXCLUDE_TAGS),
                "examples": _example_texts(raw_sense.get("examples"))[:2],
                "has_raw": "raw_glosses" in raw_sense,
            })

    return senses


def get_filtered_entries(word: str, refresh: bool = False) -> list[dict[str, Any]]:
    """结构化的、经当前标签过滤的词典证据条目，供 Sense Inventory 层消费。

    与 teachable_senses() 使用同一套过滤规则 (POS_KEEP + EXCLUDE_TAGS + 去重，
    不截断)，只是换成 inventory 层需要的字段形状，并按
    当前过滤后条目顺序生成稳定的 entry_id (不使用随机 hash，不与 Sensa
    sense ID 混用)。
    """
    word = word.strip().lower()
    senses = teachable_senses(word, refresh)
    return [
        {
            "entry_id": f"{word}-dict-{i:03d}",
            "pos": sense["pos"],
            "gloss": "; ".join(sense["glosses"]),
            "labels": sense["tags"],
            "examples": sense["examples"],
        }
        for i, sense in enumerate(senses, 1)
    ]


def sense_count(word: str) -> int:
    """该词有几个可教学义项。"""
    try:
        return len(teachable_senses(word))
    except (LookupError, requests.RequestException):
        return 1  # 拿不到数据时保守估计至少 1 个


def source_url(word: str) -> str:
    return KAIKKI_URL.format(a=word[0], ab=word[:2], word=word)


def _cached_snapshot(word: str) -> str | None:
    inventory_db.init_db()
    with inventory_db.get_db_connection() as connection:
        row = connection.execute(
            "SELECT raw_jsonl_gzip FROM dictionary_snapshots WHERE word = ?",
            (word,),
        ).fetchone()
    if row is None:
        return None
    return gzip.decompress(bytes(row["raw_jsonl_gzip"])).decode("utf-8")


def _store_snapshot(word: str, text: str) -> None:
    encoded = text.encode("utf-8")
    with inventory_db.get_db_connection() as connection:
        with connection:
            connection.execute(
                """
                INSERT INTO dictionary_snapshots (
                    word, source_url, license_note, content_sha256,
                    raw_jsonl_gzip, captured_at
                ) VALUES (?, ?, ?, ?, ?, datetime('now'))
                ON CONFLICT(word) DO UPDATE SET
                    source_url = excluded.source_url,
                    license_note = excluded.license_note,
                    content_sha256 = excluded.content_sha256,
                    raw_jsonl_gzip = excluded.raw_jsonl_gzip,
                    captured_at = excluded.captured_at
                """,
                (
                    word,
                    source_url(word),
                    LICENSE_NOTE,
                    hashlib.sha256(encoded).hexdigest(),
                    gzip.compress(encoded, compresslevel=9),
                ),
            )


def fetch(word: str, refresh: bool = False) -> list[dict[str, Any]]:
    """取一个词的全部 Wiktionary 词条 (每词性一条), 带本地缓存与大小写结合。"""
    word = word.strip().lower()
    cached = _cached_snapshot(word)
    if cached is not None and not refresh:
        text = cached
    else:
        candidates = [word]
        if word.capitalize() != word:
            candidates.append(word.capitalize())
        if word.upper() != word:
            candidates.append(word.upper())

        combined_texts: list[str] = []
        last_exc = None
        for cand in candidates:
            a = cand[0]
            ab = cand[:2]
            url = KAIKKI_URL.format(a=a, ab=ab, word=cand)
            try:
                response = requests.get(url, timeout=TIMEOUT)
                if response.status_code == 200 and response.text.strip():
                    combined_texts.append(response.text.strip())
            except requests.RequestException as exc:
                last_exc = exc
        if not combined_texts:
            if last_exc:
                raise last_exc
            raise LookupError(f"Wiktionary 无词条: {word}")
        text = "\n".join(combined_texts)
        _store_snapshot(word, text)
    entries = []
    for line in text.splitlines():
        line = line.strip()
        if line:
            item = json.loads(line)
            pos = item.get("pos", "")
            if pos in ("name", "propn"):
                item["pos"] = "noun"
            elif pos == "postp":
                item["pos"] = "prep"
            entries.append(item)
    return entries


def facts(word: str, refresh: bool = False) -> dict[str, Any]:
    """把原始词条摘要成起草需要的事实锚点。"""
    entries = fetch(word, refresh)
    ipas: list[str] = []
    pos_senses: dict[str, list[str]] = {}
    for entry in entries:
        pos = entry.get("pos", "")
        for sound in entry.get("sounds") or []:
            ipa = sound.get("ipa")
            if ipa and ipa not in ipas:
                ipas.append(ipa)
        if pos not in POS_KEEP:
            continue
        glosses = pos_senses.setdefault(pos, [])
        for sense in entry.get("senses") or []:
            gloss = "; ".join(sense.get("glosses") or [])
            tags = sense.get("tags") or []
            if not gloss or any(t in ("obsolete", "archaic") for t in tags):
                continue
            if gloss not in glosses:
                glosses.append(gloss)
    return {
        "word": word,
        "ipa": ipas[:4],
        "pos_senses": pos_senses,
        "source": source_url(word),
        "license": LICENSE_NOTE,
    }


def cached_facts(word: str) -> dict[str, Any] | None:
    """只读缓存, 不触网 (供校验器等离线消费者使用)。"""
    if _cached_snapshot(word.strip().lower()) is None:
        return None
    return facts(word)


def prompt_block(word: str, sense_num: str | None = None) -> str:
    """生成注入起草 prompt 的词典事实块; 若指定 sense_num 则只展示对应义项。"""
    try:
        senses = teachable_senses(word)[:SUMMARY_DISPLAY_LIMIT]
        f = facts(word)
    except (requests.RequestException, LookupError, json.JSONDecodeError) as exc:
        return (f"(未能获取 '{word}' 的词典事实: {exc}。"
                "请保守起草, 音标与义项划分需人工重点复核。)")
    lines = [f"word: {f['word']}"]
    if f["ipa"]:
        lines.append(f"IPA: {', '.join(f['ipa'])}")
    if sense_num:
        idx = int(sense_num) - 1
        if 0 <= idx < len(senses):
            lines.append(f"义项 {sense_num}/{len(senses)} (当前起草目标):")
            s = senses[idx]
            gloss = "; ".join(s["glosses"][:1])
            tag_str = f" [{', '.join(s['tags'])}]" if s["tags"] else ""
            lines.append(f"  [{s['pos']}{tag_str}] {gloss}")
    else:
        lines.append(f"义项清单 (共 {len(senses)} 个可教学义项):")
        for i, s in enumerate(senses, 1):
            gloss = "; ".join(s["glosses"][:1])
            tag_str = f" [{', '.join(s['tags'])}]" if s["tags"] else ""
            lines.append(f"  {i:02d}. [{s['pos']}{tag_str}] {gloss}")
    lines.append(f"来源: {f['source']} ({f['license']})")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="查询 Wiktionary 词典事实")
    parser.add_argument("word")
    parser.add_argument("--refresh", action="store_true", help="忽略缓存重新抓取")
    args = parser.parse_args()
    print(prompt_block(args.word) if not args.refresh
          else (fetch(args.word, refresh=True) and prompt_block(args.word)))


if __name__ == "__main__":
    main()
