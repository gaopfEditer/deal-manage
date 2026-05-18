"""
Ollama Qwen2.5-VL 看图示例（默认官方 qwen2.5vl:7b）。

勿用自建「主 GGUF + mmproj」的 qwen2.5-vl-7b：Ollama 0.20+ 常输出「道/切/ech26」类乱码。
  ollama pull qwen2.5vl:7b
  python ollama_demo.py

若必须用本地 GGUF，需单文件融合版，勿双 FROM Modelfile。

运行：cd tmp && python ollama_demo.py
"""
from __future__ import annotations

import os
import re
import sys
import time

if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
from io import BytesIO
from pathlib import Path

import httpx
from ollama import Client, ResponseError

_SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5vl:7b")
KNOWN_BROKEN_CUSTOM = frozenset({"qwen2.5-vl-7b", "qwen2.5-vl-7b:latest"})
TIMEOUT_SEC = float(os.environ.get("OLLAMA_TIMEOUT", "900"))
IMAGE_MAX = int(os.environ.get("OLLAMA_IMAGE_MAX", "1024"))


def _client() -> Client:
    return Client(timeout=httpx.Timeout(TIMEOUT_SEC, connect=30.0))


def _warn_if_bad_modelfile(model: str) -> None:
    import subprocess

    try:
        r = subprocess.run(
            ["ollama", "show", model, "--modelfile"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        mf = r.stdout or ""
    except Exception:
        return
    # ollama show 总会打印 TEMPLATE {{ .Prompt }}，不是手写坏模板
    if re.search(r'TEMPLATE\s+"""', mf) or (
        "TEMPLATE" in mf.upper() and "im_start" in mf
    ):
        print(
            "【警告】Modelfile 含自定义 TEMPLATE 块，会破坏 Qwen2.5-VL 看图。\n"
            "请删除 TEMPLATE 后重建；仅见「TEMPLATE {{ .Prompt }}」可忽略。\n"
        )


def _encode_image(path: Path, max_edge: int = IMAGE_MAX) -> tuple[str, str]:
    raw = path.read_bytes()
    from PIL import Image

    img = Image.open(BytesIO(raw)).convert("RGB")
    img.thumbnail((max_edge, max_edge))
    buf = BytesIO()
    img.save(buf, format="JPEG", quality=85, optimize=True)
    raw = buf.getvalue()
    import base64

    return (
        base64.b64encode(raw).decode("ascii"),
        f"JPEG 长边≤{max_edge}px，{len(raw) // 1024} KB",
    )


def _warn_custom_dual_gguf(model: str) -> None:
    base = model.split(":")[0]
    if base not in KNOWN_BROKEN_CUSTOM:
        return
    print(
        "【提示】qwen2.5-vl-7b 为本地双 GGUF 自建，Ollama 0.20+ 看图常乱码。\n"
        "建议：ollama pull qwen2.5vl:7b  后  $env:OLLAMA_MODEL='qwen2.5vl:7b'\n"
    )


def _is_garbage(text: str) -> bool:
    t = text.strip()
    if len(t) < 12:
        return True
    if re.fullmatch(r"[\s\\[\]{}<>其他/\-_|]+", t):
        return True
    # 自建双 GGUF 典型胡言：大量单字行 +「道」+ ech 数字串
    if t.count("道") >= 12 or len(re.findall(r"ech\d+", t, re.I)) >= 4:
        return True
    lines = [ln.strip() for ln in t.splitlines() if ln.strip()]
    if len(lines) >= 15:
        short_lines = sum(1 for ln in lines if len(ln) <= 5)
        if short_lines / len(lines) > 0.45:
            return True
    cjk = len(re.findall(r"[\u4e00-\u9fff]", t))
    if cjk < 4 and len(t) < 80:
        return True
    # 有汉字但几乎无标点、无完整句（描述类回答应有。，：等）
    if cjk >= 20 and not re.search(r"[。！？；：，、]", t) and len(t) > 200:
        return True
    return False


def ask_image(image_path: str | Path, model: str = DEFAULT_MODEL) -> None:
    client = _client()
    print(f"使用模型: {model}")
    _warn_custom_dual_gguf(model)

    try:
        info = client.show(model)
    except ResponseError as e:
        if e.status_code == 404:
            print(
                f"未找到模型 {model!r}。请先：\n"
                "  ollama pull qwen2.5vl:7b\n"
                "或设置 OLLAMA_MODEL 为已安装的 vision 模型名。"
            )
        else:
            print(f"Ollama 错误 {e.status_code}: {e.error}")
        sys.exit(1)
    caps = list(getattr(info, "capabilities", None) or [])
    if "vision" not in caps:
        print("【错误】模型无 vision，请 ollama show 确认后重建。")
        sys.exit(1)

    _warn_if_bad_modelfile(model)

    path = Path(image_path)
    if not path.is_file():
        path = _SCRIPT_DIR / image_path
    if not path.is_file():
        print(f"图片不存在: {image_path}")
        return
    path = path.resolve()

    image_b64, img_note = _encode_image(path)
    print(f"图片: {path.name}（{img_note}）")
    print("推理中（首次约 2～5 分钟）…", flush=True)

    t0 = time.time()
    try:
        response = client.chat(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": "你是看图助手。只根据用户提供的图片用简体中文回答，条理清晰，不要输出 LaTeX 或乱码符号。",
                },
                {
                    "role": "user",
                    "content": (
                        "请描述这张截图：1) 最上方标题文字；"
                        "2) 有无红/黄/绿告警或状态灯；"
                        "3) 与交易/行情相关的关键信息。"
                    ),
                    "images": [image_b64],
                },
            ],
            options={
                "temperature": 0.1,
                "num_predict": 1024,
                "num_ctx": 8192,
            },
            keep_alive="10m",
        )
    except ResponseError as e:
        print(f"Ollama 错误 {e.status_code}: {e.error}")
        if e.status_code in (500, 503):
            print(
                "若为 GGML_ASSERT / 503：重启 Ollama，确认 mmproj 与主模型配套，或试 ollama pull qwen2.5vl:7b"
            )
        sys.exit(1)

    text = (response.message.content or "").strip()
    elapsed = time.time() - t0

    if _is_garbage(text):
        print(
            f"\n耗时 {elapsed:.1f}s\n"
            f"【输出异常（非看图结果，可视为模型/权重问题）】\n"
            f"{text[:600]}{'…' if len(text) > 600 else ''}\n\n"
            "你看到的「道 / 切 / ech26 / 赠」是解码崩溃后的 token 碎片，不是脚本 bug。\n"
            "根因：用 Modelfile 拼「Q4_K_M.gguf + mmproj-BF16.gguf」在 Ollama 0.20+ 上不可靠。\n\n"
            "请改用官方融合包（网络需能访问 registry.ollama.ai）：\n"
            "  ollama pull qwen2.5vl:7b\n"
            "  $env:OLLAMA_MODEL='qwen2.5vl:7b'\n"
            "  python ollama_demo.py\n\n"
            "可删除无效自建：ollama rm qwen2.5-vl-7b\n"
        )
        sys.exit(1)

    print(f"\n耗时 {elapsed:.1f}s\n图片分析:\n{text}")


if __name__ == "__main__":
    ask_image("22.jpg")
