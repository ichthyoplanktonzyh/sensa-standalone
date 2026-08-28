#!/usr/bin/env python3
"""Sensa Stage 1: 整词 Sense Inventory 高并发批量生产工具。

按词频表批量运行 Wiktionary 证据抓取 + LLM Inventory 规划 + Schema 校验 + 自动 Approve。

用法:
    .venv/bin/python3 tools/batch_inventory.py --top 10 --allow-external              # 测试前 10 词
    .venv/bin/python3 tools/batch_inventory.py --top 2000 --allow-external            # 生产 Top 2000 词
    .venv/bin/python3 tools/batch_inventory.py --words run break set --allow-external # 生产指定单词
    .venv/bin/python3 tools/batch_inventory.py --status              # 查看当前库存统计
"""

from __future__ import annotations

import argparse
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# 保证环境变量加载
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

env_file = ROOT / ".env"
if env_file.exists():
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("export "):
            line = line[7:]
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            # setdefault 而非直接赋值: 真实环境变量优先于 .env 文件。
            # 否则命令行前置的 SENSA_ACQUISITION_LLM_MODEL=xxx 会被 .env 静默覆盖 ——
            # 多个会话共用一份 .env 时，这会让每一方都以为自己在用指定的模型。
            os.environ.setdefault(k.strip(), v.strip())

import dictionary
import docio
import inventory
import inventory_db
import llm

WORDLIST = ROOT / "data" / "wordlists" / "oxford-2000.tsv"
def load_top_words(limit: int = 2000, wordlist_path: Path | None = None) -> list[str]:
    """从高频权威词元表 (如 Oxford 2000/5000) 中加载 Top N 单词。"""
    target_path = wordlist_path or WORDLIST
    words = []
    if not target_path.exists():
        sys.exit(f"未找到词频表: {target_path}")
    for line in target_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) >= 2 and parts[0].isdigit():
            word = parts[1].strip().lower()
            if inventory.WORD_PATTERN.match(word):
                words.append(word)
        if len(words) >= limit:
            break
    return words


def get_existing_inventories() -> set[str]:
    """获取 SQLite 中所有已完成 approve 的 inventory 单词。"""
    return set(inventory_db.list_words(status="approved"))


def process_single_word(word: str, retries: int = 3, force: bool = False) -> tuple[bool, str, int]:
    """处理单个单词的 Stage 1 完整流程 (抓取 -> LLM规划 -> 校验 -> approve)。
    
    返回: (是否成功, 消息, 生成的 sense 数量)
    """
    if not force:
        try:
            doc = inventory.load_approved_inventory(word)
            return True, "已存在 (跳过)", len(doc.get("senses") or [])
        except Exception:
            pass  # 如果未完成或损坏则进入生成

    last_err = ""
    for attempt in range(1, retries + 1):
        try:
            # 1. 抓取词典证据
            try:
                entries = dictionary.get_filtered_entries(word)
            except Exception as exc:
                return False, f"获取词典证据失败: {exc}", 0
            if not entries:
                return False, "无可用词典证据", 0
            evidence_digest = inventory.compute_evidence_digest(entries)

            # 2. 构造 Prompt
            prompt = inventory._build_prompt(word, entries, evidence_digest)

            # 3. LLM 规划 (JSON 提取)
            raw = llm.generate(prompt)
            doc = docio.extract_json_doc(raw)

            # 4. 强制打上机器字段
            inventory._apply_machine_fields(doc, word, entries)

            # 5. Schema 与关系校验
            errors = inventory._all_errors(doc, entries, word)
            if errors:
                raise ValueError(f"校验失败 ({len(errors)} 处): {errors[0]}")

            # 6. 构造 Evidence Snapshot 并校验
            evidence_doc = inventory._build_evidence_doc(word, entries)
            evidence_errors = docio.schema_check(
                evidence_doc, docio.load_schema(inventory.EVIDENCE_SCHEMA_NAME),
                f"sqlite:dictionary_evidence/{word}",
            )
            if evidence_errors:
                raise ValueError(f"Evidence 校验失败: {evidence_errors[0]}")

            # 7. 标记为 approved
            doc["status"] = "approved"

            # 8. SQLite 是唯一权威存储；批处理不生成 YAML 镜像。
            inventory_db.save_inventory_and_evidence(doc, evidence_doc)

            senses_count = len(doc.get("senses") or [])
            return True, f"成功 ({senses_count} senses)", senses_count

        except Exception as e:
            last_err = str(e)
            time.sleep(1.0 * attempt)

    return False, f"重试 {retries} 次失败: {last_err}", 0


def cmd_status() -> None:
    """输出当前库存状态 (优先通过 SQLite 毫秒级汇总)。"""
    if inventory_db.DEFAULT_DB_PATH.exists():
        stats = inventory_db.get_db_stats()
        if stats["total_words"] > 0:
            print("\n================ Stage 1 库存统计 (SQLite DB) ================")
            print(f"已生成 Approved 单词量: {stats['total_words']}")
            print(f"已生成 Approved 义项总量: {stats['total_senses']}")
            print(f"已归档 Evidence 快照: {stats['total_evidence']}")
            print("词性分布:")
            for pos, count in stats["pos_distribution"].items():
                print(f"  - {pos:<12}: {count}")
            print("教学优先级分布:")
            for pr, count in stats["priority_distribution"].items():
                print(f"  - {pr:<12}: {count}")
            print(f"数据库文件: {inventory_db.DEFAULT_DB_PATH} ({inventory_db.DEFAULT_DB_PATH.stat().st_size / 1024 / 1024:.2f} MB)")
            print("============================================================\n")
            return

    existing = get_existing_inventories()
    total_senses = 0
    pos_counter = {}
    for word in existing:
        try:
            doc = inventory.load_approved_inventory(word)
            for s in doc.get("senses") or []:
                total_senses += 1
                pos = s.get("pos", "other")
                pos_counter[pos] = pos_counter.get(pos, 0) + 1
        except Exception:
            pass

    print("\n================ Stage 1 库存统计 ================")
    print(f"已生成 Approved 单词量: {len(existing)}")
    print(f"已生成 Approved 义项总量: {total_senses}")
    print("词性分布:")
    for pos, count in sorted(pos_counter.items(), key=lambda x: -x[1]):
        print(f"  - {pos:<12}: {count}")
    print("===================================================\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Sensa Stage 1: 整词 Sense Inventory 批量并发生成")
    parser.add_argument("--wordlist", type=str, default=None, help="自定义词表路径 (默认: data/wordlists/oxford-2000.tsv)")
    parser.add_argument("--top", type=int, default=None, help="从高频词表提取前 N 个单词")
    parser.add_argument("--words", nargs="+", help="指定生产的具体单词列表")
    parser.add_argument("--concurrency", type=int, default=8, help="并发线程数 (默认: 8)")
    parser.add_argument("--retries", type=int, default=3, help="单词失败重试次数 (默认: 3)")
    parser.add_argument("--force", action="store_true", help="强制重新生成已有单词")
    parser.add_argument("--status", action="store_true", help="查看当前生产统计")
    parser.add_argument(
        "--allow-external",
        action="store_true",
        help="显式允许调用 Acquisition LLM（可能产生费用）",
    )

    args = parser.parse_args()

    if args.status:
        cmd_status()
        return

    wordlist_path = Path(args.wordlist) if args.wordlist else None
    if args.words:
        target_words = [w.strip().lower() for w in args.words if inventory.WORD_PATTERN.match(w.strip().lower())]
    elif args.top:
        target_words = load_top_words(args.top, wordlist_path)
    else:
        target_words = load_top_words(2000, wordlist_path)

    existing = get_existing_inventories()
    if not args.force:
        pending_words = [w for w in target_words if w not in existing]
    else:
        pending_words = target_words

    print(f"\n🚀 开始执行 Stage 1 (Sense Inventory 批量生产)")
    print(f"• 目标词量: {len(target_words)} (其中待生产: {len(pending_words)}, 已存在跳过: {len(target_words) - len(pending_words)})")
    print(f"• 并发线程: {args.concurrency}")
    print(f"• 生产模型: {os.environ.get('SENSA_ACQUISITION_LLM_MODEL', 'unknown')}\n")

    if not pending_words:
        print("✓ 所有目标单词均已存在，无需生产！")
        cmd_status()
        return

    if not args.allow_external:
        parser.error(
            "inventory generation requires --allow-external because it invokes the "
            "configured Acquisition LLM"
        )

    lock = threading.Lock()
    success_count = 0
    failed_count = 0
    total_new_senses = 0
    start_time = time.time()

    def worker(word: str, idx: int, total: int):
        nonlocal success_count, failed_count, total_new_senses
        ok, msg, count = process_single_word(word, retries=args.retries, force=args.force)
        with lock:
            if ok:
                success_count += 1
                total_new_senses += count
                print(f"[{success_count + failed_count}/{total}] ✓ {word:<16} → {msg}", flush=True)
            else:
                failed_count += 1
                print(f"[{success_count + failed_count}/{total}] ✗ {word:<16} → {msg}", file=sys.stderr, flush=True)

    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        futures = [pool.submit(worker, word, idx, len(pending_words)) for idx, word in enumerate(pending_words, 1)]
        for f in as_completed(futures):
            f.result()

    elapsed = time.time() - start_time
    print(f"\n🏁 Stage 1 批处理完成！耗时: {elapsed:.1f}s", flush=True)
    print(f"• 成功: {success_count} 词 (新增 {total_new_senses} 个可教学义项)", flush=True)
    print(f"• 失败: {failed_count} 词", flush=True)

    cmd_status()


if __name__ == "__main__":
    main()
