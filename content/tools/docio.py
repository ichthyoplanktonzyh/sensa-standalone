#!/usr/bin/env python3
"""文档 IO 与 schema 校验的共享工具。

从旧 Sensa 的 tools/draft.py 抽出：义项管线只需要这几个纯函数，
不需要 draft.py 里已废弃的场景/渲染起草逻辑。
"""

import json
import re
from pathlib import Path

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parent.parent
SCHEMA_DIR = ROOT / "schema"


def read(path):
    return Path(path).read_text(encoding="utf-8")


def load_schema(name):
    return Draft202012Validator(json.loads(read(SCHEMA_DIR / name)))


def schema_check(doc, validator, label):
    errs = []
    for err in validator.iter_errors(doc):
        loc = "/".join(str(p) for p in err.absolute_path) or "(root)"
        errs.append(f"  ✗ {label} [{loc}] {err.message}")
    return errs


def extract_json_doc(text: str) -> dict:
    """从模型输出中抽取并解析结构化 JSON 字典。

    支持自动过滤 <think>...</think> 思维链并提取 ```json ... ```。
    """
    if not text or not isinstance(text, str):
        raise ValueError("模型返回了空响应")

    cleaned = re.sub(r"<(?:think|thought)>.*?</(?:think|thought)>", "", text, flags=re.DOTALL).strip()
    if not cleaned:
        cleaned = text.strip()

    fenced_blocks = re.findall(r"```(?:json|ya?ml)?\s*\n(.*?)```", cleaned, flags=re.DOTALL)
    candidate_texts = [b.strip() for b in fenced_blocks if b.strip()]
    candidate_texts.append(cleaned)

    for cand in candidate_texts:
        try:
            doc = json.loads(cand)
            if isinstance(doc, dict):
                return doc
        except (json.JSONDecodeError, ValueError):
            pass

        first_brace = cand.find("{")
        last_brace = cand.rfind("}")
        if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
            try:
                doc = json.loads(cand[first_brace : last_brace + 1])
                if isinstance(doc, dict):
                    return doc
            except (json.JSONDecodeError, ValueError):
                pass

    raise ValueError("无法从模型输出中解析出有效的 JSON 字典对象")
