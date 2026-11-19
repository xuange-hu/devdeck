import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startServer } from "./core/server.js";
import { killPort, listAllListening, listDevPorts, type PortEntry } from "./core/ports.js";
import { toMarkdown, toHtml, toExcelXml } from "./core/serialize.js";
import { dispWidth, pad } from "./core/text.js";

const exec = promisify(execFile);
const HERE = (() => {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
})();

interface Flags {
  port?: number;
  interval?: number;
  format?: string;
  out?: string;
  noOpen: boolean;
  all: boolean;
  json: boolean;
  tree: boolean;
}

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
} as const;
type ColorName = keyof typeof ANSI;

let USE_COLOR = !("NO_COLOR" in process.env);

function color(text: string, c: ColorName): string {
  return USE_COLOR ? ANSI[c] + text + ANSI.reset : text;
}

const FALLBACK_VERSION = "0.1.0";

// 构建期由 esbuild define 注入；SEA 单文件里没有 package.json，靠它拿到真实版本
declare const __DEVDECK_VERSION__: string | undefined;

function getVersion(): string {
  if (typeof __DEVDECK_VERSION__ === "string" && __DEVDECK_VERSION__) return __DEVDECK_VERSION__;
  const paths = [join(HERE, "../package.json"), join(HERE, "../../package.json")];
  for (const p of paths) {
    try {
      const pkg = JSON.parse(readFileSync(p, "utf-8")) as { version?: string };
      if (pkg.version) return pkg.version;
    } catch {
      continue;
    }
  }
  return FALLBACK_VERSION;
}

function parseFlags(args: string[]): Flags {
  const flags: Flags = { noOpen: false, all: false, json: false, tree: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--port" || arg === "-p") {
      const value = Number(args[i + 1]);
      if (Number.isInteger(value) && value > 0 && value < 65536) flags.port = value;
      i++;
    } else if (arg === "--interval" || arg === "-i") {
      const value = Number(args[i + 1]);
      if (Number.isFinite(value) && value >= 0.5 && value <= 60) flags.interval = value;
      i++;
    } else if (arg === "--format" || arg === "-f") {
      flags.format = args[i + 1];
      i++;
    } else if (arg === "--out" || arg === "-o") {
      flags.out = args[i + 1];
      i++;
    } else if (arg === "--no-open") {
      flags.noOpen = true;
    } else if (arg === "--all" || arg === "-a") {
      flags.all = true;
    } else if (arg === "--json") {
      flags.json = true;
    } else if (arg === "--tree") {
      flags.tree = true;
    } else if (arg === "--no-color") {
      USE_COLOR = false;
    }
  }
  return flags;
}

const HELP = `DevDeck v${getVersion()} — 开发端口监管控制台

用法:
  devdeck                启动 Web 控制台（默认 http://127.0.0.1:7676）
  devdeck ui [选项]       启动 Web 控制台
                         --port, -p <端口>     指定控制台端口（默认 7676）
                         --no-open             不自动打开浏览器
  devdeck scan [选项]     终端列出监听端口
                         --all, -a             显示全部端口（默认仅常用开发端口）
                         --json                以 JSON 输出
  devdeck watch [选项]    终端实时监控刷新
                         --interval, -i <秒>   刷新间隔（默认 3 秒）
                         --all, -a             监控全部端口
  devdeck find <查询>     按端口/进程名/服务查找占用
                         --all, -a             在全部端口中查找
  devdeck export [选项]   导出端口列表到文件
                         --format, -f <csv|json|md>  导出格式（默认 csv）
                         --out, -o <路径>         输出文件（默认 devdeck-ports-<时间>.<格式>）
                         --all, -a                导出全部端口
  devdeck kill <pid>...  终止指定进程（可一次多个）
  --tree  终止进程树
  devdeck kill-port <端口>...  按端口终止占用进程
  devdeck help           显示本帮助
  devdeck version        显示版本号

通用选项:
  --no-color             禁用彩色输出（或设置 NO_COLOR 环境变量）

快捷键（Web 控制台）:
  /  聚焦搜索框    r  立即刷新    Esc  关闭弹窗`;

function renderTable(entries: PortEntry[], title: string, newPorts?: Set<number> | null): void {
  if (title) console.log(color(title, "bold"));
  if (entries.length === 0) {
    console.log(color("  （无监听端口）", "dim"));
    return;
  }
  const catName: Record<string, string> = { dev: "开发", db: "数据库", cache: "缓存", other: "其他" };
  const catColor: Record<string, ColorName> = {
    dev: "blue",
    db: "magenta",
    cache: "yellow",
    other: "gray",
  };
  const head = ["端口", "分类", "服务", "进程", "PID", "内存"];
  const body = entries.map((e) => [
    String(e.port),
    catName[e.category] ?? e.category,
    e.label,
    e.process,
    String(e.pid),
    e.mem ? `${Math.round(e.mem / 1024)} MB` : "—",
  ]);
  const widths = head.map((h, i) =>
    Math.max(dispWidth(h), ...body.map((r) => dispWidth(r[i] ?? "")), i === 0 ? 6 : 0),
  );
  console.log(head.map((h, i) => pad(h, widths[i] ?? 0)).join("  "));
  console.log(widths.map((w) => "─".repeat(w)).join("  "));
  body.forEach((r, idx) => {
    const e = entries[idx];
    const isNew = e && newPorts ? newPorts.has(e.port) : false;
    const cells = r.map((cell, i) => {
      const p = pad(cell, widths[i] ?? 0);
      if (i === 0) return color(p, isNew ? "green" : "cyan");
      if (i === 1 && e) return color(p, catColor[e.category] ?? "gray");
      if (i === 3) return color(p, "dim");
      if (i === 4) return color(p, "gray");
      return p;
    });
    console.log(cells.join("  ") + (isNew ? "  " + color("NEW", "green") : ""));
  });
}

function summarize(entries: PortEntry[], all: boolean): string {
  const c = { dev: 0, db: 0, cache: 0, other: 0 };
  for (const e of entries) c[e.category] += 1;
  const range = all ? "全部端口" : "常用开发端口（--all 查看全部）";
  return color(
    `共 ${entries.length} 个监听端口  开发 ${c.dev}  数据库 ${c.db}  缓存 ${c.cache}  其他 ${c.other}  · ${range}`,
    "green",
  );
}

async function cmdScan(flags: Flags): Promise<void> {
  const entries = flags.all ? await listAllListening() : await listDevPorts();
  if (flags.json) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }
  renderTable(entries, "⬢ DevDeck 端口扫描");
  console.log("");
  console.log(summarize(entries, flags.all));
}

async function cmdWatch(flags: Flags): Promise<void> {
  const interval = flags.interval ?? 3;
  let prev: Set<number> | null = null;
  const tick = async () => {
    const entries = flags.all ? await listAllListening() : await listDevPorts();
    const current = new Set(entries.map((e) => e.port));
    process.stdout.write("\x1b[2J\x1b[H");
    const now = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    renderTable(entries, `⬢ DevDeck 实时监控  ${now}  · 每 ${interval}s 刷新  · Ctrl+C 退出`, prev);
    prev = current;
    console.log("");
    console.log(summarize(entries, flags.all));
  };
  await tick();
  const timer = setInterval(() => {
    void tick();
  }, interval * 1000);
  process.on("SIGINT", () => {
    clearInterval(timer);
    process.stdout.write("\n已停止监控\n");
    process.exit(0);
  });
}

async function cmdFind(query: string, flags: Flags): Promise<void> {
  if (!query) {
    console.error("用法: devdeck find <端口|进程名|服务名>");
    process.exitCode = 1;
    return;
  }
  const entries = flags.all ? await listAllListening() : await listDevPorts();
  const kw = query.toLowerCase();
  const matched = entries.filter(
    (e) =>
      String(e.port) === kw ||
      String(e.port).includes(kw) ||
      e.process.toLowerCase().includes(kw) ||
      e.label.toLowerCase().includes(kw),
  );
  if (matched.length === 0) {
    console.log(color(`未找到匹配「${query}」的监听端口`, "yellow"));
    if (!flags.all) console.log(color("提示: 加 --all 可在全部端口中查找", "dim"));
    return;
  }
  renderTable(matched, `匹配「${query}」的端口`);
}

async function cmdExport(flags: Flags): Promise<void> {
  const entries = flags.all ? await listAllListening() : await listDevPorts();
  const format = flags.format === "json" ? "json" : flags.format === "md" ? "md" : flags.format === "html" ? "html" : flags.format === "xls" ? "xls" : "csv";
  let content: string;
  if (format === "json") {
    content = JSON.stringify(entries, null, 2);
  } else if (format === "md") {
    content = toMarkdown(entries, { scope: flags.all ? "all" : "dev" });
  } else if (format === "html") {
    content = toHtml(entries, { scope: flags.all ? "all" : "dev" });
  } else if (format === "xls") {
    content = toExcelXml(entries);
  } else {
    const header = "port,process,pid,memory_kb,category,label";
    const rows = entries.map(
      (e) =>
        `${e.port},"${e.process.replace(/"/g, '""')}",${e.pid},${e.mem ?? ""},${e.category},"${e.label}"`,
    );
    content = "\uFEFF" + [header, ...rows].join("\r\n");
  }
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const out = flags.out ?? `devdeck-ports-${stamp}.${format}`;
  writeFileSync(out, content, "utf-8");
  console.log(color("✓", "green") + ` 已导出 ${entries.length} 条端口记录 → ${out}`);
}

async function cmdFree(start: number, end: number): Promise<void> {
  if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start || start < 1 || end > 65535) {
    console.error("用法: devdeck free <起> <止>   （示例: devdeck free 8000 8100）");
    process.exitCode = 2;
    return;
  }
  const entries = await listAllListening();
  const used = new Set(entries.map((e) => e.port));
  const free: number[] = [];
  for (let p = start; p <= end && free.length < 20; p++) {
    if (!used.has(p)) free.push(p);
  }
  if (free.length === 0) {
    console.log(color(`范围 ${start}-${end} 内无空闲端口`, "yellow"));
  } else {
    console.log(color(`范围 ${start}-${end} 内空闲端口（前 ${free.length} 个）：`, "green"));
    console.log(free.join(", "));
  }
}

async function cmdCheck(query: string): Promise<void> {
  const port = Number(query);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error("用法: devdeck check <端口>");
    process.exitCode = 2;
    return;
  }
  const entries = await listAllListening();
  const hit = entries.find((e) => e.port === port);
  if (hit) {
    console.log(color(`端口 ${port} 被占用`, "yellow") + `：${hit.process}（PID ${hit.pid}）`);
    process.exitCode = 1;
  } else {
    console.log(color(`端口 ${port} 空闲`, "green"));
  }
}

async function cmdKillByPort(ports: string[]): Promise<void> {
  if (ports.length === 0) {
    console.error("用法: devdeck kill-port <端口> [端口...]");
    process.exitCode = 1;
    return;
  }
  const entries = await listAllListening();
  for (const raw of ports) {
    const port = Number(raw);
    const hit = entries.find((e) => e.port === port);
    if (!hit) {
      console.error(color("✗", "red") + ` 端口 ${port} 当前未被监听`);
      continue;
    }
    try {
      await killPort(hit.pid);
      console.log(color("✓", "green") + ` 端口 ${port}（${hit.process}，PID ${hit.pid}）已终止`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(color("✗", "red") + " " + message);
    }
  }
}

async function cmdKill(pids: string[], tree = false): Promise<void> {
  if (pids.length === 0) {
    console.error("用法: devdeck kill <pid> [pid...]");
    process.exitCode = 1;
    return;
  }
  let failed = 0;
  for (const raw of pids) {
    const pid = Number(raw);
    try {
      await killPort(pid, tree);
      console.log(color("✓", "green") + ` 已终止进程 ${pid}`);
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(color("✗", "red") + ` ${message}`);
    }
  }
  if (failed > 0) process.exitCode = 1;
}

async function openAppWindow(url: string): Promise<void> {
  if (process.platform === "win32") {
    const candidates: [string, string][] = [
      ["chrome", "--app=" + url],
      ["msedge", "--app=" + url],
    ];
    for (const [cmd, arg] of candidates) {
      try {
        await exec("cmd", ["/c", "start", "", cmd, arg], { windowsHide: true });
        return;
      } catch {
        /* 尝试下一个浏览器 */
      }
    }
  }
  await openAppWindow(url);
}

async function openBrowser(url: string): Promise<void> {
  try {
    if (process.platform === "win32") {
      await exec("cmd", ["/c", "start", "", url], { windowsHide: true });
    } else if (process.platform === "darwin") {
      await exec("open", [url]);
    } else {
      await exec("xdg-open", [url]);
    }
  } catch {
    console.log(`无法自动打开浏览器，请手动访问: ${url}`);
  }
}

async function cmdUi(flags: Flags): Promise<void> {
  const running = await startServer(flags.port ?? 7676);
  const url = `http://127.0.0.1:${running.port}`;
  console.log("");
  console.log(color("  ⬢ DevDeck 端口监管控制台 已启动", "bold"));
  console.log(`  ➜ 地址: ${color(url, "cyan")}`);
  console.log("  ➜ 按 Ctrl+C 停止服务");
  console.log("");
  if (!flags.noOpen) {
    await openBrowser(url);
  }
  const shutdown = () => {
    console.log("\n正在停止 DevDeck…");
    running.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  switch (cmd ?? "ui") {
    case "ui":
    case "start":
      await cmdUi(flags);
      break;
    case "scan":
    case "list":
      await cmdScan(flags);
      break;
    case "watch":
      await cmdWatch(flags);
      break;
    case "find": {
      const query = rest.find((a) => !a.startsWith("-")) ?? "";
      await cmdFind(query, flags);
      break;
    }
    case "export":
      await cmdExport(flags);
      break;
    case "free": {
      const a = Number(rest.find((x) => !x.startsWith("-")) ?? 0);
      const b = Number(rest.filter((x) => !x.startsWith("-"))[1] ?? 0);
      await cmdFree(a, b);
      break;
    }
    case "check": {
      const q = rest.find((a) => !a.startsWith("-")) ?? "";
      await cmdCheck(q);
      break;
    }
    case "kill-port":
    await cmdKillByPort(rest.filter((a) => !a.startsWith("-")));
      break;
    case "kill": {
      const pids = rest.filter((a) => !a.startsWith("-"));
      await cmdKill(pids, flags.tree);
      break;
    }
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      break;
    case "version":
    case "--version":
    case "-v":
      console.log(`DevDeck v${getVersion()}`);
      break;
    default:
      console.error(`未知命令: ${cmd}\n`);
      console.log(HELP);
      process.exitCode = 1;
  }
}

process.on("uncaughtException", (err) => {
  console.error("未捕获异常:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("未处理的 Promise rejection:", reason);
  process.exit(1);
});

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`执行出错: ${message}`);
  process.exit(1);
});