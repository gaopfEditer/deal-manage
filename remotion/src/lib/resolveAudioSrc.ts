import { staticFile } from "remotion";

/**
 * 工程 JSON 里 `assets.audio`：
 * - 写 `tts_output.mp3` 等相对 `public/` 的路径 → 走 `staticFile`，Studio 与 CLI 渲染都会正确预取。
 * - 写完整 `http(s)://...` → 原样使用（须对 Remotion 进程可达；`localhost` 在单独 render 时常不可用）。
 */
export function resolveAudioSrc(raw: string | undefined): string | undefined {
	const s = raw?.trim();
	if (!s) return undefined;
	if (/^https?:\/\//i.test(s)) return s;
	const path = s.replace(/^\/+/, "");
	if (!path) return undefined;
	return staticFile(path);
}
