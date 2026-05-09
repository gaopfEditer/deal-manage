import React from "react";
import { Composition, staticFile } from "remotion";
import { JsonDriven, calculateJsonDrivenMetadata } from "./compositions/JsonDriven";
import { REMOTION_PROJECTS } from "./projectRegistry";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {REMOTION_PROJECTS.map((p) => (
        <Composition
          key={p.id}
          id={p.id}
          component={JsonDriven}
          defaultProps={{
            projectJsonUrl: staticFile(p.publicJson),
            compositionTitle: p.name,
          }}
          calculateMetadata={calculateJsonDrivenMetadata}
          durationInFrames={300}
          fps={30}
          width={1080}
          height={1920}
        />
      ))}
    </>
  );
};
