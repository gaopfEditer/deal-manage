"""发布附图：解析 base64、落盘、供历史回看与后续币安 imageToken 对接。"""
from __future__ import annotations

import base64
import re
import uuid
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parent.parent
MEDIA_ROOT = ROOT_DIR / "manager" / "state" / "publish_media"

MAX_ATTACHMENTS = 9
MAX_IMAGE_BYTES = 5 * 1024 * 1024
_ALLOWED_MIME = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


def _strip_data_url(s: str) -> tuple[str, str | None]:
    t = (s or "").strip()
    m = re.match(r"^data:([^;]+);base64,(.+)$", t, re.IGNORECASE | re.DOTALL)
    if m:
        return m.group(2).strip(), m.group(1).strip().lower()
    return t, None


def decode_image_payload(raw: str) -> tuple[bytes, str]:
    b64_part, mime_from_url = _strip_data_url(raw)
    try:
        data = base64.b64decode(b64_part, validate=True)
    except Exception as exc:
        raise ValueError(f"图片 base64 无效: {exc!r}") from exc
    if not data:
        raise ValueError("图片数据为空")
    if len(data) > MAX_IMAGE_BYTES:
        raise ValueError(f"单张图片不能超过 {MAX_IMAGE_BYTES // (1024 * 1024)}MB")

    mime = mime_from_url or ""
    if not mime:
        if data[:3] == b"\xff\xd8\xff":
            mime = "image/jpeg"
        elif data[:8] == b"\x89PNG\r\n\x1a\n":
            mime = "image/png"
        elif data[:6] in (b"GIF87a", b"GIF89a"):
            mime = "image/gif"
        elif data[:4] == b"RIFF" and len(data) > 12 and data[8:12] == b"WEBP":
            mime = "image/webp"
        else:
            mime = "image/jpeg"

    ext = _ALLOWED_MIME.get(mime)
    if not ext:
        raise ValueError(f"不支持的图片类型: {mime}")
    return data, mime


def save_publish_attachments(publish_id: str, images_b64: list[str]) -> list[dict[str, Any]]:
    if not images_b64:
        return []
    if len(images_b64) > MAX_ATTACHMENTS:
        raise ValueError(f"最多 {MAX_ATTACHMENTS} 张附图")

    folder = (MEDIA_ROOT / publish_id).resolve()
    media_root = MEDIA_ROOT.resolve()
    if not str(folder).startswith(str(media_root)):
        raise ValueError("非法发布 id")

    folder.mkdir(parents=True, exist_ok=True)
    saved: list[dict[str, Any]] = []
    for idx, raw in enumerate(images_b64):
        data, mime = decode_image_payload(str(raw))
        ext = _ALLOWED_MIME[mime]
        file_id = f"{idx:02d}_{uuid.uuid4().hex[:8]}{ext}"
        path = folder / file_id
        path.write_bytes(data)
        saved.append(
            {
                "id": file_id,
                "mime": mime,
                "size_bytes": len(data),
                "url": f"/api/publish/media/{publish_id}/{file_id}",
            }
        )
    return saved


def resolve_media_file(publish_id: str, file_id: str) -> Path:
    if ".." in publish_id or "/" in publish_id or "\\" in publish_id:
        raise FileNotFoundError("非法路径")
    if ".." in file_id or "/" in file_id or "\\" in file_id:
        raise FileNotFoundError("非法路径")
    path = (MEDIA_ROOT / publish_id / file_id).resolve()
    if not str(path).startswith(str(MEDIA_ROOT.resolve())):
        raise FileNotFoundError("非法路径")
    if not path.is_file():
        raise FileNotFoundError("文件不存在")
    return path
