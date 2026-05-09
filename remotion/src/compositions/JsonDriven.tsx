import React from "react";
import type { CalculateMetadataFunction } from "remotion";
import { staticFile } from "remotion";
import { getAudioDurationInSeconds } from "@remotion/media-utils";
import { Timeline } from "../timeline/Timeline";
import { assertProjectShape, loadProjectFromUrl } from "../lib/loadProject";
import type { VideoProject } from "../lib/types";

export type JsonDrivenProps = {
  /** `staticFile('sample-project.json')` 或任意可 fetch 的 JSON URL */
  projectJsonUrl: string;
  /** 与 projectRegistry 中 name 对应，便于片头/水印或自建 UI 使用 */
  compositionTitle?: string;
  /** 由 calculateMetadata 注入；开发占位可为空 */
  project?: VideoProject;
};

export const calculateJsonDrivenMetadata: CalculateMetadataFunction<JsonDrivenProps> = async ({
  props,
}) => {
  const url = props.projectJsonUrl?.trim() || staticFile("sample-project.json");
  const project = await loadProjectFromUrl(url);
  assertProjectShape(project);

  const fps = Math.max(1, project.metadata.fps);
  let durationInFrames = Math.max(1, project.metadata.durationInFrames);

  const audio = project.assets?.audio?.trim();
  if (audio && /^https?:\/\//i.test(audio)) {
    try {
      const seconds = await getAudioDurationInSeconds(audio);
      const fromAudio = Math.ceil(seconds * fps);
      durationInFrames = Math.max(durationInFrames, fromAudio);
    } catch {
      // 渲染前音频不可达时保留 JSON 时长，避免 calculateMetadata 直接失败
    }
  }

  return {
    durationInFrames,
    fps,
    width: Math.max(2, project.metadata.width),
    height: Math.max(2, project.metadata.height),
    props: {
      ...props,
      project,
    },
  };
};

export const JsonDriven: React.FC<JsonDrivenProps> = ({ project }) => {
  if (!project) {
    return null;
  }
  return <Timeline project={project} />;
};
