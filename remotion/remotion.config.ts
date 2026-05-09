import { existsSync } from "node:fs";
import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
// MP4（H.264 + AAC + yuv420p）在播放器与平台上兼容性最好
Config.setCodec("h264");
Config.setAudioCodec("aac");
Config.setPixelFormat("yuv420p");

// Studio 内点「Render」走的是配置里的浏览器路径；`--browser-executable-path` 不是 Remotion 支持的参数名（应为 `--browser-executable`），且未必传给 Studio。
const browserFromEnv =
	process.env.REMOTION_BROWSER_EXECUTABLE?.trim() ||
	process.env.CHROME_PATH?.trim();
const winDefaultChrome =
	"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const browserExecutable =
	browserFromEnv ||
	(process.platform === "win32" ? winDefaultChrome : "");

if (browserExecutable && existsSync(browserExecutable)) {
	Config.setBrowserExecutable(browserExecutable);
}
