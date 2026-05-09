declare module "echarts/dist/echarts.js" {
  // dist 入口无独立 .d.ts，类型与主包 `echarts` 一致
  import * as ec from "echarts";
  export = ec;
}
