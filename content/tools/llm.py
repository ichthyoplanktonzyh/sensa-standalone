"""Vendor-neutral text generation adapters for Sensa authoring tools.

The public contract of this module includes ``generate(prompt)``, ``invoke(prompt)``,
and ``invoke_multimodal(prompt, images)``. Provider names, credentials, and transport
stay here and must never leak into sense or scene resource schemas.

Supported wire protocols:

* ``openai-responses``: OpenAI Responses API compatible JSON
* ``openai-chat``: OpenAI Chat Completions compatible JSON
* ``anthropic``: Anthropic Messages compatible JSON
* ``command``: any local command that accepts the prompt on stdin
"""

from __future__ import annotations

import base64
import json
import os
import shlex
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import requests


class LLMConfigurationError(ValueError):
    """Raised when an adapter is not fully configured."""


class LLMResponseError(RuntimeError):
    """Raised when an endpoint returns an error or an unreadable response."""


@dataclass(frozen=True)
class LLMResult:
    text: str
    protocol: str
    model: str | None
    request_id: str | None


@dataclass(frozen=True)
class LLMConfig:
    protocol: str
    model: str | None = None
    base_url: str | None = None
    endpoint: str | None = None
    api_key: str | None = None
    api_key_header: str = "Authorization"
    auth_scheme: str = "Bearer"
    max_tokens: int = 32_000
    timeout: int = 900
    stream: bool = True
    extra_headers: dict[str, str] | None = None
    command: str | None = None
    env_prefix: str = "SENSA_LLM_"

    @classmethod
    def from_env(cls, prefix: str = "SENSA_LLM_") -> "LLMConfig":
        def _get(key: str) -> str | None:
            return os.environ.get(f"{prefix}{key}")

        protocol = _get("PROTOCOL") or _get("BACKEND")
        aliases = {"claude-cli": "command", "openai": "openai-responses"}
        protocol = aliases.get(protocol or "", protocol or "")
        if not protocol:
            raise LLMConfigurationError(
                f"未配置 {prefix}PROTOCOL；"
                "可选 openai-responses、openai-chat、anthropic、command"
            )

        extra_headers: dict[str, str] = {}
        raw_headers = _get("HEADERS_JSON")
        if raw_headers:
            try:
                parsed = json.loads(raw_headers)
            except json.JSONDecodeError as exc:
                raise LLMConfigurationError(
                    f"{prefix}HEADERS_JSON 必须是 JSON 对象"
                ) from exc
            if not isinstance(parsed, dict) or not all(
                isinstance(k, str) and isinstance(v, str)
                for k, v in parsed.items()
            ):
                raise LLMConfigurationError(
                    f"{prefix}HEADERS_JSON 的键和值都必须是字符串"
                )
            extra_headers = parsed

        api_key = _get("API_KEY")
        if not api_key:
            if protocol.startswith("openai"):
                api_key = os.environ.get("OPENAI_API_KEY")
            elif protocol == "anthropic":
                api_key = os.environ.get("ANTHROPIC_API_KEY")

        command = _get("COMMAND")
        if protocol == "command" and not command:
            if _get("BACKEND") == "claude-cli":
                command = "claude -p"
                if _get("MODEL"):
                    command += " --model {model}"
            else:
                raise LLMConfigurationError(
                    f"command 协议需要 {prefix}COMMAND"
                )

        return cls(
            protocol=protocol,
            model=_get("MODEL"),
            base_url=_get("BASE_URL"),
            endpoint=_get("ENDPOINT"),
            api_key=api_key,
            api_key_header=_get("API_KEY_HEADER") or "Authorization",
            auth_scheme=_get("AUTH_SCHEME") or "Bearer",
            max_tokens=_positive_int_val(_get("MAX_TOKENS"), 32_000),
            timeout=_positive_int_val(_get("TIMEOUT"), 900),
            stream=(_get("STREAM") or "1").lower() not in ("0", "false", "no"),
            extra_headers=extra_headers,
            command=command,
            env_prefix=prefix,
        )


Adapter = Callable[[str, LLMConfig], str]
ADAPTERS: dict[str, Adapter] = {}


def register_adapter(name: str, adapter: Adapter) -> None:
    """Register an in-process adapter without changing Sensa schemas."""
    if not name or not callable(adapter):
        raise ValueError("adapter name and callable are required")
    ADAPTERS[name] = adapter


def _positive_int_val(val_str: str | None, default: int) -> int:
    if val_str is None:
        return default
    try:
        value = int(val_str)
    except ValueError as exc:
        raise LLMConfigurationError("配置中的 max_tokens / timeout 必须是正整数") from exc
    if value <= 0:
        raise LLMConfigurationError("配置中的 max_tokens / timeout 必须是正整数")
    return value


def _url(config: LLMConfig, default_base: str, path: str) -> str:
    if config.endpoint:
        return config.endpoint
    return f"{(config.base_url or default_base).rstrip('/')}/{path.lstrip('/')}"


def _headers(config: LLMConfig, *, anthropic: bool = False) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if config.api_key:
        if anthropic and config.api_key_header == "Authorization":
            headers["x-api-key"] = config.api_key
        else:
            prefix = f"{config.auth_scheme} " if config.auth_scheme else ""
            headers[config.api_key_header] = f"{prefix}{config.api_key}"
    headers.update(config.extra_headers or {})
    return headers


def _extract_request_id(headers: Any, body_json: dict[str, Any] | None = None) -> str | None:
    if headers:
        for header_name in ("x-request-id", "request-id", "apigw-request-id", "x-openai-request-id"):
            val = headers.get(header_name) or headers.get(header_name.title())
            if val:
                return str(val)
    if body_json and isinstance(body_json, dict):
        req_id = body_json.get("request_id") or body_json.get("id")
        if req_id and isinstance(req_id, str):
            return req_id
    return None


def _post_json(
    url: str,
    payload: dict[str, Any],
    headers: dict[str, str],
    timeout: int,
) -> tuple[dict[str, Any], str | None]:
    try:
        return _post_json_requests(url, payload, headers, timeout)
    except (requests.exceptions.ConnectionError,
            requests.exceptions.ChunkedEncodingError,
            requests.exceptions.ReadTimeout) as exc:
        print(f"  (requests 失败, 尝试 curl 回退: {exc})", file=sys.stderr)
        return _post_json_curl(url, payload, headers, timeout)


def _post_json_requests(
    url: str,
    payload: dict[str, Any],
    headers: dict[str, str],
    timeout: int,
) -> tuple[dict[str, Any], str | None]:
    import time
    max_retries = 4
    for attempt in range(max_retries + 1):
        response = requests.post(
            url,
            json=payload,
            headers=headers,
            timeout=timeout,
        )
        if response.status_code == 429 and attempt < 1:
            wait_time = 3
            print(f"  (HTTP 429 RateLimit, 等待 {wait_time}s 重试 {attempt+1}/1)...", file=sys.stderr)
            time.sleep(wait_time)
            continue


        response.raise_for_status()
        doc = response.json()
        if not isinstance(doc, dict):
            raise LLMResponseError("LLM JSON 响应根节点必须是对象")
        req_id = _extract_request_id(response.headers, doc)
        return doc, req_id
    raise LLMResponseError("HTTP 429 超出最大重试次数")



def _run_curl(
    url: str,
    payload: dict[str, Any],
    headers: dict[str, str],
    timeout: int,
    *,
    stream: bool = False,
) -> str:
    header_args: list[str] = []
    for key, value in headers.items():
        header_args.extend(["-H", f"{key}: {value}"])
    env = os.environ.copy()
    for name in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY",
                 "all_proxy", "ALL_PROXY", "no_proxy", "NO_PROXY"):
        env.pop(name, None)
    try:
        cmd = [
            "curl", "-sS", *(["-N"] if stream else []),
            "--doh-url", "https://dns.alidns.com/dns-query",
            "-w", "\n%{http_code}", "-X", "POST", url,
            "--max-time", str(timeout),
            "-d", "@-",
            *header_args,
        ]
        result = subprocess.run(
            cmd,
            input=json.dumps(payload).encode("utf-8"),
            capture_output=True,
            timeout=timeout + 5,
            env=env,
            check=False,
        )
        output = result.stdout.decode("utf-8", errors="replace")
        stderr_str = result.stderr.decode("utf-8", errors="replace").strip()
        stderr_tail = stderr_str[-200:] if stderr_str else ""
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise LLMResponseError(f"curl 执行失败: {exc}") from exc
    if not output:
        raise LLMResponseError(
            f"curl 无输出 (rc={result.returncode}): {stderr_tail}"
        )
    lines = output.rsplit("\n", 1)
    if len(lines) == 2 and lines[1].strip().isdigit():
        status_code = int(lines[1].strip())
        body = lines[0]
    else:
        body = output
        status_code = 0
    if status_code >= 400:
        raise LLMResponseError(f"LLM HTTP {status_code}: {body[:1000]}")
    return body


def _post_json_curl(
    url: str,
    payload: dict[str, Any],
    headers: dict[str, str],
    timeout: int,
) -> tuple[dict[str, Any], str | None]:
    body = _run_curl(url, payload, headers, timeout)
    try:
        doc = json.loads(body)
    except json.JSONDecodeError as exc:
        raise LLMResponseError(f"LLM 返回了非 JSON 响应: {body[:200]}") from exc
    if not isinstance(doc, dict):
        raise LLMResponseError("LLM JSON 响应根节点必须是对象")
    req_id = _extract_request_id(None, doc)
    return doc, req_id


def _sse_chat_delta(line: str) -> str | None:
    if not line.startswith("data:"):
        return None
    data = line[len("data:"):].strip()
    if not data or data == "[DONE]":
        return None
    try:
        doc = json.loads(data)
    except json.JSONDecodeError as exc:
        raise LLMResponseError(f"流式响应块不是 JSON: {data[:200]}") from exc
    if not isinstance(doc, dict):
        raise LLMResponseError("流式响应块必须是 JSON 对象")
    if doc.get("error"):
        raise LLMResponseError(f"LLM 流式错误: {json.dumps(doc['error'])[:500]}")
    choices = doc.get("choices") or []
    if not choices or not isinstance(choices[0], dict):
        return None
    delta = choices[0].get("delta") or {}
    content = delta.get("content")
    return content if isinstance(content, str) else None


def _collect_sse_text(lines: Any) -> str:
    texts = [t for t in (_sse_chat_delta(line) for line in lines if line) if t]
    if not texts:
        raise LLMResponseError("流式响应中没有文本输出")
    return "".join(texts)


def _post_sse(
    url: str,
    payload: dict[str, Any],
    headers: dict[str, str],
    timeout: int,
) -> tuple[str, str | None]:
    try:
        response = requests.post(
            url, json=payload, headers=headers, timeout=timeout, stream=True
        )
        response.raise_for_status()
        req_id = _extract_request_id(response.headers)
        text = _collect_sse_text(response.iter_lines(decode_unicode=True))
        return text, req_id
    except (requests.exceptions.ConnectionError,
            requests.exceptions.ChunkedEncodingError,
            requests.exceptions.ReadTimeout) as exc:
        print(f"  (requests 失败, 尝试 curl 回退: {exc})", file=sys.stderr)
        body = _run_curl(url, payload, headers, timeout, stream=True)
        text = _collect_sse_text(body.splitlines())
        return text, None


def _require_api(config: LLMConfig) -> None:
    if not config.model:
        raise LLMConfigurationError(f"API 协议需要 {config.env_prefix}MODEL")
    if not config.api_key and not (config.extra_headers or {}):
        raise LLMConfigurationError(
            f"API 协议需要 {config.env_prefix}API_KEY，或通过 "
            f"{config.env_prefix}HEADERS_JSON 提供认证头"
        )


_SUPPORTED_MULTIMODAL_EXTS = {".png", ".jpg", ".jpeg", ".webp"}


def _encode_image(path: Path) -> str:
    if not path.exists():
        raise LLMResponseError(f"输入图片文件不存在: {path.name}")
    if path.stat().st_size == 0:
        raise LLMResponseError(f"输入图片文件为空: {path.name}")
    ext = path.suffix.lower()
    if ext not in _SUPPORTED_MULTIMODAL_EXTS:
        raise LLMResponseError(
            f"不支持的多模态图片格式 '{ext}': {path.name}。支持: PNG, JPEG, WEBP"
        )
    mime_map = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
    }
    mime = mime_map[ext]
    data = path.read_bytes()
    b64 = base64.b64encode(data).decode("ascii")
    return f"data:{mime};base64,{b64}"


def _openai_responses_invoke(
    prompt: str,
    config: LLMConfig,
    system_prompt: str | None = None,
    images: list[Path] | None = None,
) -> LLMResult:
    _require_api(config)
    payload: dict[str, Any] = {
        "model": config.model,
        "max_output_tokens": config.max_tokens,
        "store": False,
    }
    if system_prompt:
        payload["instructions"] = system_prompt

    if images:
        input_content: list[dict[str, Any]] = []
        for img_path in images:
            data_uri = _encode_image(img_path)
            input_content.append({"type": "input_image", "image_url": data_uri})
        input_content.append({"type": "input_text", "text": prompt})
        payload["input"] = input_content
    else:
        payload["input"] = prompt

    doc, req_id = _post_json(
        _url(config, "https://api.openai.com/v1", "responses"),
        payload,
        _headers(config),
        config.timeout,
    )
    if isinstance(doc.get("output_text"), str):
        return LLMResult(text=doc["output_text"], protocol=config.protocol, model=config.model, request_id=req_id)
    texts = []
    for item in doc.get("output") or []:
        for content in item.get("content") or []:
            text = content.get("text")
            if isinstance(text, str):
                texts.append(text)
    if not texts:
        raise LLMResponseError("Responses 响应中没有文本输出")
    return LLMResult(text="".join(texts), protocol=config.protocol, model=config.model, request_id=req_id)


def _openai_chat_invoke(
    prompt: str,
    config: LLMConfig,
    system_prompt: str | None = None,
    images: list[Path] | None = None,
) -> LLMResult:
    _require_api(config)
    url = _url(config, "https://api.openai.com/v1", "chat/completions")
    messages: list[dict[str, Any]] = []

    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})

    if images:
        user_content: list[dict[str, Any]] = []
        for img_path in images:
            data_uri = _encode_image(img_path)
            user_content.append({"type": "image_url", "image_url": {"url": data_uri}})
        user_content.append({"type": "text", "text": prompt})
        messages.append({"role": "user", "content": user_content})
    else:
        messages.append({"role": "user", "content": prompt})

    payload: dict[str, Any] = {
        "model": config.model,
        "messages": messages,
        "max_tokens": config.max_tokens,
    }

    if config.stream and not images:
        payload["stream"] = True
        text, req_id = _post_sse(url, payload, _headers(config), config.timeout)
        return LLMResult(text=text, protocol=config.protocol, model=config.model, request_id=req_id)

    doc, req_id = _post_json(url, payload, _headers(config), config.timeout)
    try:
        content = doc["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise LLMResponseError("Chat Completions 响应结构不完整") from exc
    if isinstance(content, str):
        return LLMResult(text=content, protocol=config.protocol, model=config.model, request_id=req_id)
    if isinstance(content, list):
        texts = [part.get("text", "") for part in content if isinstance(part, dict)]
        if any(texts):
            return LLMResult(text="".join(texts), protocol=config.protocol, model=config.model, request_id=req_id)
    raise LLMResponseError("Chat Completions 响应中没有文本输出")


def _anthropic_messages_invoke(
    prompt: str,
    config: LLMConfig,
    system_prompt: str | None = None,
    images: list[Path] | None = None,
) -> LLMResult:
    if images:
        raise LLMResponseError(
            f"协议 '{config.protocol}' 暂未在本地注册多模态处理，无法调用 invoke_multimodal()"
        )
    _require_api(config)
    headers = _headers(config, anthropic=True)
    headers.setdefault("anthropic-version", "2023-06-01")
    payload: dict[str, Any] = {
        "model": config.model,
        "max_tokens": config.max_tokens,
        "messages": [{"role": "user", "content": prompt}],
    }
    if system_prompt:
        payload["system"] = system_prompt

    doc, req_id = _post_json(
        _url(config, "https://api.anthropic.com/v1", "messages"),
        payload,
        headers,
        config.timeout,
    )
    texts = [
        block.get("text", "")
        for block in doc.get("content") or []
        if isinstance(block, dict) and block.get("type") == "text"
    ]
    if not any(texts):
        raise LLMResponseError("Anthropic Messages 响应中没有文本输出")
    return LLMResult(text="".join(texts), protocol=config.protocol, model=config.model, request_id=req_id)


def _command_invoke(
    prompt: str,
    config: LLMConfig,
    system_prompt: str | None = None,
    images: list[Path] | None = None,
) -> LLMResult:
    if images:
        raise LLMResponseError(
            f"协议 '{config.protocol}' 不支持多模态调用"
        )
    if not config.command:
        raise LLMConfigurationError(f"command 协议需要 {config.env_prefix}COMMAND")
    cmd = shlex.split(config.command)
    if any("{model}" in part for part in cmd):
        if not config.model:
            raise LLMConfigurationError(
                f"{config.env_prefix}COMMAND 使用了 {{model}}，但未配置 "
                f"{config.env_prefix}MODEL"
            )
        cmd = [part.replace("{model}", config.model) for part in cmd]

    input_text = prompt
    if system_prompt:
        input_text = f"--- SYSTEM ---\n{system_prompt}\n\n--- USER ---\n{prompt}"

    try:
        result = subprocess.run(
            cmd,
            input=input_text,
            capture_output=True,
            text=True,
            timeout=config.timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise LLMResponseError(f"本地模型命令执行失败: {exc}") from exc
    if result.returncode != 0:
        raise LLMResponseError(
            f"本地模型命令退出码 {result.returncode}: {result.stderr.strip()[:1000]}"
        )
    return LLMResult(text=result.stdout, protocol=config.protocol, model=config.model, request_id=None)


def _openai_responses_compat(prompt: str, config: LLMConfig) -> str:
    return _openai_responses_invoke(prompt, config).text


def _openai_chat_compat(prompt: str, config: LLMConfig) -> str:
    return _openai_chat_invoke(prompt, config).text


def _anthropic_messages_compat(prompt: str, config: LLMConfig) -> str:
    return _anthropic_messages_invoke(prompt, config).text


def _command_compat(prompt: str, config: LLMConfig) -> str:
    return _command_invoke(prompt, config).text


register_adapter("openai-responses", _openai_responses_compat)
register_adapter("openai-chat", _openai_chat_compat)
register_adapter("anthropic", _anthropic_messages_compat)
register_adapter("command", _command_compat)


def invoke(
    prompt: str,
    config: LLMConfig | None = None,
    *,
    system_prompt: str | None = None,
) -> LLMResult:
    config = config or LLMConfig.from_env()
    if config.protocol == "openai-responses":
        return _openai_responses_invoke(prompt, config, system_prompt=system_prompt)
    if config.protocol == "openai-chat":
        return _openai_chat_invoke(prompt, config, system_prompt=system_prompt)
    if config.protocol == "anthropic":
        return _anthropic_messages_invoke(prompt, config, system_prompt=system_prompt)
    if config.protocol == "command":
        return _command_invoke(prompt, config, system_prompt=system_prompt)

    adapter = ADAPTERS.get(config.protocol)
    if not adapter:
        raise LLMConfigurationError(
            f"未知协议 '{config.protocol}'，可选: {', '.join(sorted(ADAPTERS))}"
        )
    text = adapter(prompt, config)
    return LLMResult(text=text, protocol=config.protocol, model=config.model, request_id=None)


def generate(
    prompt: str,
    config: LLMConfig | None = None,
    *,
    system_prompt: str | None = None,
) -> str:
    # The only production caller of the convenience API is inventory drafting.
    # Keep its provider namespace explicit so a generic legacy SENSA_LLM_ value
    # cannot silently select a different model than the acquisition stage.
    config = config or LLMConfig.from_env(prefix="SENSA_ACQUISITION_LLM_")
    return invoke(prompt, config=config, system_prompt=system_prompt).text


def invoke_multimodal(
    prompt: str,
    images: list[Path],
    config: LLMConfig | None = None,
    *,
    system_prompt: str | None = None,
) -> LLMResult:
    if not images:
        raise LLMResponseError("invoke_multimodal() 要求至少提供 1 张图片")
    config = config or LLMConfig.from_env()
    if config.protocol == "openai-responses":
        return _openai_responses_invoke(prompt, config, system_prompt=system_prompt, images=images)
    if config.protocol == "openai-chat":
        return _openai_chat_invoke(prompt, config, system_prompt=system_prompt, images=images)
    if config.protocol in ("anthropic", "command"):
        raise LLMResponseError(f"协议 '{config.protocol}' 不支持多模态调用")

    raise LLMResponseError(f"未知或不支持多模态的协议 '{config.protocol}'")
