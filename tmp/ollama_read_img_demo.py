#!/usr/bin/env python3
"""
Ollama 多模态看图示例（gemma4:26b）

复用项目 ollama_local.yaml 与 prepare_ollama_generate_payload 的同等逻辑，
直接 POST Ollama /api/generate，或经 deal-manage 的 /ollama/chat。

用法（默认 promat=tv_k_line，加载 prompts/tv_k_line.txt）：
  python tmp/ollama_read_img_demo.py
  python tmp/ollama_read_img_demo.py --via-api
  python tmp/ollama_read_img_demo.py --image tmp/img.png --prompt "补充说明"

前置：本机 Ollama 已启动，且已拉取视觉模型，例如：
  ollama pull gemma4:26b
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

ROOT = Path(__file__).resolve().parent.parent


def _load_settings() -> dict[str, Any]:
    path = Path(os.getenv("OLLAMA_LOCAL_CONFIG") or (ROOT / "ollama_local.yaml"))
    defaults: dict[str, Any] = {
        "base_url": "http://localhost:11434",
        "generate_endpoint": "/api/generate",
        "default_model": "gemma4:26b",
        "vision_model": "gemma4:26b",
        "stream": False,
        "timeout_seconds": 300,
    }
    if not path.exists():
        return defaults
    try:
        import yaml  # type: ignore

        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except Exception:
        return defaults
    if not isinstance(data, dict):
        return defaults
    merged = {**defaults, **data}
    merged["base_url"] = str(merged.get("base_url") or defaults["base_url"]).rstrip("/")
    ep = str(merged.get("generate_endpoint") or defaults["generate_endpoint"]).strip()
    merged["generate_endpoint"] = ep if ep.startswith("/") else "/" + ep
    merged["default_model"] = str(merged.get("default_model") or defaults["default_model"]).strip()
    vm = merged.get("vision_model")
    merged["vision_model"] = str(vm).strip() if vm else defaults["vision_model"]
    merged["stream"] = bool(merged.get("stream", False))
    try:
        merged["timeout_seconds"] = float(merged.get("timeout_seconds", 300))
    except (TypeError, ValueError):
        merged["timeout_seconds"] = 300.0
    return merged


def _generate_url(settings: dict[str, Any]) -> str:
    base = settings["base_url"].rstrip("/") + "/"
    return urljoin(base, settings["generate_endpoint"].lstrip("/"))


def _encode_image_b64(image_path: Path) -> str:
    with image_path.open("rb") as f:
        return base64.standard_b64encode(f.read()).decode("utf-8")


def _prepare_payload(
    settings: dict[str, Any],
    *,
    prompt: str,
    images_b64: list[str],
    model_override: str | None = None,
) -> tuple[dict[str, Any], str]:
    """有图时使用 vision_model，并在 payload 中附带 images。"""
    has_images = bool(images_b64)
    if model_override and str(model_override).strip():
        model = str(model_override).strip()
    elif has_images:
        model = str(settings.get("vision_model") or settings["default_model"]).strip()
    else:
        model = settings["default_model"]
    payload: dict[str, Any] = {
        "model": model,
        "prompt": prompt,
        "stream": bool(settings.get("stream", False)),
    }
    if has_images:
        payload["images"] = images_b64
    return payload, model


def _post_json(url: str, body: dict, *, timeout: float = 600.0) -> tuple[int, dict]:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            status = resp.getcode()
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        status = exc.code
        raw = exc.read().decode("utf-8", errors="replace")
    try:
        return status, json.loads(raw)
    except json.JSONDecodeError:
        return status, {"raw": raw[:2000]}


DEFAULT_IMAGE = Path(__file__).resolve().parent / "img.png"
DEFAULT_PROMAT = "tv_k_line"
DEFAULT_PROMPT = ""
_PROMPT_SEP = "\n\n---\n\n"


def _load_promat_prompt(name: str) -> str:
    path = ROOT / "prompts" / f"{name}.txt"
    if not path.is_file():
        raise FileNotFoundError(f"未找到提示词模板: {path}")
    return path.read_text(encoding="utf-8", errors="replace").strip()


def _merge_promat(promat: str | None, prompt: str) -> str:
    if not promat or not str(promat).strip():
        return prompt
    prefix = _load_promat_prompt(str(promat).strip())
    user = (prompt or "").strip()
    if prefix and user:
        return f"{prefix}{_PROMPT_SEP}{user}"
    return prefix or user


def call_ollama_direct(
    *,
    image_path: Path,
    prompt: str,
    model: str | None = None,
    promat: str | None = None,
) -> dict:
    if not image_path.is_file():
        raise FileNotFoundError(f"图片不存在: {image_path}")

    settings = _load_settings()
    final_prompt = _merge_promat(promat, prompt)
    b64 = _encode_image_b64(image_path.resolve())
    payload, used_model = _prepare_payload(
        settings, prompt=final_prompt, images_b64=[b64], model_override=model
    )
    url = _generate_url(settings)

    print(f"[Ollama] POST {url}")
    print(f"[Ollama] model={used_model} promat={promat or '-'} images=1 file={image_path.name}")

    status, data = _post_json(url, payload, timeout=float(settings["timeout_seconds"]))
    if status >= 400:
        raise RuntimeError(f"Ollama 失败 status={status} body={data!r}")

    return {
        "mode": "ollama_direct",
        "model": used_model,
        "response": str(data.get("response") or "").strip(),
        "raw": data,
    }


def call_via_deal_manage_api(
    *,
    image_path: Path,
    prompt: str,
    base_url: str,
    model: str | None = None,
    promat: str | None = None,
) -> dict:
    if not image_path.is_file():
        raise FileNotFoundError(f"图片不存在: {image_path}")

    b64 = _encode_image_b64(image_path.resolve())
    api = base_url.rstrip("/") + "/ollama/chat"
    body: dict[str, Any] = {
        "promat": promat or DEFAULT_PROMAT,
        "prompt": prompt,
        "images": [b64],
    }
    if model:
        body["model"] = model

    print(f"[API] POST {api}")
    print(f"[API] promat={body['promat']} images[0] len={len(b64)} file={image_path.name}")

    settings = _load_settings()
    status, data = _post_json(api, body, timeout=float(settings["timeout_seconds"]))
    if status >= 400:
        detail = data.get("detail") if isinstance(data, dict) else data
        raise RuntimeError(f"API 失败 status={status} detail={detail!r}")

    return {
        "mode": "deal_manage_api",
        "model": data.get("model"),
        "vision": data.get("vision"),
        "image_count": data.get("image_count"),
        "response": str(data.get("response") or "").strip(),
        "raw": data,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Ollama 看图 demo")
    parser.add_argument("--image", type=Path, default=DEFAULT_IMAGE, help="本地图片路径")
    parser.add_argument("--prompt", default=DEFAULT_PROMPT, help="补充提示词（默认空，主要靠 promat 模板）")
    parser.add_argument(
        "--promat",
        default=DEFAULT_PROMAT,
        help=f"加载 prompts/{{name}}.txt 作为前置模板（默认 {DEFAULT_PROMAT}）",
    )
    parser.add_argument("--model", default=None, help="覆盖 vision_model")
    parser.add_argument("--via-api", action="store_true", help="走 deal-manage /ollama/chat")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000", help="服务地址")
    parser.add_argument("--json", action="store_true", help="打印完整 JSON")
    args = parser.parse_args()

    image_path = args.image.expanduser()
    if not image_path.is_absolute():
        image_path = (Path.cwd() / image_path).resolve()

    try:
        if args.via_api:
            result = call_via_deal_manage_api(
                image_path=image_path,
                prompt=args.prompt,
                base_url=args.base_url,
                model=args.model,
                promat=args.promat,
            )
        else:
            result = call_ollama_direct(
                image_path=image_path,
                prompt=args.prompt,
                model=args.model,
                promat=args.promat,
            )
    except Exception as exc:
        print(f"错误: {exc}", file=sys.stderr)
        return 1

    print("\n========== 模型回复 ==========\n")
    print(result.get("response") or "（空）")
    print("\n============================\n")

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
