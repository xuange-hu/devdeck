import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const CLI = join(ROOT, "dist", "cli.js");
const PORT = 18770;
const BASE = `http://127.0.0.1:${PORT}`;
const tmpHome = mkdtempSync(join(tmpdir(), "devdeck-e2e-"));

let child: ReturnType<typeof spawn> | null = null;

async function waitForServer(timeout = 20000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const r = await retryFetch(`${BASE}/api/config`);
      if (r.ok) return;
    } catch {
      /* not ready */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server did not start");
}

// 前面的 spawnSync 用例会阻塞事件循环数秒，undici 复用的 keep-alive 连接
// 可能已被服务端空闲超时关闭，下一发 fetch 直接 ECONNRESET；重试一次走新连接即可
async function retryFetch(url: string, init?: RequestInit, retries = 2): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") throw err;
      lastErr = err;
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  throw lastErr;
}

before(async () => {
  assert.ok(existsSync(CLI), "dist/cli.js 不存在，请先 npm run build");
  child = spawn(process.execPath, [CLI, "ui", "-p", String(PORT), "--no-open"], {
    env: { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome },
    stdio: "ignore",
    windowsHide: true,
  });
  await waitForServer();
});

after(() => {
  if (child) child.kill();
  try {
    rmSync(tmpHome, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

test("E2E: GET / 返回控制台 HTML", async () => {
  const r = await retryFetch(`${BASE}/`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") ?? "", /text\/html/);
  const html = await r.text();
  assert.ok(html.includes("DevDeck"));
  assert.ok(html.includes("端口监管控制台"));
});

test("E2E: GET /api/ports 返回列表与统计", async () => {
  const r = await retryFetch(`${BASE}/api/ports?scope=all`);
  assert.equal(r.status, 200);
  const d = (await r.json()) as {
    ports: Array<{ port: number; pid: number; process: string; firstSeen: number; category: string }>;
    stats: { total: number };
    meta: { durationMs: number; platform: string };
  };
  assert.ok(Array.isArray(d.ports));
  assert.equal(typeof d.stats.total, "number");
  assert.equal(typeof d.meta.durationMs, "number");
  for (const p of d.ports) {
    assert.equal(typeof p.port, "number");
    assert.equal(typeof p.pid, "number");
    assert.equal(typeof p.process, "string");
    assert.equal(typeof p.firstSeen, "number");
    assert.ok(["dev", "db", "cache", "other"].includes(p.category));
  }
});

test("E2E: GET/PUT /api/config 读写与校验", async () => {
  const r1 = await retryFetch(`${BASE}/api/config`);
  const c1 = (await r1.json()) as { config: { favorites: number[] } };
  assert.ok(Array.isArray(c1.config.favorites));
  const r2 = await retryFetch(`${BASE}/api/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ favorites: [8080, 8080], interval: 5 }),
  });
  const c2 = (await r2.json()) as { ok: boolean; config: { favorites: number[]; interval: number } };
  assert.equal(c2.ok, true);
  assert.deepEqual(c2.config.favorites, [8080]);
  assert.equal(c2.config.interval, 5);
});

test("E2E: GET /api/history 返回事件数组", async () => {
  const r = await retryFetch(`${BASE}/api/history`);
  assert.equal(r.status, 200);
  const d = (await r.json()) as { events: unknown[] };
  assert.ok(Array.isArray(d.events));
});

test("E2E: GET /api/export 支持 CSV 与 JSON", async () => {
  const rc = await retryFetch(`${BASE}/api/export?format=csv&scope=all`);
  assert.equal(rc.status, 200);
  const csv = await rc.text();
  assert.ok(csv.includes("port,process,pid"));
  const rj = await retryFetch(`${BASE}/api/export?format=json&scope=all`);
  const json = (await rj.json()) as { ports: unknown[] };
  assert.ok(Array.isArray(json.ports));
});

test("E2E: POST /api/kill 无效 PID 正确报错", async () => {
  const r = await retryFetch(`${BASE}/api/kill`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pids: [999999999] }),
  });
  const d = (await r.json()) as { ok: boolean };
  assert.equal(d.ok, false);
  const r2 = await retryFetch(`${BASE}/api/kill`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const d2 = (await r2.json()) as { ok: boolean };
  assert.equal(d2.ok, false);
});

test("E2E: 未知 API 返回 404", async () => {
  const r = await retryFetch(`${BASE}/api/does-not-exist`);
  assert.equal(r.status, 404);
});

test("E2E: CLI scan 退出码 0 且输出表头", () => {
  const r = spawnSync(process.execPath, [CLI, "scan", "--all", "--no-color"], {
    encoding: "utf-8",
    timeout: 30000,
  });
  assert.equal(r.status, 0);
  assert.ok((r.stdout ?? "").includes("DevDeck"));
});

test("E2E: CLI version 输出版本号", () => {
  const r = spawnSync(process.execPath, [CLI, "version"], { encoding: "utf-8", timeout: 15000 });
  assert.equal(r.status, 0);
  assert.match(r.stdout ?? "", /DevDeck v\d+\.\d+\.\d+/);
});

test("E2E: CLI export 生成 CSV 文件", () => {
  const out = join(tmpdir(), `devdeck-export-${Date.now()}.csv`);
  const r = spawnSync(process.execPath, [CLI, "export", "--all", "--out", out], {
    encoding: "utf-8",
    timeout: 30000,
  });
  assert.equal(r.status, 0);
  assert.ok(existsSync(out), "导出文件应存在");
  const content = readFileSync(out, "utf-8");
  assert.ok(content.includes("port,process,pid"), "CSV 应包含表头");
  rmSync(out, { force: true });
});

test("E2E: GET /api/health 健康检查", async () => {
  const r = await retryFetch(`${BASE}/api/health`);
  assert.equal(r.status, 200);
  const d = (await r.json()) as { ok: boolean; uptime: number; timestamp: number };
  assert.equal(d.ok, true);
  assert.equal(typeof d.uptime, "number");
  assert.equal(typeof d.timestamp, "number");
});

test("E2E: SSE /api/events 推送", async () => {
  const controller = new AbortController();
  const r = await retryFetch(`${BASE}/api/events`, { signal: controller.signal });
  assert.equal(r.status, 200);
  assert.ok((r.headers.get("content-type") ?? "").includes("text/event-stream"));
  const reader = r.body!.getReader();
  const { value } = await reader.read();
  const text = new TextDecoder().decode(value);
  try { controller.abort(); } catch {}
  assert.ok(text.includes("data:") || text.includes("retry:"));
});

test("E2E: /api/sysinfo 返回系统信息", async () => {
  const r = await retryFetch(`${BASE}/api/sysinfo`);
  const d = (await r.json()) as { hostname: string; cpuCount: number; totalMemMB: number; addresses: unknown[] };
  assert.equal(r.status, 200);
  assert.equal(typeof d.hostname, "string");
  assert.ok(d.cpuCount > 0);
  assert.ok(d.totalMemMB > 0);
  assert.ok(Array.isArray(d.addresses));
});

test("E2E: /api/probe 本机端口可连接", async () => {
  const r = await retryFetch(`${BASE}/api/probe?host=127.0.0.1&port=${PORT}`);
  const d = (await r.json()) as { ok: boolean; port: number; latencyMs: number };
  assert.equal(d.ok, true);
  assert.equal(d.port, PORT);
  assert.equal(typeof d.latencyMs, "number");
});

test("E2E: /api/probe 非法参数返回 400", async () => {
  const r = await retryFetch(`${BASE}/api/probe?host=bad host&port=0`);
  assert.equal(r.status, 400);
});

test("E2E: /api/audit 返回事件数组", async () => {
  const r = await retryFetch(`${BASE}/api/audit`);
  const d = (await r.json()) as { events: unknown[] };
  assert.ok(Array.isArray(d.events));
});

test("E2E: /api/export 支持 Markdown", async () => {
  const r = await retryFetch(`${BASE}/api/export?format=md&scope=all`);
  const t = await r.text();
  assert.ok(t.includes("# DevDeck 端口报告"));
  assert.ok(t.includes("| 端口 |"));
});

test("E2E: config customPorts 去重过滤", async () => {
  const r = await retryFetch(`${BASE}/api/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customPorts: [1, 2, 2, 99999] }),
  });
  const d = (await r.json()) as { config: { customPorts: number[] } };
  assert.deepEqual(d.config.customPorts, [1, 2]);
});

test("E2E: CLI kill-port 未监听端口报错", () => {
  const r = spawnSync(process.execPath, [CLI, "kill-port", "59999"], {
    encoding: "utf-8",
    timeout: 30000,
  });
  assert.ok((r.stderr || r.stdout).includes("未被监听"));
});

test("E2E: /api/connections 返回连接统计", async () => {
  const r = await fetch(`${BASE}/api/connections`);
  const d = (await r.json()) as { listening: number; established: number; timeWait: number };
  assert.equal(r.status, 200);
  assert.equal(typeof d.listening, "number");
  assert.equal(typeof d.established, "number");
  assert.ok(d.listening > 0);
});

test("E2E: /api/export 支持 HTML 报告", async () => {
  const r = await fetch(`${BASE}/api/export?format=html&scope=all`);
  const t = await r.text();
  assert.ok(t.includes("<!DOCTYPE html>"));
  assert.ok(t.includes("DevDeck 端口报告"));
});

test("E2E: CLI check 未监听端口返回空闲", () => {
  const r = spawnSync(process.execPath, [CLI, "check", "59999"], { encoding: "utf-8", timeout: 30000 });
  assert.ok((r.stdout || "").includes("空闲"));
  assert.equal(r.status, 0);
});

test("E2E: CLI check 监听端口返回占用", () => {
  const r = spawnSync(process.execPath, [CLI, "check", String(PORT)], { encoding: "utf-8", timeout: 30000 });
  assert.ok((r.stdout || "").includes("被占用"));
  assert.equal(r.status, 1);
});

test("E2E: /api/probe 批量探测", async () => {
  const r = await fetch(`${BASE}/api/probe?host=127.0.0.1&ports=${PORT},59999`);
  const d = (await r.json()) as { results: Array<{ port: number; ok: boolean }> };
  assert.ok(Array.isArray(d.results));
  assert.equal(d.results.length, 2);
  const self = d.results.find((x) => x.port === PORT);
  assert.equal(self?.ok, true);
});

test("E2E: /api/stats 扫描性能统计", async () => {
  const r = await fetch(`${BASE}/api/stats`);
  const d = (await r.json()) as { count: number; avgMs: number; recent: number[] };
  assert.equal(r.status, 200);
  assert.equal(typeof d.count, "number");
  assert.equal(typeof d.avgMs, "number");
  assert.ok(Array.isArray(d.recent));
});

test("E2E: /api/export-history 历史导出", async () => {
  const r = await fetch(`${BASE}/api/export-history?format=json`);
  const d = (await r.json()) as { events: unknown[] };
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(d.events));
});

test("E2E: /api/suggest-port 端口建议", async () => {
  const r = await fetch(`${BASE}/api/suggest-port?port=59999`);
  const d = (await r.json()) as { available: boolean; suggestion: number };
  assert.equal(r.status, 200);
  assert.equal(d.available, true);
  assert.equal(d.suggestion, 59999);
});

test("E2E: /api/export 支持 Excel XML", async () => {
  const r = await fetch(`${BASE}/api/export?format=xls&scope=all`);
  const t = await r.text();
  assert.ok(t.includes("Workbook"));
  assert.ok(t.includes("ss:Type"));
});

test("E2E: /api/suggest-port 范围查找", async () => {
  const r = await fetch(`${BASE}/api/suggest-port?start=59000&end=59010`);
  const d = (await r.json()) as { free: number[] };
  assert.ok(Array.isArray(d.free));
  assert.ok(d.free.length > 0);
});

test("E2E: CLI free 范围查找", () => {
  const r = spawnSync(process.execPath, [CLI, "free", "59000", "59010"], { encoding: "utf-8", timeout: 30000 });
  assert.equal(r.status, 0);
  assert.ok((r.stdout || "").includes("空闲"));
});
