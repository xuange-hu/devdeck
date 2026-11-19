import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir, hostname, platform, arch, release, cpus, totalmem, freemem, loadavg, uptime, networkInterfaces } from "node:os";
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
import { normalizeConfig, toCsv, toMarkdown, toHtml, toExcelXml } from "./serialize.js";

const SCAN_CACHE_TTL = 800;
const MAX_EVENTS = 300;
const HERE = (() => {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
})();

const HISTORY_PATH = join(homedir(), ".devdeck-history.json");
const AUDIT_PATH = join(homedir(), ".devdeck-audit.json");

interface AuditEntry {
  time: number;
  action: string;
  detail: string;
}

function audit(action: string, detail: string): void {
  try {
    let list: AuditEntry[] = [];
    try {
      const raw = JSON.parse(readFileSync(AUDIT_PATH, "utf-8"));
      if (Array.isArray(raw)) list = raw;
    } catch {
      /* 无历史 */
    }
    list.unshift({ time: Date.now(), action, detail });
    if (list.length > 500) list.length = 500;
    writeFileSync(AUDIT_PATH, JSON.stringify(list), "utf-8");
  } catch {
    /* 审计写入失败不影响主流程 */
  }
}

function loadHistoryEvents(): PortEvent[] {
  try {
    const raw = JSON.parse(readFileSync(HISTORY_PATH, "utf-8"));
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (e) =>
          e &&
          typeof e.time === "number" &&
          (e.type === "open" || e.type === "close") &&
          typeof e.port === "number",
      )
      .slice(0, MAX_EVENTS);
  } catch {
    return [];
  }
}

function saveHistoryEvents(list: PortEvent[]): void {
  try {
    writeFileSync(HISTORY_PATH, JSON.stringify(list.slice(0, MAX_EVENTS)), "utf-8");
  } catch {
    /* 写入失败不影响服务 */
  }
}

async function loadHtml(): Promise<string> {
  try {
    return await readFile(join(HERE, "web", "index.html"), "utf-8");
  } catch {
    return embeddedHtml;
  }
}

interface ScanCache {
  at: number;
  dev: PortEntry[];
  all: PortEntry[];
  durationMs: number;
}

interface PortEvent {
  time: number;
  type: "open" | "close";
  port: number;
  pid: number;
  process: string;
}

export interface RunningServer {
  port: number;
  stop: () => void;
  config: DevDeckConfig;
}

function json(res: ServerResponse, code: number, data: unknown) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > 64 * 1024) throw new Error("请求体过大");
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function sendWebhook(url: string, event: PortEvent): Promise<void> {
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    /* webhook 失败不影响主流程 */
  }
}

export function startServer(defaultPort = 7676): Promise<RunningServer> {
  const config = loadConfig();
  let cache: ScanCache | null = null;
  let initialized = false;
  const prevPorts = new Map<number, PortEntry>();
  const scanTimes: number[] = [];
  const events: PortEvent[] = loadHistoryEvents();
  const firstSeen = new Map<number, number>();

  async function getScan(): Promise<ScanCache> {
    const now = Date.now();
    if (cache && now - cache.at < Math.max(SCAN_CACHE_TTL, cache.durationMs)) return cache;
    const started = Date.now();
    const all = await listAllListening();
    const devSet = new Set([...COMMON_PORTS, ...config.customPorts]);
    const dev = all.filter((e) => devSet.has(e.port));
    cache = { at: now, dev, all, durationMs: Date.now() - started };
    scanTimes.push(cache.durationMs);
    if (scanTimes.length > 200) scanTimes.shift();

    const current = new Map(all.map((e) => [e.port, e] as const));
    if (initialized) {
      let changed = false;
      for (const [port, e] of current) {
        if (!prevPorts.has(port)) {
          events.unshift({ time: now, type: "open", port, pid: e.pid, process: e.process });
          changed = true;
        }
      }
      for (const [port, e] of prevPorts) {
        if (!current.has(port)) {
          events.unshift({ time: now, type: "close", port, pid: e.pid, process: e.process });
          changed = true;
        }
      }
      if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
      if (changed) saveHistoryEvents(events);
      if (changed) {
        for (const e of events.slice(0, 4)) void sendWebhook(config.webhookUrl, e);
      }
    } else {
      initialized = true;
    }
    for (const port of current.keys()) {
      if (!firstSeen.has(port)) firstSeen.set(port, now);
    }
    for (const port of [...firstSeen.keys()]) {
      if (!current.has(port)) firstSeen.delete(port);
    }
    prevPorts.clear();
    for (const [port, e] of current) prevPorts.set(port, e);
    return cache;
  }

  async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const path = url.pathname;

    if (req.method === "GET" && path === "/api/ports") {
      const scope = url.searchParams.get("scope") === "all" ? "all" : "dev";
      const scan = await getScan();
      const ignored = new Set(config.ignored);
      const ports = (scope === "all" ? scan.all : scan.dev)
        .filter((e) => !ignored.has(e.port))
        .map((e) => ({ ...e, firstSeen: firstSeen.get(e.port) ?? scan.at }));
      const stats = {
        total: ports.length,
        dev: ports.filter((e) => e.category === "dev").length,
        db: ports.filter((e) => e.category === "db").length,
        cache: ports.filter((e) => e.category === "cache").length,
        other: ports.filter((e) => e.category === "other").length,
        listeningAll: scan.all.length,
      };
      json(res, 200, {
        ports,
        stats,
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
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      });
      res.write("retry: 4000\n\n");
      let closed = false;
      const send = (payload: unknown) => {
        if (!closed) res.write(`data: ${JSON.stringify(payload)}\n\n`);
      };
      const push = async () => {
        try {
          const scan = await getScan();
          const ignored = new Set(config.ignored);
          const ports = (config.scope === "all" ? scan.all : scan.dev)
            .filter((e) => !ignored.has(e.port))
            .map((e) => ({ ...e, firstSeen: firstSeen.get(e.port) ?? scan.at }));
          const stats = {
            total: ports.length,
            dev: ports.filter((e) => e.category === "dev").length,
            db: ports.filter((e) => e.category === "db").length,
            cache: ports.filter((e) => e.category === "cache").length,
            other: ports.filter((e) => e.category === "other").length,
            listeningAll: scan.all.length,
          };
          send({
            ports,
            stats,
            meta: {
              scope: config.scope,
              durationMs: scan.durationMs,
              timestamp: scan.at,
              platform: process.platform,
            },
          });
        } catch {
          /* 单次推送失败忽略 */
        }
      };
      void push();
      const timer = setInterval(() => {
        void push();
      }, Math.max(1, config.interval) * 1000);
      const heartbeat = setInterval(() => {
        if (!closed) res.write(": ping\n\n");
      }, 15000);
      req.on("close", () => {
        closed = true;
        clearInterval(timer);
        clearInterval(heartbeat);
        res.end();
      });
      return;
    }

    if (req.method === "GET" && path === "/api/probe") {
      const host = url.searchParams.get("host") || "127.0.0.1";
      const portsParam = url.searchParams.get("ports");
      if (portsParam) {
        const list = portsParam.split(",").map((v) => Number(v.trim())).filter((n) => Number.isInteger(n) && n > 0 && n < 65536).slice(0, 50);
        const results = await Promise.all(list.map((p) => probeTcp(host, p)));
        json(res, 200, { host, results });
        return;
      }
      const port = Number(url.searchParams.get("port"));
      if (!/^[a-zA-Z0-9.:-]+$/.test(host) || !Number.isInteger(port) || port <= 0 || port > 65535) {
        json(res, 400, { ok: false, message: "参数无效" });
        return;
      }
      const result = await probeTcp(host, port);
      json(res, 200, result);
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
        addresses,
      });
      return;
    }

    if (req.method === "GET" && path === "/api/audit") {
      let list: AuditEntry[] = [];
      try {
        const raw = JSON.parse(readFileSync(AUDIT_PATH, "utf-8"));
        if (Array.isArray(raw)) list = raw;
      } catch {
        /* 无审计记录 */
      }
      json(res, 200, { events: list.slice(0, 100) });
      return;
    }

    if (req.method === "GET" && path === "/api/connections") {
      const stats = await connectionStats();
      json(res, 200, stats);
      return;
    }

    if (req.method === "GET" && path === "/api/stats") {
      const sorted = [...scanTimes].sort((a, b) => a - b);
      const avg = scanTimes.length ? Math.round(scanTimes.reduce((s, n) => s + n, 0) / scanTimes.length) : 0;
      json(res, 200, {
        count: scanTimes.length,
        avgMs: avg,
        minMs: sorted[0] ?? 0,
        maxMs: sorted[sorted.length - 1] ?? 0,
        p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
        recent: scanTimes.slice(-20),
      });
      return;
    }

    if (req.method === "GET" && path === "/api/export-history") {
      const format = url.searchParams.get("format") === "csv" ? "csv" : "json";
      if (format === "csv") {
        const header = "time,type,port,pid,process";
        const rows = events.map((e) => `${new Date(e.time).toISOString()},${e.type},${e.port},${e.pid},"${e.process.replace(/"/g, '"')}"`);
        res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=\"devdeck-history.csv\"" });
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
        if (!used.has(p)) { suggestion = p; break; }
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
      const format = fmt === "csv" ? "csv" : fmt === "md" ? "md" : fmt === "html" ? "html" : fmt === "xls" ? "xls" : "json";
      const scan = await getScan();
      const ignored = new Set(config.ignored);
      const ports = (scope === "all" ? scan.all : scan.dev).filter((e) => !ignored.has(e.port));
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      if (format === "xls") {
        res.writeHead(200, {
          "Content-Type": "application/vnd.ms-excel; charset=utf-8",
          "Content-Disposition": `attachment; filename="devdeck-ports-${stamp}.xml"`,
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
        const body = JSON.parse(await readBody(req)) as { pid?: unknown; pids?: unknown; port?: unknown; tree?: unknown };
        let pids: number[];
        if (body.port) {
          const target = Number(body.port);
          const scan = await getScan();
          const hit = scan.all.find((e) => e.port === target);
          if (!hit) {
            json(res, 404, { ok: false, message: `端口 ${target} 当前未被监听` });
            return;
          }
          pids = [hit.pid];
        } else {
          pids = Array.isArray(body.pids) ? body.pids.map(Number) : [Number(body.pid)];
        }
        const valid = pids.filter((p) => Number.isInteger(p) && p > 0);
        if (valid.length === 0) {
          json(res, 400, { ok: false, message: "缺少有效的 PID" });
          return;
        }
        const results: { pid: number; ok: boolean; message?: string }[] = [];
        for (const pid of valid) {
          try {
            await killPort(pid, body.tree === true);
            results.push({ pid, ok: true });
            audit("kill", `PID ${pid}`);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            results.push({ pid, ok: false, message });
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
  server.on("clientError", (err, socket) => {
    try { socket.destroy(); } catch { /* 客户端异常断开时安全关闭 */ }
  });
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === "/" || url.pathname === "/index.html") {
        const html = await loadHtml();
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
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
        const address = server.address();
        const actual = typeof address === "object" && address ? address.port : port;
        let snapshotTimer: NodeJS.Timeout | null = null;
        let reportTimer: NodeJS.Timeout | null = null;
        if (config.snapshotInterval > 0) {
          const dir = join(homedir(), ".devdeck-snapshots");
          snapshotTimer = setInterval(() => {
            void (async () => {
              try {
                const scan = await getScan();
                mkdirSync(dir, { recursive: true });
                writeFileSync(
                  join(dir, `snap-${Date.now()}.json`),
                  JSON.stringify({ time: Date.now(), ports: scan.all }),
                );
              } catch {
                /* 快照失败忽略 */
              }
            })();
          }, config.snapshotInterval * 1000);
          snapshotTimer.unref();
        if (config.reportInterval > 0) {
          const dir = join(homedir(), ".devdeck-reports");
          reportTimer = setInterval(() => {
            void (async () => {
              try {
                const scan = await getScan();
                mkdirSync(dir, { recursive: true });
                const health = scan.all.length
                  ? Math.round(scan.all.reduce((s, p) => s + (p.mem && p.mem / 1024 > 500 ? 60 : p.mem && p.mem / 1024 > 200 ? 80 : 100), 0) / scan.all.length)
                  : 100;
                writeFileSync(
                  join(dir, `health-${Date.now()}.json`),
                  JSON.stringify({ time: Date.now(), healthScore: health, total: scan.all.length, dev: scan.dev.length })
                );
              } catch { /* ignore */ }
            })();
          }, config.reportInterval * 1000);
          reportTimer.unref();
        }
        }
        resolve({
          port: actual,
          config,
          stop: () => {
            if (snapshotTimer) clearInterval(snapshotTimer);
            if (reportTimer) clearInterval(reportTimer);
            server.close();
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