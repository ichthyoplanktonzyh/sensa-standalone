#!/usr/bin/env python3
"""Optional operator seam for importing an external authoring snapshot.

Standalone production normally reads content/data in this repository.
During a temporary handoff an operator may point this command at an explicit
external release root. It never discovers or assumes a legacy repository,
defaults to a dry run, and only writes after the --apply option.
"""

from __future__ import annotations

import argparse
import shutil
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TARGET_DATA = ROOT / "data"
COPY_DIRS = ("media", "wordlists")
COPY_FILES = ("senses.db",)
EXCLUDED_NAMES = {".DS_Store", "MANIFEST.sha256"}
EXCLUDED_SUFFIXES = (".log", ".lock", ".wal", ".shm", "-wal", "-shm")


def _data_root(path: Path) -> Path:
    candidate = path / "content" / "data"
    return candidate if candidate.is_dir() else path


def _is_production_file(path: Path) -> bool:
    return (
        path.is_file()
        and path.name not in EXCLUDED_NAMES
        and not path.name.endswith(EXCLUDED_SUFFIXES)
    )


def _count_rows(path: Path) -> tuple[int, int]:
    if not path.exists():
        return 0, 0
    with sqlite3.connect(f"file:{path.resolve()}?mode=ro", uri=True) as conn:
        return (
            int(conn.execute("select count(*) from inventories").fetchone()[0]),
            int(conn.execute("select count(*) from senses").fetchone()[0]),
        )


def _iter_source_files(source_data: Path) -> list[tuple[Path, Path]]:
    files: list[tuple[Path, Path]] = []
    for directory in COPY_DIRS:
        root = source_data / directory
        if not root.is_dir():
            continue
        for path in sorted(root.rglob("*")):
            if _is_production_file(path):
                files.append((path, path.relative_to(source_data)))
    for name in COPY_FILES:
        path = source_data / name
        if _is_production_file(path):
            files.append((path, Path(name)))
    return files


def main() -> int:
    parser = argparse.ArgumentParser(description="Import an explicitly supplied Sensa content snapshot")
    parser.add_argument(
        "--source-root",
        type=Path,
        required=True,
        help="External content/data root, or a repository root containing content/data",
    )
    parser.add_argument("--target-data", type=Path, default=DEFAULT_TARGET_DATA)
    parser.add_argument("--dry-run", action="store_true", help="Report the snapshot without writing (default)")
    parser.add_argument("--apply", action="store_true", help="Copy the listed production files into target-data")
    args = parser.parse_args()
    if args.dry_run and args.apply:
        parser.error("--dry-run and --apply are mutually exclusive")

    source_data = _data_root(args.source_root.expanduser().resolve())
    target_data = args.target_data.expanduser().resolve()
    if not source_data.is_dir():
        parser.error(f"source content/data does not exist: {source_data}")

    files = _iter_source_files(source_data)
    source_db = source_data / "senses.db"
    print(f"source_data={source_data}")
    print(f"target_data={target_data}")
    print(f"files={len(files)}")
    if source_db.exists():
        words, senses = _count_rows(source_db)
        print(f"inventory_snapshot={words} words/{senses} senses")
    if not args.apply:
        print("dry-run: no files written (pass --apply to perform this explicit handoff)")
        return 0

    for source, relative in files:
        destination = target_data / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
    print(f"copied={len(files)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
