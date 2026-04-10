"""配置中的 JSON 数据文件：统计条数、持久化「已浏览」计数。"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

# 常见「列表在字段里」的键名（爬虫输出可能是 { "posts": [...] }）
_LIST_KEYS = ("posts", "items", "data", "records", "list", "rows", "entries")


def extract_posts_flat(data: Any) -> list[dict[str, Any]]:
    """
    扁平化帖子列表，支持：
    - { "version": 1, "posts": { "author_slug": { "url": { ...post } } } }  # 币安状态文件
    - { "posts": [ {...}, ... ] }
    - 顶层单条 { "href", "title", ... }
    """
    out: list[dict[str, Any]] = []
    if data is None:
        return out
    if isinstance(data, list):
        for i, p in enumerate(data):
            if isinstance(p, dict):
                row = dict(p)
                row.setdefault("_author_slug", "")
                row.setdefault("_url_key", str(i))
                out.append(row)
        return out
    if not isinstance(data, dict):
        return out

    posts = data.get("posts")
    # 嵌套：posts 为 dict，作者 slug -> (url -> 帖子对象)
    if isinstance(posts, dict):
        for author_slug, by_url in posts.items():
            if not isinstance(by_url, dict):
                continue
            for url_key, post in by_url.items():
                if not isinstance(post, dict):
                    continue
                if not any(k in post for k in ("href", "title", "raw")):
                    continue
                row = dict(post)
                row["_author_slug"] = str(author_slug)
                row["_url_key"] = str(url_key)
                out.append(row)
        if out:
            return out

    if isinstance(posts, list):
        for i, p in enumerate(posts):
            if isinstance(p, dict):
                row = dict(p)
                row.setdefault("_author_slug", "")
                row.setdefault("_url_key", str(i))
                out.append(row)
        if out:
            return out

    for k in _LIST_KEYS:
        if k == "posts":
            continue
        v = data.get(k)
        if isinstance(v, list):
            for i, p in enumerate(v):
                if isinstance(p, dict):
                    row = dict(p)
                    row.setdefault("_author_slug", "")
                    row.setdefault("_url_key", str(i))
                    out.append(row)
            if out:
                return out

    if any(k in data for k in ("href", "title", "raw", "author")):
        row = dict(data)
        row.setdefault("_author_slug", "")
        row.setdefault("_url_key", "")
        out.append(row)
    return out


def count_json_records(data: Any) -> int:
    """从解析后的 JSON 估算「记录条数」。"""
    flat = extract_posts_flat(data)
    if flat:
        return len(flat)
    if data is None:
        return 0
    if isinstance(data, list):
        return len(data)
    if isinstance(data, dict):
        for k in _LIST_KEYS:
            v = data.get(k)
            if isinstance(v, list):
                return len(v)
        return 0
    return 0


def _resolve_path(raw: str, root_dir: Path) -> Path:
    p = Path(raw).expanduser()
    if not p.is_absolute():
        p = (root_dir / p).resolve()
    return p


def read_json_file(path: Path) -> tuple[Any | None, str | None]:
    if not path.is_file():
        return None, "file_not_found"
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
        data = json.loads(text)
        return data, None
    except json.JSONDecodeError as exc:
        return None, f"json_error: {exc}"
    except OSError as exc:
        return None, f"io_error: {exc!r}"


class DataViewsBrowseStore:
    def __init__(self, state_path: Path) -> None:
        self._path = state_path
        self._path.parent.mkdir(parents=True, exist_ok=True)

    def _load(self) -> dict[str, Any]:
        if not self._path.is_file():
            return {"browsed": {}}
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8", errors="replace"))
            if not isinstance(raw, dict):
                return {"browsed": {}}
            b = raw.get("browsed")
            if not isinstance(b, dict):
                raw["browsed"] = {}
            return raw
        except Exception:
            return {"browsed": {}}

    def _save(self, data: dict[str, Any]) -> None:
        self._path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    def get_browsed(self, view_id: str) -> int:
        b = self._load()["browsed"]
        v = b.get(view_id, 0)
        try:
            return max(0, int(v))
        except (TypeError, ValueError):
            return 0

    def set_browsed(self, view_id: str, count: int) -> int:
        data = self._load()
        n = max(0, int(count))
        data["browsed"][view_id] = n
        self._save(data)
        return n


def build_view_stat(
    view: dict[str, Any],
    *,
    root_dir: Path,
    browse_store: DataViewsBrowseStore,
) -> dict[str, Any]:
    vid = str(view.get("id") or "").strip()
    name = str(view.get("name") or vid or "未命名").strip()
    path_raw = str(view.get("path") or "").strip()
    path = _resolve_path(path_raw, root_dir) if path_raw else Path()

    browsed = browse_store.get_browsed(vid) if vid else 0

    out: dict[str, Any] = {
        "id": vid,
        "name": name,
        "path": path_raw,
        "resolved_path": str(path) if path_raw else "",
        "file_exists": path.is_file() if path_raw else False,
        "record_count": 0,
        "browsed_count": browsed,
        "unread_count": 0,
        "file_mtime": None,
        "file_mtime_iso": None,
        "error": None,
    }

    if not path_raw:
        out["error"] = "empty_path"
        return out

    if not path.is_file():
        out["error"] = "file_not_found"
        out["unread_count"] = 0
        return out

    try:
        st = path.stat()
        out["file_mtime"] = int(st.st_mtime)
        out["file_mtime_iso"] = datetime.fromtimestamp(st.st_mtime).strftime(
            "%Y-%m-%d %H:%M:%S"
        )
    except OSError:
        pass

    data, err = read_json_file(path)
    if err:
        out["error"] = err
        return out

    n = count_json_records(data)
    out["record_count"] = n
    out["unread_count"] = max(0, n - browsed)
    return out


def list_data_view_stats(
    views: list[dict[str, Any]],
    *,
    root_dir: Path,
    browse_store: DataViewsBrowseStore,
) -> list[dict[str, Any]]:
    return [build_view_stat(v, root_dir=root_dir, browse_store=browse_store) for v in views]


def get_data_view_posts(
    view: dict[str, Any],
    *,
    root_dir: Path,
    limit: int = 200,
    offset: int = 0,
) -> dict[str, Any]:
    """读取 JSON 并返回扁平帖子分页（供前端表格展示）。"""
    path_raw = str(view.get("path") or "").strip()
    if not path_raw:
        raise ValueError("data_views[].path 不能为空")
    path = _resolve_path(path_raw, root_dir)
    if not path.is_file():
        raise FileNotFoundError(str(path))
    data, err = read_json_file(path)
    if err:
        raise ValueError(err)
    items = extract_posts_flat(data)
    if items:
        items.sort(
            key=lambda r: (
                str(r.get("published_iso") or ""),
                str(r.get("published_at") or ""),
                str(r.get("href") or ""),
            ),
            reverse=True,
        )
    total = len(items)
    limit = max(1, min(int(limit), 500))
    offset = max(0, int(offset))
    page = items[offset : offset + limit]
    version = data.get("version") if isinstance(data, dict) else None
    return {
        "items": page,
        "total": total,
        "offset": offset,
        "limit": limit,
        "version": version,
    }
