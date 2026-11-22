import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
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
let token = "";

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

async function waitForServer(timeout = 20000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const r = await retryFetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch {
      /* not ready */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server did not start");
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return { "X-DevDeck-Token": token, ...(extra ?? {}) };
}

function api(path: string, init: RequestInit = {}): Promise<Response> {
  return retryFetch(BASE + path, {
    ...init,
    headers: authHeaders(init.headers as Record<string, string> | undefined),
  });
}

async function firstChunk(res: Response): Promise<{ reader: ReadableStreamDefaultReader<Uint8Array>; text: string }> {
  const reader = res.body!.getReader();
  const { value } = await reader.read();
  return { reader, text: new TextDecoder().decode(value) };
}

before(async () => {
  assert.ok(existsSync(CLI), "dist/cli.js 不存在，请先 npm run build");
  child = spawn(process.execPath, [CLI, "ui", "-p", String(PORT), "--no-open"], {
    env: { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome },
    stdio: "ignore",
    windowsHide: true,
  });
  await waitForServer();
  const html = await (await fetch(`${BASE}/`)).text();
  const match = html.match(/name="devdeck-token"\s+content="([^"]+)"/);
  assert.ok(match, "页面应包含 devdeck token");
  token = match[1]!;
});

after(() => {
  if (child) child.kill();
  try {
    rmSync(tmpHome, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

test("E2E: GET / 返回单文件控制台 HTML 与令牌", async () => {
  const r = await retryFetch(`${BASE}/`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") ?? "", /text\/html/);
  assert.match(r.headers.get("content-security-policy") ?? "", /default-src/);
  const html = await r.text();
  assert.ok(html.includes("DevDeck"));
  assert.ok(html.includes("端口监管控制台"));
  assert.match(html, /name="devdeck-token"/);
  assert.doesNotMatch(html, /<script[^>]+src\s*=/i);
});

test("E2E: favicon 204，避免控制台 404", async () => {
  const r = await retryFetch(`${BASE}/favicon.ico`);
  assert.equal(r.status, 204);
});

test("E2E: API 必须携带启动令牌", async () => {
  const unauth = await retryFetch(`${BASE}/api/config`);
  assert.equal(unauth.status, 401);
  const ok = await api("/api/config");
  assert.equal(ok.status, 200);
  const data = (await ok.json()) as { config: { favorites: number[] }; configPath: string };
  assert.ok(Array.isArray(data.config.favorites));
  assert.ok(data.configPath.includes(".devdeck.json"));
});

test("E2E: 非法 Origin 被拒绝", async () => {
  const r = await retryFetch(`${BASE}/api/config`, {
    headers: authHeaders({ Origin: "http://evil.example" }),
  });
  assert.equal(r.status, 403);
});

test("E2E: GET /api/ports 能扫描到自身控制台端口", async () => {
  const r = await api("/api/ports?scope=all");
  assert.equal(r.status, 200);
  const d = (await r.json()) as {
    ports: Array<{ port: number; pid: number; process: string; protocol: string; firstSeen: number; category: string }>;
    stats: { total: number };
    meta: { durationMs: number; platform: string };
  };
  assert.ok(Array.isArray(d.ports));
  assert.ok(d.ports.length > 0, "端口列表不应为空");
  assert.ok(d.ports.some((p) => p.port === PORT), `应包含控制台端口 ${PORT}`);
  assert.equal(typeof d.stats.total, "number");
  assert.equal(typeof d.meta.durationMs, "number");
  for (const p of d.ports) {
    assert.equal(typeof p.port, "number");
    assert.equal(typeof p.pid, "number");
    assert.equal(typeof p.process, "string");
    assert.equal(typeof p.firstSeen, "number");
    assert.ok(["tcp", "udp"].includes(p.protocol));
    assert.ok(["dev", "db", "cache", "other"].includes(p.category));
  }
});

test("E2E: GET/PUT /api/config 读写、校验与 Content-Type", async () => {
  const r2 = await api("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ favorites: [8080, 8080], interval: 5 }),
  });
  const c2 = (await r2.json()) as { ok: boolean; config: { favorites: number[]; interval: number } };
  assert.equal(c2.ok, true);
  assert.deepEqual(c2.config.favorites, [8080]);
  assert.equal(c2.config.interval, 5);

  const bad = await api("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ webhookUrl: "file:///etc/passwd" }),
  });
  assert.equal(bad.status, 400);

  const wrongType = await api("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ favorites: [] }),
  });
  assert.equal(wrongType.status, 415);

  const sameSite = await api("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-site" },
    body: JSON.stringify({}),
  });
  assert.equal(sameSite.status, 403);
});

test("E2E: POST /api/kill 无令牌 401、text/plain 415、无效 PID 正确失败", async () => {
  const noToken = await retryFetch(`${BASE}/api/kill`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pids: [999999999] }),
  });
  assert.equal(noToken.status, 401);

  const plain = await retryFetch(`${BASE}/api/kill`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "text/plain" }),
    body: JSON.stringify({ pids: [999999999] }),
  });
  assert.equal(plain.status, 415);

  const invalid = await api("/api/kill", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pids: [999999999] }),
  });
  const d = (await invalid.json()) as { ok: boolean; results: Array<{ ok: boolean }> };
  assert.equal(d.ok, false);
  assert.equal(d.results[0]?.ok, false);

  const empty = await api("/api/kill", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const e = (await empty.json()) as { ok: boolean };
  assert.equal(e.ok, false);

  const protectedPid = await api("/api/kill", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pids: [4] }),
  });
  const p = (await protectedPid.json()) as { results: Array<{ ok: boolean; message?: string }> };
  assert.equal(p.results[0]?.ok, false);
  assert.match(p.results[0]?.message ?? "", /系统关键进程|不在当前端口扫描/);

  const notListening = await api("/api/kill", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pids: [999998] }),
  });
  const n = (await notListening.json()) as { results: Array<{ ok: boolean; message?: string }> };
  assert.equal(n.results[0]?.ok, false);
  assert.match(n.results[0]?.message ?? "", /不在当前端口扫描|系统关键进程/);
});

test("E2E: 未知 API 404", async () => {
  const r = await api("/api/does-not-exist");
  assert.equal(r.status, 404);
});

test("E2E: 导出 CSV/JSON/MD/HTML/XLS", async () => {
  const csv = await (await api("/api/export?format=csv&scope=all")).text();
  assert.ok(csv.includes("port,protocol,address,process,pid"));
  const json = (await (await api("/api/export?format=json&scope=all")).json()) as { ports: unknown[] };
  assert.ok(Array.isArray(json.ports));
  const md = await (await api("/api/export?format=md&scope=all")).text();
  assert.ok(md.includes("# DevDeck 端口报告"));
  const html = await (await api("/api/export?format=html&scope=all")).text();
  assert.ok(html.includes("<!DOCTYPE html>"));
  const xls = await (await api("/api/export?format=xls&scope=all")).text();
  assert.ok(xls.includes("Workbook"));
  assert.ok(xls.includes('encoding="UTF-8"'));
});

test("E2E: 历史、审计、系统信息、连接统计、扫描统计", async () => {
  const history = (await (await api("/api/history")).json()) as { events: unknown[] };
  assert.ok(Array.isArray(history.events));
  const audit = (await (await api("/api/audit")).json()) as { events: unknown[] };
  assert.ok(Array.isArray(audit.events));
  const sys = (await (await api("/api/sysinfo")).json()) as { hostname: string; cpuCount: number; totalMemMB: number; processUptimeSec: number };
  assert.equal(typeof sys.hostname, "string");
  assert.ok(sys.cpuCount > 0);
  assert.ok(sys.totalMemMB > 0);
  assert.equal(typeof sys.processUptimeSec, "number");
  const conn = (await (await api("/api/connections")).json()) as { listening: number };
  assert.ok(conn.listening > 0);
  const stats = (await (await api("/api/stats")).json()) as { count: number; recent: number[] };
  assert.ok(stats.count >= 0);
  assert.ok(Array.isArray(stats.recent));
});

test("E2E: SSE 正常推送与暂停模式", async () => {
  const c1 = new AbortController();
  const r1 = await retryFetch(`${BASE}/api/events?token=${encodeURIComponent(token)}&interval=1&scope=all`, { signal: c1.signal });
  assert.equal(r1.status, 200);
  assert.ok((r1.headers.get("content-type") ?? "").includes("text/event-stream"));
  const one = await firstChunk(r1);
  await one.reader.cancel();
  c1.abort();
  assert.ok(one.text.includes("retry:") || one.text.includes("data:"));

  const c2 = new AbortController();
  const r2 = await retryFetch(`${BASE}/api/events?token=${encodeURIComponent(token)}&interval=0&scope=all`, { signal: c2.signal });
  const paused = await firstChunk(r2);
  assert.ok(paused.text.includes("retry:"));
  const gotData = await Promise.race([
    paused.reader.read().then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1200)),
  ]);
  await paused.reader.cancel();
  c2.abort();
  assert.equal(gotData, false, "暂停模式不应推送 data 帧");
});

test("E2E: probe 本机/批量/非法 host", async () => {
  const self = (await (await api(`/api/probe?host=127.0.0.1&port=${PORT}`)).json()) as { ok: boolean; port: number };
  assert.equal(self.ok, true);
  assert.equal(self.port, PORT);
  const batch = (await (await api(`/api/probe?host=127.0.0.1&ports=${PORT},59999`)).json()) as { results: Array<{ port: number; ok: boolean }> };
  assert.equal(batch.results.length, 2);
  assert.equal(batch.results.find((x) => x.port === PORT)?.ok, true);
  const bad = await api("/api/probe?host=bad%20host&ports=1");
  assert.equal(bad.status, 400);
});

test("E2E: suggest-port 与 export-history", async () => {
  const suggest = (await (await api("/api/suggest-port?port=59999")).json()) as { available: boolean; suggestion: number };
  assert.equal(suggest.available, true);
  const range = (await (await api("/api/suggest-port?start=59000&end=59010")).json()) as { free: number[] };
  assert.ok(range.free.length > 0);
  const historyCsv = await (await api("/api/export-history?format=csv")).text();
  assert.ok(historyCsv.includes("time,type,port,protocol,address,pid,process"));
});

test("E2E: 定时快照与报告独立生效并落盘", async () => {
  const set = await api("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ snapshotInterval: 1, reportInterval: 1 }),
  });
  assert.equal(set.status, 200);
  await new Promise((r) => setTimeout(r, 1800));
  assert.ok(existsSync(join(tmpHome, ".devdeck-snapshots")), "快照目录应创建");
  assert.ok(existsSync(join(tmpHome, ".devdeck-reports")), "报告目录应创建");
  assert.ok(readdirSync(join(tmpHome, ".devdeck-snapshots")).some((f) => f.startsWith("snap-")));
  assert.ok(readdirSync(join(tmpHome, ".devdeck-reports")).some((f) => f.startsWith("health-")));
  await api("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ snapshotInterval: 0, reportInterval: 0 }),
  });
});

test("E2E: health 无令牌可用", async () => {
  const r = await retryFetch(`${BASE}/api/health`);
  assert.equal(r.status, 200);
  const d = (await r.json()) as { ok: boolean; uptime: number };
  assert.equal(d.ok, true);
  assert.equal(typeof d.uptime, "number");
});

test("E2E: CLI scan/version/export/check/kill-port/free", () => {
  const scan = spawnSync(process.execPath, [CLI, "scan", "--all", "--no-color"], { encoding: "utf-8", timeout: 30000 });
  assert.equal(scan.status, 0);
  assert.ok((scan.stdout ?? "").includes("DevDeck"));
  assert.ok((scan.stdout ?? "").includes(String(PORT)), `CLI scan 应包含 ${PORT}`);

  const version = spawnSync(process.execPath, [CLI, "version"], { encoding: "utf-8", timeout: 15000 });
  assert.equal(version.status, 0);
  assert.match(version.stdout ?? "", /DevDeck v0\.8\.0/);

  const out = join(tmpdir(), `devdeck-export-${Date.now()}.csv`);
  const exp = spawnSync(process.execPath, [CLI, "export", "--all", "--out", out], { encoding: "utf-8", timeout: 30000 });
  assert.equal(exp.status, 0);
  assert.ok(existsSync(out));
  assert.ok(readFileSync(out, "utf-8").includes("port,protocol,address,process,pid"));
  rmSync(out, { force: true });

  const occupied = spawnSync(process.execPath, [CLI, "check", String(PORT)], { encoding: "utf-8", timeout: 30000 });
  assert.equal(occupied.status, 1);
  assert.ok((occupied.stdout ?? "").includes("被占用"));

  const free = spawnSync(process.execPath, [CLI, "check", "59999"], { encoding: "utf-8", timeout: 30000 });
  assert.equal(free.status, 0);
  assert.ok((free.stdout ?? "").includes("空闲"));

  const killMissing = spawnSync(process.execPath, [CLI, "kill-port", "59999"], { encoding: "utf-8", timeout: 30000 });
  assert.equal(killMissing.status, 1);
  assert.ok((killMissing.stderr || killMissing.stdout).includes("未被监听"));

  const range = spawnSync(process.execPath, [CLI, "free", "59000", "59010"], { encoding: "utf-8", timeout: 30000 });
  assert.equal(range.status, 0);
  assert.ok((range.stdout ?? "").includes("空闲"));
});

test("E2E: config customPorts 去重过滤与 Webhook 校验", async () => {
  const r = await api("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customPorts: [1, 2, 2, 99999], webhookUrl: "" }),
  });
  const d = (await r.json()) as { config: { customPorts: number[] } };
  assert.deepEqual(d.config.customPorts, [1, 2]);
});