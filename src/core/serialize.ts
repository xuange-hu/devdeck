import type { DevDeckConfig } from "./config.js";
import type { PortEntry } from "./ports.js";

export function normalizeConfig(input: Partial<DevDeckConfig>, base: DevDeckConfig): DevDeckConfig {
  const intList = (v: unknown): number[] | null => {
    if (!Array.isArray(v)) return null;
    const list = v.map(Number).filter((n) => Number.isInteger(n) && n > 0 && n < 65536);
    return [...new Set(list)];
  };
  const favorites = intList(input.favorites);
  const ignored = intList(input.ignored);
  const customPorts = intList(input.customPorts);
  const snapshotInterval = typeof input.snapshotInterval === "number" && input.snapshotInterval >= 0 && input.snapshotInterval <= 86400 ? Math.round(input.snapshotInterval) : base.snapshotInterval;
  const reportInterval = typeof input.reportInterval === "number" && input.reportInterval >= 0 && input.reportInterval <= 86400 ? Math.round(input.reportInterval) : base.reportInterval;
  const webhookUrl = typeof input.webhookUrl === "string" ? input.webhookUrl.slice(0, 2048) : base.webhookUrl;
  const interval =
    typeof input.interval === "number" &&
    Number.isFinite(input.interval) &&
    input.interval >= 0 &&
    input.interval <= 60
      ? Math.round(input.interval)
      : base.interval;
  const scope = input.scope === "all" || input.scope === "dev" ? input.scope : base.scope;
  return {
    favorites: favorites ?? base.favorites,
    ignored: ignored ?? base.ignored,
    customPorts: customPorts ?? base.customPorts,
    reportInterval,
    snapshotInterval,
    webhookUrl,
    interval,
    scope,
  };
}

export function toCsv(ports: PortEntry[]): string {
  const header = "port,process,pid,memory_kb,category,label";
  const rows = ports.map(
    (p) =>
      `${p.port},"${p.process.replace(/"/g, '""')}",${p.pid},${p.mem ?? ""},${p.category},"${p.label}"`,
  );
  return "\uFEFF" + [header, ...rows].join("\r\n");
}

export function toMarkdown(ports: PortEntry[], meta?: { scope?: string; generatedAt?: number }): string {
  const catName: Record<string, string> = { dev: "开发", db: "数据库", cache: "缓存", other: "其他" };
  const generatedAt = meta?.generatedAt ?? Date.now();
  const scopeLabel = meta?.scope === "all" ? "全部监听" : "常用开发端口";
  const lines = [
    "# DevDeck 端口报告",
    "",
    `- 生成时间：${new Date(generatedAt).toLocaleString("zh-CN")}`,
    `- 范围：${scopeLabel}`,
    `- 监听端口总数：${ports.length}`,
    "",
    "| 端口 | 分类 | 服务 | 进程 | PID | 内存(MB) |",
    "| ---: | --- | --- | --- | ---: | ---: |",
    ...ports.map(
      (p) =>
        `| ${p.port} | ${catName[p.category] ?? p.category} | ${p.label} | ${p.process} | ${p.pid} | ${p.mem ? Math.round(p.mem / 1024) : "—"} |`,
    ),
    "",
  ];
  return lines.join("\n");
}

function escHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function toHtml(ports: PortEntry[], meta?: { scope?: string; generatedAt?: number }): string {
  const generatedAt = meta?.generatedAt ?? Date.now();
  const rows = ports
    .map(
      (p) =>
        `<tr><td>${p.port}</td><td>${p.category}</td><td>${escHtml(p.label)}</td><td>${escHtml(p.process)}</td><td>${p.pid}</td><td>${p.mem ? Math.round(p.mem / 1024) : "—"}</td></tr>`,
    )
    .join("\n");
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>DevDeck 端口报告</title>
<style>body{font-family:system-ui,sans-serif;background:#0d1117;color:#e6edf3;padding:24px}h1{font-size:20px}table{border-collapse:collapse;width:100%;margin-top:16px}td,th{border:1px solid #30363d;padding:6px 10px;font-size:13px}th{background:#161b22;text-align:left}td:first-child{font-weight:600;color:#58a6ff}p{color:#8b949e}</style>
</head><body><h1>DevDeck 端口报告</h1>
<p>生成时间：${new Date(generatedAt).toLocaleString("zh-CN")} · 范围：${meta?.scope === "all" ? "全部监听" : "常用开发端口"} · 共 ${ports.length} 个监听端口</p>
<table><thead><tr><th>端口</th><th>分类</th><th>服务</th><th>进程</th><th>PID</th><th>内存(MB)</th></tr></thead>
<tbody>
${rows}
</tbody></table></body></html>`;
}

export function toExcelXml(ports: PortEntry[]): string {
  const header = ["端口", "分类", "服务", "进程", "PID", "内存(MB)"];
  const rows = ports.map((p) => [String(p.port), p.category, p.label, p.process, String(p.pid), p.mem ? String(Math.round(p.mem / 1024)) : ""]);
  const all = [header, ...rows];
  const body = all
    .map(
      (r) =>
        "    <Row>" +
        r
          .map(
            (c) =>
              `<Cell><Data ss:Type="String">${c.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</Data></Cell>`,
          )
          .join("") +
        "</Row>",
    )
    .join("\n");
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Ports">
  <Table>
${body}
  </Table>
 </Worksheet>
</Workbook>`;
}