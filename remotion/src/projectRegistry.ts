/**
 * 多工程注册表：每个条目对应 Root 里一个 Composition（独立 id，Studio 左侧列表可切换）。
 * `publicJson` 为 public 目录下文件名（由 staticFile 解析）。
 */
export type RemotionProjectEntry = {
  /** Remotion Composition id（建议 kebab-case，无空格） */
  id: string;
  /** 给人看的名称；CLI/自建列表切换时用（Studio 侧栏通常显示 id） */
  name: string;
  /** 相对 Remotion/public，例如 sample-project.json */
  publicJson: string;
};

export const REMOTION_PROJECTS: RemotionProjectEntry[] = [
  {
    id: "json-eth-overview",
    name: "主示例 · ETH / K 线 / 维加斯",
    publicJson: "sample-project.json",
  },
  {
    id: "json-short-demo",
    name: "短版演示 · 轻时间轴",
    publicJson: "sample-project-short.json",
  },
];
