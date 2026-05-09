import React from "react";
import { AbsoluteFill, Audio, Sequence } from "remotion";
import { resolveAudioSrc } from "../lib/resolveAudioSrc";
import type { VideoProject } from "../lib/types";
import { TextAnnotation } from "./elements/TextAnnotation";
import { AiAssistantCat } from "./elements/AiAssistantCat";
import { IconBadge } from "./elements/IconBadge";
import { EchartPanel } from "./elements/EchartPanel";

type Props = {
  project: VideoProject;
};

export const Timeline: React.FC<Props> = ({ project }) => {
  const audioSrc = resolveAudioSrc(project.assets?.audio);

  return (
    <AbsoluteFill style={{ background: "#050814" }}>
      {audioSrc ? <Audio src={audioSrc} /> : null}
      {project.timeline.map((layer, idx) => {
        const duration = Math.max(1, layer.endFrame - layer.startFrame);
        return (
          <Sequence
            key={`${layer.type}-${idx}-${layer.startFrame}`}
            from={layer.startFrame}
            durationInFrames={duration}
            name={layer.type}
          >
            {layer.type === "text_annotation" ? (
              <TextAnnotation layer={layer} />
            ) : layer.type === "ai_assistant_cat" ? (
              <AiAssistantCat layer={layer} />
            ) : layer.type === "icon_badge" ? (
              <IconBadge layer={layer} />
            ) : layer.type === "echart_panel" ? (
              <EchartPanel layer={layer} durationInFrames={duration} />
            ) : null}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
