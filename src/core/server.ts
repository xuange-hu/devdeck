import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  homedir,
  hostname,
  platform,
  arch,
  release,
  cpus,
  totalmem,
  freemem,
  loadavg,
  uptime,
  networkInterfaces,
} from "node:os";
import { randomBytes, timingSafeEqual } from "node:crypto";
import embeddedHtml from "../web/index.html";
import {
  COMMON_PORTS,
  killPort,
  listAllListening,
  processDetail,
  probeTcp,
  connectionStats,
  type PortEntry,
} from "./ports.js";
import { configPath, loadConfig, saveConfig, type DevDeckConfig } from "./config.js";
import {
  normalizeConfig,
  toCsv,
  toMarkdown,
  toHtml,
  toExcelXml,
  csvEscape,
} from "./serialize.js";

const SCAN_CACHE_TTL = 800;
const MAX_EVENTS = 300;
const MAX_ARTIFACTS = 200;
const MAX_SSE_CLIENTS = 32;
const HERE = (() => {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
})();

const HISTORY_PATH = join(homedir(), ".devdeck-history.json");
const AUDIT_PATH = join(homedir(), ".devdeck-audit.json");
const FIRST_SEEN_PATH = join(homedir(), ".devdeck-first-seen.json");
const LAST_PORTS_PATH = join(homedir(), ".devdeck-last-ports.json");
const SNAPSHOT_DIR = join(homedir(), ".devdeck-snapshots");
const REPORT_DIR = join(homedir(), ".devdeck-reports");

interface AuditEntry {
  time: number;
  action: string;
  detail: string;
}

interface PortEvent {
  time: number;
  type: "open" | "close";
  port: number;
  pid: number;
  process: string;
  protocol: "tcp" | "udp";
  address?: string;
}

interface ScanCache {
  at: number;
  dev: PortEntry[];
  all: PortEntry[];
  durationMs: number;
}

export interface RunningServer {
  port: number;
  token: string;
  stop: () => void;
  config: DevDeckConfig;
}

function entryKey(entry: { port: number; protocol: string; address?: string }): string {
  return `${entry.protocol}|${entry.address ?? ""}|${entry.port}`;
}

function json(res: ServerResponse, code: number, data: unknown) {
  if (res.headersSent) {
    try {
      res.end();
    } catch {
      /* ignore */
    }
    return;
  }
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(data));
}

function readJson(path: string): unknown {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown): void {
  try {
    writeFileSync(path, JSON.stringify(value), "utf-8");
  } catch {
    /* 持久化失败不影响服务 */
  }
}

function audit(action: string, detail: string): void {
  const raw = readJson(AUDIT_PATH);
  const list: AuditEntry[] = Array.isArray(raw)
    ? raw.filter(
        (e): e is AuditEntry =>
          Boolean(e) &&
          typeof (e as AuditEntry).time === "number" &&
          typeof (e as AuditEntry).action === "string" &&
          typeof (e as AuditEntry).detail === "string",
      )
    : [];
  list.unshift({ time: Date.now(), action, detail });
  if (list.length > 500) list.length = 500;
  writeJson(AUDIT_PATH, list);
}

function loadHistoryEvents(): PortEvent[] {
  const raw = readJson(HISTORY_PATH);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (e): e is PortEvent =>
        Boolean(e) &&
        typeof (e as PortEvent).time === "number" &&
        ((e as PortEvent).type === "open" || (e as PortEvent).type === "close") &&
        typeof (e as PortEvent).port === "number" &&
        Number.isInteger((e as PortEvent).port),
    )
    .map((e): PortEvent => ({
      ...e,
      pid: Number.isInteger(e.pid) ? e.pid : 0,
      process: typeof e.process === "string" ? e.process : "unknown",
      protocol: e.protocol === "udp" ? "udp" : "tcp",
      address: typeof e.address === "string" ? e.address : undefined,
    }))
    .slice(0, MAX_EVENTS);
}

function saveHistoryEvents(list: PortEvent[]): void {
  writeJson(HISTORY_PATH, list.slice(0, MAX_EVENTS));
}

function loadFirstSeen(): Map<number, number> {
  const raw = readJson(FIRST_SEEN_PATH);
  const map = new Map<number, number>();
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const port = Number(key);
      if (Number.isInteger(port) && port > 0 && port < 65536 && typeof value === "number") {
        map.set(port, value);
      }
    }
  }
  return map;
}

function saveFirstSeen(map: Map<number, number>): void {
  const obj: Record<string, number> = {};
  for (const [port, time] of map) obj[String(port)] = time;
  writeJson(FIRST_SEEN_PATH, obj);
}

function loadLastPorts(): { map: Map<string, PortEntry>; loaded: boolean } {
  const raw = readJson(LAST_PORTS_PATH);
  const map = new Map<string, PortEntry>();
  if (!Array.isArray(raw)) return { map, loaded: false };
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const e = item as PortEntry;
    if (
      !Number.isInteger(e.port) ||
      e.port <= 0 ||
      e.port > 65535 ||
      !Number.isInteger(e.pid) ||
      typeof e.process !== "string"
    ) {
      continue;
    }
    const protocol = e.protocol === "udp" ? "udp" : "tcp";
    const address = typeof e.address === "string" ? e.address : undefined;
    map.set(entryKey({ port: e.port, protocol, address }), {
      port: e.port,
      pid: e.pid,
      process: e.process,
      protocol,
      address,
      category: e.category === "dev" || e.category === "db" || e.category === "cache" ? e.category : "other",
      label: typeof e.label === "string" ? e.label : "",
    });
  }
  return { map, loaded: true };
}

function saveLastPorts(map: Map<string, PortEntry>): void {
  writeJson(LAST_PORTS_PATH, [...map.values()]);
}

let htmlTemplate: string | null = null;

async function getHtmlTemplate(): Promise<string> {
  if (htmlTemplate) return htmlTemplate;
  try {
    htmlTemplate = await readFile(join(HERE, "web", "index.html"), "utf-8");
  } catch {
    htmlTemplate = embeddedHtml;
  }
  return htmlTemplate;
}

function htmlHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  };
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > 64 * 1024) {
      try {
        req.destroy();
      } catch {
        /* ignore */
      }
      throw new Error("请求体过大");
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * 写接口守卫：挡掉"浏览器跨站简单请求"这一类 CSRF。
 *
 * 三条独立闸门，任意一条不满足即拒绝：
 *  1. Content-Type 必须是 application/json —— 跨站 <form>、text/plain 的
 *     fetch 无法在不触发 CORS 预检的前提下设置该类型，于是"钓鱼页盲打
 *     127.0.0.1 管理接口"这条路被物理掐断；
 *  2. Origin（浏览器一定会带）必须与 Host 同源；
 *  3. Sec-Fetch-Site（现代浏览器）只能是 same-origin / none。
 *
 * 早期版本只有一个"前端二次确认"，而前端弹窗对 CSRF 没有任何约束力。
 */
function guardWrite(req: IncomingMessage, res: ServerResponse): boolean {
  const ctype = String(req.headers["content-type"] ?? "").toLowerCase();
  if (!ctype.startsWith("application/json")) {
    json(res, 415, {
      ok: false,
      message: "写接口只接受 application/json（跨站简单请求一律拒绝）",
    });
    return false;
  }

  const origin = req.headers.origin;
  if (typeof origin === "string") {
    const host = String(req.headers.host ?? "");
    if (origin === "null" || origin !== `http://${host}`) {
      json(res, 403, { ok: false, message: "跨站写请求已被拒绝（Origin 校验失败）" });
      return false;
    }
  }

  const site = req.headers["sec-fetch-site"];
  if (typeof site === "string" && site !== "same-origin" && site !== "none") {
    json(res, 403, { ok: false, message: "跨站写请求已被拒绝（Sec-Fetch-Site 校验失败）" });
    return false;
  }

  return true;
}

/**
 * 系统关键进程黑名单：即使某进程正在监听端口，也不允许"一键释放"。
 * pid <= 4 覆盖 Windows 的 Idle(0)/System(4) 与 POSIX 的 init(1)/kthreadd(2)；
 * process.pid 是 devdeck 自己 —— 自我了断只会让排查更困难。
 */
const PROTECTED_PROCESS_NAMES = new Set([
  "system",
  "idle",
  "smss.exe",
  "csrss.exe",
  "wininit.exe",
  "winlogon.exe",
  "services.exe",
  "lsass.exe",
  "svchost.exe",
  "fontdrvhost.exe",
  "dwm.exe",
  "init",
  "kthreadd",
  "systemd",
  "launchd",
  "kernel_task",
]);

function isProtectedPid(pid: number, name: string): boolean {
  if (pid <= 4 || pid === process.pid) return true;
  return PROTECTED_PROCESS_NAMES.has(name.trim().toLowerCase());
}

async function sendWebhook(url: string, event: PortEvent): Promise<void> {
  if (!url) return;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
  try {
    await fetch(parsed, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    /* webhook 失败不影响主流程 */
  }
}

function allowedHost(host: string | undefined): boolean {
  const value = (host ?? "").toLowerCase().replace(/:\d+$/, "");
  return value === "127.0.0.1" || value === "localhost" || value === "[::1]";
}

function validProbeHost(host: string): boolean {
  return host.length > 0 && host.length <= 255 && /^[a-zA-Z0-9._:\-\[\]]+$/.test(host);
}

function apiAccess(req: IncomingMessage, res: ServerResponse, url: URL, token: string): boolean {
  if (!allowedHost(req.headers.host)) {
    json(res, 403, { ok: false, message: "非法 Host" });
    return false;
  }
  const origin = req.headers.origin;
  if (origin) {
    const host = req.headers.host ?? "";
    if (origin !== `http://${host}` && origin !== `https://${host}`) {
      json(res, 403, { ok: false, message: "非法 Origin" });
      return false;
    }
  }
  if (req.headers["sec-fetch-site"] === "cross-site") {
    json(res, 403, { ok: false, message: "跨站请求被拒绝" });
    return false;
  }
  if (url.pathname !== "/api/health") {
    const raw = req.headers["x-devdeck-token"] ?? url.searchParams.get("token");
    const supplied = Array.isArray(raw) ? raw[0] : raw;
    const a = Buffer.from(String(supplied ?? ""));
    const b = Buffer.from(token);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      json(res, 401, { ok: false, message: "未授权" });
      return false;
    }
  }
  if (req.method === "POST" || req.method === "PUT") {
    const contentType = req.headers["content-type"] ?? "";
    if (!/^application\/json\b/i.test(contentType)) {
      json(res, 415, { ok: false, message: "Content-Type 必须为 application/json" });
      return false;
    }
  }
  return true;
}

export function startServer(defaultPort = 7676): Promise<RunningServer> {
  const config = loadConfig();
  const token = randomBytes(18).toString("hex");
  let cache: ScanCache | null = null;
  let inflight: Promise<ScanCache> | null = null;
  const last = loadLastPorts();
  const prevPorts = last.map;
  let initialized = last.loaded;
  const scanTimes: number[] = [];
  const events = loadHistoryEvents();
  const firstSeen = loadFirstSeen();
  let snapshotTimer: NodeJS.Timeout | null = null;
  let reportTimer: NodeJS.Timeout | null = null;
  let sseClients = 0;

  function prune(dir: string, prefix: string): void {
    try {
      const files = readdirSync(dir)
        .filter((f) => f.startsWith(prefix))
        .sort();
      while (files.length > MAX_ARTIFACTS) {
        const file = files.shift();
        if (!file) break;
        unlinkSync(join(dir, file));
      }
    } catch {
      /* 目录不存在或清理失败忽略 */
    }
  }

  async function writeSnapshot(): Promise<void> {
    try {
      const scan = await getScan();
      mkdirSync(SNAPSHOT_DIR, { recursive: true });
      writeFileSync(
        join(SNAPSHOT_DIR, `snap-${Date.now()}.json`),
        JSON.stringify({ time: Date.now(), entries: scan.all }),
        "utf-8",
      );
      prune(SNAPSHOT_DIR, "snap-");
    } catch {
      /* 快照失败忽略 */
    }
  }

  async function writeReport(): Promise<void> {
    try {
      const scan = await getScan();
      mkdirSync(REPORT_DIR, { recursive: true });
      const health = scan.all.length
        ? Math.round(
            scan.all.reduce((sum, p) => {
              if (!p.mem) return sum + 100;
              const mb = p.mem / 1024;
              return sum + (mb > 500 ? 60 : mb > 200 ? 80 : 100);
            }, 0) / scan.all.length,
          )
        : 100;
      writeFileSync(
        join(REPORT_DIR, `health-${Date.now()}.json`),
        JSON.stringify({
          time: Date.now(),
          healthScore: health,
          total: scan.all.length,
          dev: scan.dev.length,
        }),
        "utf-8",
      );
      prune(REPORT_DIR, "health-");
    } catch {
      /* 报告失败忽略 */
    }
  }

  function applySchedules(): void {
    if (snapshotTimer) clearInterval(snapshotTimer);
    if (reportTimer) clearInterval(reportTimer);
    snapshotTimer = null;
    reportTimer = null;
    if (config.snapshotInterval > 0) {
      snapshotTimer = setInterval(() => void writeSnapshot(), config.snapshotInterval * 1000);
      snapshotTimer.unref();
    }
    if (config.reportInterval > 0) {
      reportTimer = setInterval(() => void writeReport(), config.reportInterval * 1000);
      reportTimer.unref();
    }
  }

  async function doScan(): Promise<ScanCache> {
    const now = Date.now();
    const started = Date.now();
    const all = await listAllListening();
    const devSet = new Set([...COMMON_PORTS, ...config.customPorts]);
    const dev = all.filter((e) => devSet.has(e.port));
    cache = { at: now, dev, all, durationMs: Date.now() - started };
    scanTimes.push(cache.durationMs);
    if (scanTimes.length > 200) scanTimes.shift();

    const current = new Map(all.map((e) => [entryKey(e), e] as const));
    const changedEvents: PortEvent[] = [];
    const wasInitialized = initialized;

    if (initialized) {
      for (const [key, e] of current) {
        if (!prevPorts.has(key)) {
          changedEvents.push({
            time: now,
            type: "open",
            port: e.port,
            pid: e.pid,
            process: e.process,
            protocol: e.protocol,
            address: e.address,
          });
        }
      }
      for (const [key, e] of prevPorts) {
        if (!current.has(key)) {
          changedEvents.push({
            time: now,
            type: "close",
            port: e.port,
            pid: e.pid,
            process: e.process,
            protocol: e.protocol,
            address: e.address,
          });
        }
      }
      if (changedEvents.length) {
        events.unshift(...changedEvents);
        if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
        saveHistoryEvents(events);
        for (const event of changedEvents) void sendWebhook(config.webhookUrl, event);
      }
    } else {
      initialized = true;
    }

    let firstSeenChanged = false;
    for (const e of all) {
      if (!firstSeen.has(e.port)) {
        firstSeen.set(e.port, now);
        firstSeenChanged = true;
      }
    }
    const livePorts = new Set(all.map((e) => e.port));
    for (const port of [...firstSeen.keys()]) {
      if (!livePorts.has(port)) {
        firstSeen.delete(port);
        firstSeenChanged = true;
      }
    }

    prevPorts.clear();
    for (const [key, e] of current) prevPorts.set(key, e);

    if (!wasInitialized || changedEvents.length > 0 || firstSeenChanged) {
      saveFirstSeen(firstSeen);
      saveLastPorts(prevPorts);
    }
    return cache;
  }

  function getScan(): Promise<ScanCache> {
    const now = Date.now();
    if (cache && now - cache.at < SCAN_CACHE_TTL) return Promise.resolve(cache);
    if (inflight) return inflight;
    inflight = doScan().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  function buildStats(ports: PortEntry[], scan: ScanCache) {
    return {
      total: ports.length,
      dev: ports.filter((e) => e.category === "dev").length,
      db: ports.filter((e) => e.category === "db").length,
      cache: ports.filter((e) => e.category === "cache").length,
      other: ports.filter((e) => e.category === "other").length,
      listeningAll: scan.all.length,
    };
  }

  function renderPorts(scan: ScanCache, scope: "dev" | "all"): PortEntry[] {
    const ignored = new Set(config.ignored);
    return (scope === "all" ? scan.all : scan.dev)
      .filter((e) => !ignored.has(e.port))
      .map((e) => ({ ...e, firstSeen: firstSeen.get(e.port) ?? scan.at }));
  }

  async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    if (!apiAccess(req, res, url, token)) return;
    const path = url.pathname;

    // 所有写方法先过 CSRF 守卫，再做业务解析：解析器不该为陌生网页服务。
    if (UNSAFE_METHODS.has(req.method ?? "") && !guardWrite(req, res)) return;

    if (req.method === "GET" && path === "/api/ports") {
      const scope = url.searchParams.get("scope") === "all" ? "all" : "dev";
      const scan = await getScan();
      const ports = renderPorts(scan, scope);
      json(res, 200, {
        ports,
        stats: buildStats(ports, scan),
        meta: {
          scope,
          durationMs: scan.durationMs,
          timestamp: scan.at,
          platform: process.platform,
        },
      });
      return;
    }

    if (req.method === "GET" && path === "/api/events") {
      if (sseClients >= MAX_SSE_CLIENTS) {
        json(res, 503, { ok: false, message: "实时连接数已达上限" });
        return;
      }
      sseClients++;
      const requested = Number(url.searchParams.get("interval"));
      const interval =
        Number.isFinite(requested) && requested >= 0 && requested <= 60
          ? Math.round(requested)
          : config.interval;
      const scope = url.searchParams.get("scope") === "all" ? "all" : "dev";
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write("retry: 4000\n\n");
      let closed = false;
      const send = (payload: unknown) => {
        if (!closed && !res.writableEnded) res.write(`data: ${JSON.stringify(payload)}\n\n`);
      };
      const push = async () => {
        try {
          const scan = await getScan();
          const ports = renderPorts(scan, scope);
          send({
            ports,
            stats: buildStats(ports, scan),
            meta: {
              scope,
              durationMs: scan.durationMs,
              timestamp: scan.at,
              platform: process.platform,
            },
          });
        } catch {
          /* 单次推送失败忽略 */
        }
      };
      if (interval > 0) {
        void push();
      }
      const timer = interval > 0 ? setInterval(() => void push(), interval * 1000) : null;
      const heartbeat = setInterval(() => {
        if (!closed && !res.writableEnded) res.write(": ping\n\n");
      }, 15000);
      const close = () => {
        if (closed) return;
        closed = true;
        sseClients = Math.max(0, sseClients - 1);
        if (timer) clearInterval(timer);
        clearInterval(heartbeat);
        try {
          res.end();
        } catch {
          /* ignore */
        }
      };
      req.on("close", close);
      res.on("close", close);
      return;
    }

    if (req.method === "GET" && path === "/api/probe") {
      const host = (url.searchParams.get("host") || "127.0.0.1").trim();
      if (!validProbeHost(host)) {
        json(res, 400, { ok: false, message: "主机参数无效" });
        return;
      }
      const portsParam = url.searchParams.get("ports");
      if (portsParam) {
        const list = portsParam
          .split(",")
          .map((v) => Number(v.trim()))
          .filter((n) => Number.isInteger(n) && n > 0 && n < 65536)
          .slice(0, 50);
        if (list.length === 0) {
          json(res, 400, { ok: false, message: "端口列表无效" });
          return;
        }
        const results = await Promise.all(list.map((p) => probeTcp(host, p)));
        json(res, 200, { host, results });
        return;
      }
      const port = Number(url.searchParams.get("port"));
      if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        json(res, 400, { ok: false, message: "参数无效" });
        return;
      }
      json(res, 200, await probeTcp(host, port));
      return;
    }

    if (req.method === "GET" && path === "/api/sysinfo") {
      const nets = networkInterfaces();
      const addresses: { name: string; address: string }[] = [];
      for (const [name, list] of Object.entries(nets)) {
        for (const item of list ?? []) {
          if (item.family === "IPv4" && !item.internal) addresses.push({ name, address: item.address });
        }
      }
      json(res, 200, {
        hostname: hostname(),
        platform: platform(),
        arch: arch(),
        release: release(),
        node: process.version,
        cpuCount: cpus().length,
        totalMemMB: Math.round(totalmem() / 1048576),
        freeMemMB: Math.round(freemem() / 1048576),
        loadavg: loadavg(),
        uptimeSec: Math.round(uptime()),
        processUptimeSec: Math.round(process.uptime()),
        addresses,
      });
      return;
    }

    if (req.method === "GET" && path === "/api/audit") {
      const raw = readJson(AUDIT_PATH);
      const list = Array.isArray(raw) ? raw.slice(0, 100) : [];
      json(res, 200, { events: list });
      return;
    }

    if (req.method === "GET" && path === "/api/connections") {
      json(res, 200, await connectionStats());
      return;
    }

    if (req.method === "GET" && path === "/api/stats") {
      const sorted = [...scanTimes].sort((a, b) => a - b);
      const avg = scanTimes.length
        ? Math.round(scanTimes.reduce((s, n) => s + n, 0) / scanTimes.length)
        : 0;
      json(res, 200, {
        count: scanTimes.length,
        avgMs: avg,
        minMs: sorted[0] ?? 0,
        maxMs: sorted[sorted.length - 1] ?? 0,
        p95Ms: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0,
        recent: scanTimes.slice(-20),
      });
      return;
    }

    if (req.method === "GET" && path === "/api/export-history") {
      const format = url.searchParams.get("format") === "csv" ? "csv" : "json";
      if (format === "csv") {
        const header = "time,type,port,protocol,address,pid,process";
        const rows = events.map((e) =>
          [
            new Date(e.time).toISOString(),
            e.type,
            e.port,
            e.protocol,
            csvEscape(e.address ?? ""),
            e.pid,
            csvEscape(e.process),
          ].join(","),
        );
        res.writeHead(200, {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="devdeck-history.csv"',
          "X-Content-Type-Options": "nosniff",
        });
        res.end("\uFEFF" + [header, ...rows].join("\r\n"));
      } else {
        json(res, 200, { generatedAt: Date.now(), events });
      }
      return;
    }

    if (req.method === "GET" && path === "/api/suggest-port") {
      const start = Number(url.searchParams.get("start"));
      const end = Number(url.searchParams.get("end"));
      const count = Math.max(1, Math.min(50, Number(url.searchParams.get("count") || 1)));
      if (Number.isInteger(start) && Number.isInteger(end) && end > start) {
        const scan = await getScan();
        const used = new Set(scan.all.map((e) => e.port));
        const free: number[] = [];
        for (let p = Math.max(1, start); p <= Math.min(65535, end) && free.length < count; p++) {
          if (!used.has(p)) free.push(p);
        }
        json(res, 200, { start, end, free });
        return;
      }
      const port = Number(url.searchParams.get("port"));
      if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        json(res, 400, { ok: false, message: "端口无效" });
        return;
      }
      const scan = await getScan();
      const used = new Set(scan.all.map((e) => e.port));
      if (!used.has(port)) {
        json(res, 200, { port, available: true, suggestion: port });
        return;
      }
      let suggestion = 0;
      for (let p = port + 1; p < port + 50 && p < 65536; p++) {
        if (!used.has(p)) {
          suggestion = p;
          break;
        }
      }
      json(res, 200, { port, available: false, suggestion });
      return;
    }

    if (req.method === "GET" && path === "/api/health") {
      json(res, 200, { ok: true, uptime: Math.round(process.uptime()), timestamp: Date.now() });
      return;
    }

    if (req.method === "GET" && path === "/api/history") {
      json(res, 200, { events: events.slice(0, 100) });
      return;
    }

    if (req.method === "GET" && path === "/api/process") {
      const pid = Number(url.searchParams.get("pid"));
      try {
        const detail = await processDetail(pid);
        json(res, 200, { ok: true, detail });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        json(res, 404, { ok: false, message });
      }
      return;
    }

    if (req.method === "GET" && path === "/api/export") {
      const scope = url.searchParams.get("scope") === "all" ? "all" : "dev";
      const fmt = url.searchParams.get("format");
      const format =
        fmt === "csv" ? "csv" : fmt === "md" ? "md" : fmt === "html" ? "html" : fmt === "xls" ? "xls" : "json";
      const scan = await getScan();
      const ignored = new Set(config.ignored);
      const ports = (scope === "all" ? scan.all : scan.dev).filter((e) => !ignored.has(e.port));
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      if (format === "xls") {
        res.writeHead(200, {
          "Content-Type": "application/vnd.ms-excel; charset=utf-8",
          "Content-Disposition": `attachment; filename="devdeck-ports-${stamp}.xls"`,
        });
        res.end(toExcelXml(ports));
      } else if (format === "html") {
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": `attachment; filename="devdeck-ports-${stamp}.html"`,
        });
        res.end(toHtml(ports, { scope, generatedAt: Date.now() }));
      } else if (format === "md") {
        res.writeHead(200, {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="devdeck-ports-${stamp}.md"`,
        });
        res.end(toMarkdown(ports, { scope, generatedAt: Date.now() }));
      } else if (format === "csv") {
        res.writeHead(200, {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="devdeck-ports-${stamp}.csv"`,
        });
        res.end(toCsv(ports));
      } else {
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="devdeck-ports-${stamp}.json"`,
        });
        res.end(JSON.stringify({ generatedAt: Date.now(), scope, ports }, null, 2));
      }
      return;
    }

    if (req.method === "POST" && path === "/api/kill") {
      try {
        const body = JSON.parse(await readBody(req)) as {
          pid?: unknown;
          pids?: unknown;
          port?: unknown;
          tree?: unknown;
        };
        let pids: number[];
        if (body.port !== undefined) {
          const target = Number(body.port);
          const scan = await getScan();
          pids = [
            ...new Set(scan.all.filter((e) => e.port === target).map((e) => e.pid).filter((p) => p > 0)),
          ];
          if (pids.length === 0) {
            json(res, 404, { ok: false, message: `端口 ${target} 当前未被监听` });
            return;
          }
        } else if (Array.isArray(body.pids)) {
          pids = body.pids.map(Number);
        } else {
          pids = [Number(body.pid)];
        }
        const valid = [...new Set(pids.filter((p) => Number.isInteger(p) && p > 0))];
        if (valid.length === 0) {
          json(res, 400, { ok: false, message: "缺少有效的 PID" });
          return;
        }
        const results: { pid: number; ok: boolean; message?: string }[] = [];
        // PID 白名单：只允许终止"当前扫描中确实在监听端口、且不是系统关键进程"
        // 的 PID。即使前两道闸门被绕过，也无法盲杀任意进程；同时天然免疫
        // "扫描与 kill 之间 PID 被系统复用"的竞态。
        const scanForKill = await getScan();
        const listening = new Map(scanForKill.all.map((e) => [e.pid, e.process]));
        for (const pid of valid) {
          if (isProtectedPid(pid, listening.get(pid) ?? "")) {
            results.push({ pid, ok: false, message: "系统关键进程，拒绝终止" });
            continue;
          }
          if (!listening.has(pid)) {
            results.push({
              pid,
              ok: false,
              message: "该 PID 不在当前端口扫描结果中（已退出或并非监听进程），已拒绝",
            });
            continue;
          }
          try {
            await killPort(pid, body.tree === true);
            results.push({ pid, ok: true });
            audit("kill", `PID ${pid}`);
          } catch (err) {
            results.push({ pid, ok: false, message: err instanceof Error ? err.message : String(err) });
          }
        }
        cache = null;
        const failed = results.filter((r) => !r.ok);
        json(res, failed.length === 0 ? 200 : 207, {
          ok: failed.length === 0,
          results,
          message:
            failed.length === 0
              ? `已终止 ${results.length} 个进程`
              : `${results.length - failed.length} 个成功，${failed.length} 个失败`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        json(res, 400, { ok: false, message });
      }
      return;
    }

    if (path === "/api/config") {
      if (req.method === "GET") {
        json(res, 200, { config, configPath: configPath() });
        return;
      }
      if (req.method === "PUT" || req.method === "POST") {
        try {
          const body = JSON.parse(await readBody(req)) as Partial<DevDeckConfig>;
          const next = normalizeConfig(body, config);
          saveConfig(next);
          Object.assign(config, next);
          cache = null;
          applySchedules();
          audit("config", JSON.stringify(next));
          json(res, 200, { ok: true, config });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          json(res, 400, { ok: false, message });
        }
        return;
      }
    }

    json(res, 404, { ok: false, message: "接口不存在" });
  }

  const server = createServer(async (req, res) => {
    try {
      if (!allowedHost(req.headers.host)) {
        json(res, 403, { ok: false, message: "非法 Host" });
        return;
      }
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === "/" || url.pathname === "/index.html") {
        const html = (await getHtmlTemplate()).replace(/__DEVDECK_TOKEN__/g, token);
        res.writeHead(200, htmlHeaders());
        res.end(html);
        return;
      }
      if (url.pathname === "/favicon.ico") {
        res.writeHead(204, { "Cache-Control": "public, max-age=86400" });
        res.end();
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        await handleApi(req, res, url);
        return;
      }
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      json(res, 500, { ok: false, message });
    }
  });

  server.on("clientError", (_err, socket) => {
    try {
      socket.destroy();
    } catch {
      /* 客户端异常断开时安全关闭 */
    }
  });

  return new Promise((resolve, reject) => {
    let attempts = 0;
    const tryListen = (port: number) => {
      const onError = (err: NodeJS.ErrnoException) => {
        server.removeListener("error", onError);
        if (err.code === "EADDRINUSE" && attempts < 10) {
          attempts += 1;
          tryListen(port + 1);
        } else {
          reject(err);
        }
      };
      server.once("error", onError);
      server.listen(port, "127.0.0.1", () => {
        server.removeListener("error", onError);
        const address = server.address();
        const actual = typeof address === "object" && address ? address.port : port;
        applySchedules();
        resolve({
          port: actual,
          token,
          config,
          stop: () => {
            if (snapshotTimer) clearInterval(snapshotTimer);
            if (reportTimer) clearInterval(reportTimer);
            server.close();
            server.closeAllConnections?.();
          },
        });
        void getScan().catch(() => {
          /* 预扫描失败不影响服务 */
        });
      });
    };
    tryListen(defaultPort);
  });
}