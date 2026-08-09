#!/usr/bin/env node
/**
 * 统一开发入口：公共端口 3007
 *   /operate-tools      → 运营工具（Vite）
 *   /json-eth-overview  → Remotion Studio 工程（内部 3008 反代）
 */
import { spawn, execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_PORT = 3007;
const STUDIO_PORT = 3008;

function killPort(port) {
  try {
    const out = execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`, {
      encoding: "utf8",
    }).trim();
    for (const pid of out.split("\n").filter(Boolean)) {
      try {
        process.kill(Number(pid), "SIGKILL");
        console.log(`[dev] killed pid ${pid} on :${port}`);
      } catch {
        /* already gone */
      }
    }
  } catch {
    /* nothing listening */
  }
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitStudioReady(maxMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${STUDIO_PORT}/`, {
        signal: AbortSignal.timeout(1500),
      });
      if (res.ok || res.status === 304) return;
    } catch {
      /* retry */
    }
    await wait(400);
  }
  throw new Error(`Remotion Studio 未在 :${STUDIO_PORT} 就绪`);
}

killPort(PUBLIC_PORT);
killPort(STUDIO_PORT);
await wait(300);

console.log(`[dev] starting Remotion Studio on :${STUDIO_PORT} …`);
const studio = spawn(
  process.platform === "win32" ? "pnpm.cmd" : "pnpm",
  ["exec", "remotion", "studio", "--port", String(STUDIO_PORT), "--no-open"],
  {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, BROWSER: "none" },
  }
);

studio.on("exit", (code) => {
  if (code && code !== 0) {
    console.error(`[dev] Remotion Studio exited: ${code}`);
  }
});

try {
  await waitStudioReady();
} catch (e) {
  studio.kill("SIGKILL");
  console.error(e);
  process.exit(1);
}

console.log(`[dev] starting gateway on :${PUBLIC_PORT} …`);
const vite = await createServer({
  configFile: path.join(ROOT, "vite.unified.config.ts"),
  root: path.join(ROOT, "operate-app"),
});
await vite.listen();
vite.printUrls();

console.log(`
[dev] ready
  http://localhost:${PUBLIC_PORT}/operate-tools/
  http://localhost:${PUBLIC_PORT}/json-eth-overview
`);

const shutdown = async () => {
  console.log("\n[dev] shutting down…");
  try {
    await vite.close();
  } catch {
    /* */
  }
  try {
    studio.kill("SIGTERM");
  } catch {
    /* */
  }
  killPort(PUBLIC_PORT);
  killPort(STUDIO_PORT);
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
