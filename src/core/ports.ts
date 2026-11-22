import { execFile } from "node:child_process";
import { connect } from "node:net";
import { promisify } from "node:util";
import { loadConfig } from "./config.js";

const exec = promisify(execFile);

export type PortCategory = "dev" | "db" | "cache" | "other";
export type PortProtocol = "tcp" | "udp";

export interface PortEntry {
  port: number;
  pid: number;
  process: string;
  protocol: PortProtocol;
  address?: string;
  mem?: number;
  cpuSec?: number;
  path?: string;
  category: PortCategory;
  label: string;
}

export interface ProcessDetail {
  pid: number;
  name: string;
  path?: string;
  commandLine?: string;
  startTime?: string;
  parentPid?: number;
}

export interface ProcInfo {
  name: string;
  memKb?: number;
  cpuSec?: number;
  path?: string;
}

export const COMMON_PORTS = [
  2181, 2375, 2376, 2379, 2380, 3000, 3001, 3002, 3005, 3306, 3333, 4000, 4001,
  4173, 4200, 5000, 5001, 5173, 5174, 5175, 5432, 5601, 5672, 6379, 7000, 8000,
  8001, 8008, 8080, 8081, 8082, 8083, 8084, 8090, 8500, 8888, 9000, 9001, 9090,
  9092, 9200, 9229, 9300, 9527, 15672, 16686, 27017, 50051,
];

const PORT_META: Record<number, readonly [PortCategory, string]> = {
  3000: ["dev", "React / Next.js / Express"],
  3001: ["dev", "Next.js 备用"],
  3002: ["dev", "开发服务器"],
  3005: ["dev", "自定义开发端口"],
  3333: ["dev", "Vite / 开发服务器"],
  4000: ["dev", "后端开发服务"],
  4001: ["dev", "开发服务备用"],
  4173: ["dev", "Vite Preview"],
  4200: ["dev", "Angular / Grunt"],
  5000: ["dev", "Flask / 后端服务"],
  5001: ["dev", "HTTPS 开发服务"],
  5173: ["dev", "Vite Dev Server"],
  5174: ["dev", "Vite Dev 备用"],
  5175: ["dev", "Vite Dev 备用"],
  7000: ["dev", "开发服务"],
  8000: ["dev", "后端开发服务"],
  8001: ["dev", "后端开发服务"],
  8008: ["dev", "HTTP 备用服务"],
  8080: ["dev", "HTTP 服务 / 后端"],
  8081: ["dev", "后端开发服务"],
  8082: ["dev", "后端开发服务"],
  8083: ["dev", "后端开发服务"],
  8084: ["dev", "后端开发服务"],
  8090: ["dev", "后端开发服务"],
  8888: ["dev", "Jupyter / 后端服务"],
  9000: ["dev", "PHP-FPM / SonarQube"],
  9001: ["dev", "开发服务备用"],
  9229: ["dev", "Node.js Inspector"],
  9527: ["dev", "自定义开发端口"],
  50051: ["dev", "gRPC 服务"],
  5432: ["db", "PostgreSQL"],
  3306: ["db", "MySQL / MariaDB"],
  27017: ["db", "MongoDB"],
  6379: ["cache", "Redis"],
  2181: ["other", "ZooKeeper"],
  2375: ["dev", "Docker API"],
  2376: ["dev", "Docker API (TLS)"],
  2379: ["other", "etcd"],
  2380: ["other", "etcd Peer"],
  5601: ["dev", "Kibana"],
  5672: ["other", "RabbitMQ"],
  8500: ["dev", "Consul"],
  9090: ["dev", "Prometheus"],
  9092: ["other", "Kafka"],
  9200: ["db", "Elasticsearch"],
  9300: ["db", "Elasticsearch Transport"],
  15672: ["other", "RabbitMQ 管理台"],
  16686: ["dev", "Jaeger UI"],
};

export function metaFor(port: number): { category: PortCategory; label: string } {
  const meta = PORT_META[port];
  if (meta) return { category: meta[0], label: meta[1] };
  if (port < 1024) return { category: "other", label: "系统服务" };
  return { category: "other", label: "其他服务" };
}

function execTimeout(cmd: string, args: string[], timeout = 8000) {
  return exec(cmd, args, { timeout, windowsHide: true });
}

function splitLocal(value: string): { address: string; port: number } {
  const idx = value.lastIndexOf(":");
  if (idx < 0) return { address: value, port: Number.NaN };
  return {
    address: value.slice(0, idx) || "*",
    port: Number(value.slice(idx + 1)),
  };
}

function dedupe(entries: PortEntry[]): PortEntry[] {
  const map = new Map<string, PortEntry>();
  for (const entry of entries) {
    const key = `${entry.protocol}|${entry.address ?? ""}|${entry.port}`;
    if (!map.has(key)) map.set(key, entry);
  }
  return [...map.values()].sort(
    (a, b) =>
      a.port - b.port ||
      a.protocol.localeCompare(b.protocol) ||
      (a.address ?? "").localeCompare(b.address ?? ""),
  );
}

let procCache: { at: number; map: Map<number, ProcInfo> } | null = null;
const PROC_CACHE_TTL = 10000;
const PS_PROC_SCRIPT =
  'Get-Process | ForEach-Object { "$($_.Id)|$($_.ProcessName)|$($_.WorkingSet64)|$($_.CPU)|$($_.Path)" }';

async function getProcMap(): Promise<Map<number, ProcInfo>> {
  if (procCache && Date.now() - procCache.at < PROC_CACHE_TTL) return procCache.map;
  const map = new Map<number, ProcInfo>();
  try {
    const { stdout } = await execTimeout(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", PS_PROC_SCRIPT],
      30000,
    );
    for (const line of stdout.split(/\r?\n/)) {
      const parts = line.trim().split("|");
      if (parts.length < 3) continue;
      const pid = Number(parts[0]);
      const name = parts[1];
      const bytes = Number(parts[2]);
      const cpuSec = Number(parts[3]);
      const path = parts[4];
      if (!Number.isInteger(pid) || !name) continue;
      map.set(pid, {
        name,
        memKb: Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes / 1024) : undefined,
        cpuSec: Number.isFinite(cpuSec) ? cpuSec : undefined,
        path: path || undefined,
      });
    }
    procCache = { at: Date.now(), map };
  } catch {
    /* 枚举失败时保留空表，进程名回退 unknown */
  }
  return map;
}

export function parseWindowsOutput(
  tcp: string,
  udp: string,
  procs: Map<number, ProcInfo>,
): PortEntry[] {
  const results = new Map<string, PortEntry>();
  const add = (local: string, pid: number, protocol: PortProtocol) => {
    const { address, port } = splitLocal(local);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return;
    if (!Number.isInteger(pid) || pid < 0) return;
    const key = `${protocol}|${address}|${port}`;
    if (results.has(key)) return;
    const info = procs.get(pid);
    results.set(key, {
      port,
      pid,
      protocol,
      address,
      process: info?.name ?? "unknown",
      mem: info?.memKb,
      cpuSec: info?.cpuSec,
      path: info?.path,
      ...metaFor(port),
    });
  };

  for (const line of tcp.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5 || cols[3] !== "LISTENING") continue;
    add(cols[1] ?? "", Number(cols[4]), "tcp");
  }
  for (const line of udp.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 4 || cols[0] !== "UDP") continue;
    add(cols[1] ?? "", Number(cols[cols.length - 1]), "udp");
  }

  return dedupe([...results.values()]);
}

export function parseLsofOutput(stdout: string, protocol: PortProtocol): PortEntry[] {
  const entries: PortEntry[] = [];
  let pid = 0;
  let process = "unknown";
  let names: string[] = [];

  const flush = () => {
    for (const name of names) {
      const { address, port } = splitLocal(name);
      if (!Number.isInteger(port) || port <= 0 || port > 65535) continue;
      entries.push({
        port,
        pid,
        protocol,
        address,
        process,
        ...metaFor(port),
      });
    }
    names = [];
  };

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const tag = line.charAt(0);
    const value = line.slice(1).trim();
    if (tag === "p") {
      flush();
      pid = Number(value);
      process = "unknown";
    } else if (tag === "c") {
      process = value || "unknown";
    } else if (tag === "n") {
      names.push(value);
    }
  }
  flush();
  return dedupe(entries);
}

export function parseSsOutput(stdout: string): PortEntry[] {
  const entries: PortEntry[] = [];
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(
      /^(tcp|udp)\s+\S+\s+\d+\s+\d+\s+(\S+)\s+\S+\s*(.*)$/,
    );
    if (!match) continue;
    const protocol = match[1] as PortProtocol;
    const local = match[2] ?? "";
    const rest = match[3] ?? "";
    const { address, port } = splitLocal(local);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) continue;
    const pidMatch = rest.match(/\bpid=(\d+)/);
    const nameMatch = rest.match(/"([^"]+)"/);
    entries.push({
      port,
      pid: pidMatch ? Number(pidMatch[1]) : 0,
      protocol,
      address,
      process: nameMatch ? nameMatch[1]! : "unknown",
      ...metaFor(port),
    });
  }
  return dedupe(entries);
}

async function parseWindows(): Promise<PortEntry[]> {
  const [tcp, udp, procs] = await Promise.all([
    execTimeout("netstat", ["-ano", "-p", "tcp"]),
    execTimeout("netstat", ["-ano", "-p", "udp"]).catch(() => ({ stdout: "" })),
    getProcMap(),
  ]);
  return parseWindowsOutput(tcp.stdout, udp.stdout, procs);
}

async function parseUnix(): Promise<PortEntry[]> {
  const entries: PortEntry[] = [];
  let lsofOk = false;

  try {
    const { stdout } = await execTimeout("lsof", ["-iTCP", "-sTCP:LISTEN", "-n", "-P", "-Fpcn"]);
    lsofOk = true;
    entries.push(...parseLsofOutput(stdout, "tcp"));
  } catch {
    /* lsof 不可用或输出失败 */
  }
  try {
    const { stdout } = await execTimeout("lsof", ["-iUDP", "-n", "-P", "-Fpcn"]);
    lsofOk = true;
    entries.push(...parseLsofOutput(stdout, "udp"));
  } catch {
    /* UDP 查询失败不影响 TCP */
  }

  if (!lsofOk) {
    try {
      const { stdout } = await execTimeout("ss", ["-H", "-tulnp"]);
      entries.push(...parseSsOutput(stdout));
    } catch {
      return [];
    }
  }

  return dedupe(entries);
}

async function scan(): Promise<PortEntry[]> {
  return process.platform === "win32" ? parseWindows() : parseUnix();
}

export async function listDevPorts(): Promise<PortEntry[]> {
  const all = await scan();
  const config = loadConfig();
  const set = new Set([...COMMON_PORTS, ...config.customPorts]);
  return all.filter((e) => set.has(e.port));
}

export async function listAllListening(): Promise<PortEntry[]> {
  return scan();
}

export async function killPort(pid: number, tree = false): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`无效的 PID: ${pid}`);
  }
  try {
    if (process.platform === "win32") {
      const args = tree
        ? ["/PID", String(pid), "/T", "/F"]
        : ["/PID", String(pid), "/F"];
      await execTimeout("taskkill", args);
    } else {
      if (tree) {
        await execTimeout("pkill", ["-9", "-P", String(pid)]).catch(() => ({}));
      }
      await execTimeout("kill", ["-9", String(pid)]);
    }
  } catch (err) {
    const e = err as { code?: number | string; stderr?: string | Buffer; message?: string };
    const detail = String(e.stderr ?? e.message ?? "");
    if (
      e.code === 128 ||
      e.code === "ESRCH" ||
      /no such process|not found|找不到|没有运行|不存在/i.test(detail)
    ) {
      throw new Error(`进程 ${pid} 不存在或已退出`);
    }
    if (
      e.code === 5 ||
      e.code === "EPERM" ||
      /access is denied|permission denied|拒绝访问|denied|权限/i.test(detail)
    ) {
      throw new Error(`终止进程 ${pid} 权限不足，请以管理员身份运行`);
    }
    throw new Error(`无法终止进程 ${pid}，该进程可能受系统保护`);
  }
}

export async function processDetail(pid: number): Promise<ProcessDetail> {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`无效的 PID: ${pid}`);
  }
  if (process.platform === "win32") {
    const baseScript =
      `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; ` +
      `if ($p) { $st = 'N/A'; try { if ($p.StartTime) { $st = $p.StartTime.ToString('yyyy-MM-dd HH:mm:ss') } } catch {}; ` +
      `$path = $null; try { $path = $p.Path } catch {}; ` +
      `[PSCustomObject]@{ Name=$p.ProcessName; Path=$path; StartTime=$st } | ConvertTo-Json -Compress } else { "null" }`;
    const cimScript =
      `$c = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction SilentlyContinue; ` +
      `if ($c) { [PSCustomObject]@{ CommandLine=$c.CommandLine; ParentPid=[int]$c.ParentProcessId } | ConvertTo-Json -Compress } else { "null" }`;
    const [base, cim] = await Promise.all([
      exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", baseScript], {
        timeout: 20000,
        windowsHide: true,
      }),
      exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", cimScript], {
        timeout: 5000,
        windowsHide: true,
      }).catch(() => null),
    ]);
    const rawOut = base.stdout.trim();
    if (!rawOut || rawOut === "null") throw new Error(`进程 ${pid} 不存在`);
    let obj: { Name?: string; Path?: string | null; StartTime?: string | null };
    try {
      obj = JSON.parse(rawOut) as typeof obj;
    } catch {
      throw new Error(`进程 ${pid} 信息读取失败`);
    }
    let commandLine: string | undefined;
    let parentPid: number | undefined;
    if (cim) {
      try {
        const c = JSON.parse(cim.stdout.trim()) as {
          CommandLine?: string | null;
          ParentPid?: number | null;
        };
        commandLine = c.CommandLine ?? undefined;
        parentPid = c.ParentPid ? c.ParentPid : undefined;
      } catch {
        /* CIM 不可用时仅缺失命令行/父进程 */
      }
    }
    return {
      pid,
      name: obj.Name ?? "unknown",
      path: obj.Path ?? undefined,
      commandLine,
      startTime: obj.StartTime && obj.StartTime !== "N/A" ? obj.StartTime : undefined,
      parentPid,
    };
  }

  try {
    const infoPromise = execTimeout("ps", ["-p", String(pid), "-o", "pid=,ppid=,comm=,args="], 8000);
    const timePromise = execTimeout("ps", ["-p", String(pid), "-o", "lstart="], 8000).catch(
      () => null,
    );
    const { stdout } = await infoPromise;
    const line = stdout.trim();
    if (!line) throw new Error(`进程 ${pid} 不存在`);
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!match) throw new Error(`进程 ${pid} 不存在或无权访问`);
    const commandLine = match[4]?.trim() || undefined;
    const startTime = timePromise ? (await timePromise)?.stdout.trim() || undefined : undefined;
    const commandPath = commandLine ? commandLine.split(/\s+/)[0] : undefined;
    const path =
      commandPath && (commandPath.startsWith("/") || commandPath.includes("/"))
        ? commandPath
        : match[3]?.includes("/")
          ? match[3]
          : undefined;
    return {
      pid,
      name: match[3] ?? "unknown",
      path,
      commandLine,
      startTime,
      parentPid: Number(match[2]) || undefined,
    };
  } catch (err) {
    if (err instanceof Error && /不存在|无权/.test(err.message)) throw err;
    throw new Error(`进程 ${pid} 不存在或无权访问`);
  }
}

export interface ProbeResult {
  host: string;
  port: number;
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export function probeTcp(host: string, port: number, timeoutMs = 3000): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    const socket = connect({ host, port });
    const timer = setTimeout(() => finish(false, "timeout"), timeoutMs);
    const finish = (ok: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve({ host, port, ok, latencyMs: Date.now() - started, error });
    };
    socket.once("connect", () => finish(true));
    socket.once("error", (err) => finish(false, (err as NodeJS.ErrnoException).code ?? String(err)));
    socket.setTimeout(timeoutMs, () => finish(false, "timeout"));
  });
}

export interface ConnectionStats {
  listening: number;
  established: number;
  timeWait: number;
  closeWait: number;
  other: number;
}

let connectionCache: { at: number; stats: ConnectionStats } | null = null;
const CONNECTION_CACHE_TTL = 2000;

export async function connectionStats(): Promise<ConnectionStats> {
  if (connectionCache && Date.now() - connectionCache.at < CONNECTION_CACHE_TTL) {
    return connectionCache.stats;
  }
  const stats: ConnectionStats = { listening: 0, established: 0, timeWait: 0, closeWait: 0, other: 0 };
  try {
    if (process.platform === "win32") {
      const { stdout } = await execTimeout("netstat", ["-ano", "-p", "tcp"]);
      for (const line of stdout.split(/\r?\n/)) {
        const cols = line.trim().split(/\s+/);
        if (cols.length < 4) continue;
        const state = cols[3];
        if (state === "LISTENING") stats.listening++;
        else if (state === "ESTABLISHED") stats.established++;
        else if (state === "TIME_WAIT") stats.timeWait++;
        else if (state === "CLOSE_WAIT") stats.closeWait++;
        else if (state && /^[A-Z_]+$/.test(state)) stats.other++;
      }
    } else {
      const { stdout } = await execTimeout("ss", ["-tan"]);
      for (const line of stdout.split(/\r?\n/)) {
        const cols = line.trim().split(/\s+/);
        const state = cols[0]?.toUpperCase() ?? "";
        if (state === "LISTEN") stats.listening++;
        else if (state === "ESTAB") stats.established++;
        else if (state === "TIME-WAIT") stats.timeWait++;
        else if (state === "CLOSE-WAIT") stats.closeWait++;
        else if (state && /^[A-Z-]+$/.test(state)) stats.other++;
      }
    }
  } catch {
    /* 失败返回全零 */
  }
  connectionCache = { at: Date.now(), stats };
  return stats;
}