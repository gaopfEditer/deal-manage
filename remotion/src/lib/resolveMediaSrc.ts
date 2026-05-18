import { staticFile } from "remotion";

/** 解析 public 相对路径或完整 URL，供聊天头像、图片消息等使用 */
export function resolveMediaSrc(raw: string | undefined): string | undefined {
	const s = raw?.trim();
	if (!s) return undefined;
	if (/^https?:\/\//i.test(s)) return s;
	const path = s.replace(/^\/+/, "");
	if (!path) return undefined;
	return staticFile(path);
}
