import type { VideoProject } from "./types";

export async function loadProjectFromUrl(url: string): Promise<VideoProject> {
  const res = await fetch(url);
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
