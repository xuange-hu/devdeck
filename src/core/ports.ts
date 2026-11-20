import { execFile } from "node:child_process";
import { connect } from "node:net";
import { promisify } from "node:util";

const exec = promisify(execFile);

export type PortCategory = "dev" | "db" | "cache" | "other";

export interface PortEntry {
  port: number;
  pid: number;
  process: string;
  protocol: "tcp" | "udp";
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

export const COMMON_PORTS = [
  2181, 2375, 2376, 2379, 2380, 3000, 3001, 3002, 3306, 3333, 4000, 4173,
  4200, 5000, 5173, 5174, 5432, 5601, 5672, 6379, 8000, 8001, 8080, 8081,
  8082, 8500, 8888, 9000, 9090, 9092, 9200, 9300, 9527, 15672, 16686, 27017,
];

const PORT_META: Record<number, readonly [PortCategory, string]> = {
  3000: ["dev", "React / Next.js / Express"],
  3001: ["dev", "Next.js 备用"],
  3002: ["dev", "开发服务器"],
  3333: ["dev", "Vite / 开发服务器"],
  4000: ["dev", "后端开发服务"],
  4173: ["dev", "Vite Preview"],
  4200: ["dev", "Angular / Grunt"],
  5000: ["dev", "Flask / 后端服务"],
  5173: ["dev", "Vite Dev Server"],
  5174: ["dev", "Vite Dev 备用"],
  8000: ["dev", "后端开发服务"],
  8001: ["dev", "后端开发服务"],
  8080: ["dev", "HTTP 服务 / 后端"],
  8081: ["dev", "后端开发服务"],
  8082: ["dev", "后端开发服务"],
  8888: ["dev", "Jupyter / 后端服务"],
  9000: ["dev", "PHP-FPM / SonarQube"],
  9527: ["dev", "自定义开发端口"],
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

interface ProcInfo {
  name: string;
  memKb?: number;
  cpuSec?: number;
  path?: string;
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
        memKb: Number.isFinite(bytes) ? Math.round(bytes / 1024) : undefined,
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

async function parseWindows(): Promise<PortEntry[]> {
  const [tcp, udp, procs] = await Promise.all([
    execTimeout("netstat", ["-ano", "-p", "tcp"]),
    execTimeout("netstat", ["-ano", "-p", "udp"]).catch(() => ({ stdout: "" })),
    getProcMap(),
  ]);
  const results = new Map<string, PortEntry>();
  const add = (port: number, pid: number, protocol: "tcp" | "udp") => {
    const key = protocol + ":" + port;
    if (results.has(key)) return;
    const info = procs.get(pid);
    results.set(key, {
      port,
      pid,
      protocol,
      process: info?.name ?? "unknown",
      mem: info?.memKb,
      cpuSec: info?.cpuSec,
      path: info?.path,
      ...metaFor(port),
    });
  };
  for (const line of tcp.stdout.split("\n")) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5 || cols[3] !== "LISTENING") continue;
    const port = Number(cols[1]?.split(":").pop());
    const pid = Number(cols[4]);
    if (!port || !pid) continue;
    add(port, pid, "tcp");
  }
  for (const line of udp.stdout.split("\n")) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 4 || cols[0] !== "UDP") continue;
    const port = Number(cols[1]?.split(":").pop());
    const pid = Number(cols[cols.length - 1]);
    if (!port || !pid) continue;
    add(port, pid, "udp");
  }
  return [...results.values()].sort((a, b) => a.port - b.port || a.protocol.localeCompare(b.protocol));
}

/**
 * Parse `lsof -iTCP -sTCP:LISTEN -n -P` output into listening sockets.
 * Exported for unit tests so the Linux path can be verified on any platform
 * without invoking lsof (the CI regression was a wrong column index here).
 *
 *   COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
 *   node    412 runner 21u IPv4 12345 0t0 TCP 127.0.0.1:18770 (LISTEN)
 */
export function parseLsofOutput(stdout: string): PortEntry[] {
  const entries = new Map<number, PortEntry>();
  for (const line of stdout.split("\n")) {
    if (!line.includes("LISTEN")) continue;
    const cols = line.trim().split(/\s+/);
    // "TCP <local_addr> (LISTEN)": local addr is the token right before (LISTEN)
    const li = cols.findIndex((c) => c === "TCP" || c === "TCP6");
    const local = li >= 0 ? cols[li + 1] : "";
    const port = Number((local ?? "").split(":").pop());
    const pid = Number(cols[1]);           // lsof pid is always column 2
    const name = cols[0] || "unknown";     // command is column 1
    if (!port || !Number.isInteger(pid) || pid === 0) continue;
    if (!entries.has(port))
      entries.set(port, { port, pid, protocol: "tcp", process: name, ...metaFor(port) });
  }
  return [...entries.values()].sort((a, b) => a.port - b.port);
}

/**
 * Parse `ss -tlnp` output into listening sockets.
 *
 *   State  Recv-Q Send-Q Local Address:Port  Peer Address:Port  Process
 *   LISTEN 0      4096   0.0.0.0:8080       0.0.0.0:*           users:(("node",pid=412,fd=21))
 *   LISTEN 0      128    [::]:443           [::]:*              users:(("nginx",pid=7,fd=6))
 */
export function parseSsOutput(stdout: string): PortEntry[] {
  const entries = new Map<number, PortEntry>();
  for (const line of stdout.split("\n")) {
    if (!line.trim().startsWith("LISTEN")) continue;
    const cols = line.trim().split(/\s+/);
    // column 4 is the LOCAL address:port (column 5 is the peer). bracketed
    // IPv6 like [::]:443 still yields "443" from the trailing split.
    const local = cols[3] ?? "";
    const port = Number(local.split(":").pop());
    const pm = line.match(/pid=(\d+)/);
    const nm = line.match(/users:\(\("([^"]+)"/);
    const pid = pm ? Number(pm[1]) : NaN;
    const name = nm?.[1] ?? "unknown";
    if (!port || !Number.isInteger(pid) || pid === 0) continue;
    if (!entries.has(port))
      entries.set(port, { port, pid, protocol: "tcp", process: name, ...metaFor(port) });
  }
  return [...entries.values()].sort((a, b) => a.port - b.port);
}

function mergeUnixEntries(groups: PortEntry[][]): PortEntry[] {
  const entries = new Map<number, PortEntry>();
  for (const group of groups)
    for (const e of group) if (!entries.has(e.port)) entries.set(e.port, e);
  return [...entries.values()].sort((a, b) => a.port - b.port);
}

async function parseUnix(): Promise<PortEntry[]> {
  // Try BOTH lsof and ss: either may be missing on a minimal runner, and a
  // tool can exist but lack permission to see another process's pid. Merging
  // the two views recovers sockets that one alone would silently drop.
  const [lsof, ss] = await Promise.allSettled([
    execTimeout("lsof", ["-iTCP", "-sTCP:LISTEN", "-n", "-P"]).then((r) => parseLsofOutput(r.stdout)),
    execTimeout("ss", ["-tlnp"]).then((r) => parseSsOutput(r.stdout)),
  ]);
  const groups: PortEntry[][] = [];
  if (lsof.status === "fulfilled") groups.push(lsof.value);
  if (ss.status === "fulfilled") groups.push(ss.value);
  return mergeUnixEntries(groups);
}

async function scan(): Promise<PortEntry[]> {
  return process.platform === "win32" ? parseWindows() : parseUnix();
}

export async function listDevPorts(): Promise<PortEntry[]> {
  const all = await scan();
  const set = new Set(COMMON_PORTS);
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
    const code = (err as { code?: number | string }).code;
    if (code === 128 || code === "ESRCH") throw new Error(`进程 ${pid} 不存在或已退出`);
    if (code === 5 || code === "EPERM")
      throw new Error(`终止进程 ${pid} 权限不足，请以管理员身份运行`);
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
      `if ($p) { $st = if ($p.StartTime) { $p.StartTime.ToString('yyyy-MM-dd HH:mm:ss') } else { 'N/A' }; ` +
      `[PSCustomObject]@{ Name=$p.ProcessName; Path=$p.Path; StartTime=$st } | ConvertTo-Json -Compress } else { "null" }`;
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
    const obj = JSON.parse(rawOut) as {
      Name?: string;
      Path?: string | null;
      StartTime?: string | null;
    };
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
    const { stdout } = await execTimeout("ps", ["-p", String(pid), "-o", "comm=,lstart=,args="], 8000);
    const line = stdout.trim();
    if (!line) throw new Error(`进程 ${pid} 不存在`);
    const parts = line.split(/\s+/);
    return { pid, name: parts[0] ?? "unknown", commandLine: line };
  } catch (err) {
    if (err instanceof Error && err.message.includes("不存在")) throw err;
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
    const finish = (ok: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve({ host, port, ok, latencyMs: Date.now() - started, error });
    };
    socket.once("connect", () => finish(true));
    socket.once("error", (err) =>
      finish(false, (err as NodeJS.ErrnoException).code ?? String(err)),
    );
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

export async function connectionStats(): Promise<ConnectionStats> {
  const stats: ConnectionStats = { listening: 0, established: 0, timeWait: 0, closeWait: 0, other: 0 };
  try {
    if (process.platform === "win32") {
      const { stdout } = await execTimeout("netstat", ["-ano", "-p", "tcp"]);
      for (const line of stdout.split("\n")) {
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
      for (const line of stdout.split("\n")) {
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
  return stats;
}
