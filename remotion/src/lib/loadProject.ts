import type { VideoProject } from "./types";

export async function loadProjectFromUrl(url: string): Promise<VideoProject> {
  // 避开浏览器/Studio 对 public JSON 的缓存，改 sample-project 后才能立刻生效
  const bust = url.includes("?") ? `${url}&_=${Date.now()}` : `${url}?_=${Date.now()}`;
  const res = await fetch(bust, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to load project JSON: ${res.status} ${url}`);
  }
  return (await res.json()) as VideoProject;
}

export function assertProjectShape(data: unknown): asserts data is VideoProject {
  if (!data || typeof data !== "object") throw new Error("Invalid project: not an object");
  const p = data as VideoProject;
  if (!p.metadata || typeof p.metadata.fps !== "number") {
    throw new Error("Invalid project: metadata.fps required");
  }
  if (!Array.isArray(p.timeline)) throw new Error("Invalid project: timeline must be an array");
}
