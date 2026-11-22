import { test } from "node:test";
import assert from "node:assert/strict";
import {
  metaFor,
  parseWindowsOutput,
  parseLsofOutput,
  parseSsOutput,
  type PortEntry,
  type ProcInfo,
} from "../src/core/ports.js";
import { intList, type DevDeckConfig } from "../src/core/config.js";
import { normalizeConfig, toCsv, toMarkdown, toExcelXml, csvEscape, escHtml } from "../src/core/serialize.js";
import { dispWidth, pad } from "../src/core/text.js";

const port = (over: Partial<PortEntry>): PortEntry => ({
  port: 8080,
  pid: 1,
  process: "node",
  protocol: "tcp",
  address: "0.0.0.0",
  category: "dev",
  label: "HTTP",
  ...over,
});

const base: DevDeckConfig = {
  favorites: [],
  ignored: [],
  customPorts: [],
  snapshotInterval: 0,
  reportInterval: 0,
  webhookUrl: "",
  interval: 3,
  scope: "dev",
};

test("metaFor: 已知端口分类", () => {
  assert.deepEqual(metaFor(5432), { category: "db", label: "PostgreSQL" });
  assert.deepEqual(metaFor(6379), { category: "cache", label: "Redis" });
  assert.equal(metaFor(8080).category, "dev");
  assert.equal(metaFor(9090).label, "Prometheus");
  assert.equal(metaFor(27017).category, "db");
});

test("metaFor: 未映射端口回退", () => {
  assert.equal(metaFor(12345).category, "other");
  assert.equal(metaFor(12345).label, "其他服务");
  assert.equal(metaFor(80).label, "系统服务");
});

test("intList: 过滤、去重、数字字符串", () => {
  assert.deepEqual(intList(null), []);
  assert.deepEqual(intList("x"), []);
  assert.deepEqual(intList([8080, 8080, 3000]), [8080, 3000]);
  assert.deepEqual(intList([0, -1, 70000, 1.5, "80", "1e3"]), [80]);
  assert.deepEqual(intList([65535, 65536]), [65535]);
});

test("parseWindowsOutput: TCP/UDP、同端口多地址、进程名", () => {
  const tcp = [
    "  Proto  Local Address          Foreign Address        State           PID",
    "  TCP    0.0.0.0:8080           0.0.0.0:0              LISTENING       1234",
    "  TCP    127.0.0.1:8080         0.0.0.0:0              LISTENING       5678",
  ].join("\r\n");
  const udp = [
    "  Proto  Local Address          Foreign Address        PID",
    "  UDP    0.0.0.0:5353           *:*                    9876",
  ].join("\r\n");
  const procs = new Map<number, ProcInfo>([
    [1234, { name: "node", memKb: 1024 }],
    [5678, { name: "python", memKb: 2048 }],
    [9876, { name: "dnsmasq", memKb: 512 }],
  ]);
  const entries = parseWindowsOutput(tcp, udp, procs);
  assert.equal(entries.length, 3);
  assert.deepEqual(entries.map((e) => e.port), [5353, 8080, 8080]);
  const v4 = entries.find((e) => e.port === 8080 && e.address === "0.0.0.0");
  const v6 = entries.find((e) => e.port === 8080 && e.address === "127.0.0.1");
  assert.equal(v4?.process, "node");
  assert.equal(v6?.process, "python");
  assert.equal(entries[0]?.protocol, "udp");
});

test("parseLsofOutput: PID/命令/多地址", () => {
  const stdout = [
    "p1234",
    "cnode",
    "n0.0.0.0:8080",
    "n[::]:8080",
    "p5678",
    "cpostgres",
    "n127.0.0.1:5432",
  ].join("\n");
  const entries = parseLsofOutput(stdout, "tcp");
  assert.equal(entries.length, 3);
  const node = entries.filter((e) => e.pid === 1234);
  assert.equal(node.length, 2);
  assert.equal(node[0]?.process, "node");
  assert.equal(node.find((e) => e.address === "0.0.0.0")?.port, 8080);
  assert.equal(entries.find((e) => e.port === 5432)?.process, "postgres");
});

test("parseLsofOutput: UDP 协议", () => {
  const entries = parseLsofOutput(["p9001", "cdnsmasq", "n*:5353"].join("\n"), "udp");
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.protocol, "udp");
  assert.equal(entries[0]?.port, 5353);
  assert.equal(entries[0]?.process, "dnsmasq");
});

test("parseSsOutput: 本地地址列与进程名", () => {
  const stdout = [
    "tcp LISTEN 0 511 127.0.0.1:8080 0.0.0.0:* users:((\"node\",pid=1234,fd=23))",
    "udp UNCONN 0 0 0.0.0.0:5353 0.0.0.0:* users:((\"dnsmasq\",pid=5678,fd=5))",
  ].join("\n");
  const entries = parseSsOutput(stdout);
  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.port, 5353);
  assert.equal(entries[0]?.protocol, "udp");
  assert.equal(entries[0]?.process, "dnsmasq");
  assert.equal(entries[1]?.port, 8080);
  assert.equal(entries[1]?.address, "127.0.0.1");
  assert.equal(entries[1]?.pid, 1234);
});

test("normalizeConfig: interval/scope/列表/Webhook 校验", () => {
  assert.equal(normalizeConfig({ interval: 15 }, base).interval, 15);
  assert.equal(normalizeConfig({ interval: 0 }, base).interval, 0);
  assert.equal(normalizeConfig({ interval: 100 }, base).interval, 3);
  assert.equal(normalizeConfig({ interval: -1 }, base).interval, 3);
  assert.equal(normalizeConfig({ interval: 2.6 }, base).interval, 3);
  assert.equal(normalizeConfig({ scope: "all" }, base).scope, "all");
  assert.equal(normalizeConfig({ scope: "bad" as never }, base).scope, "dev");
  assert.deepEqual(normalizeConfig({ favorites: [8080, 8080, 0, 99999] }, base).favorites, [8080]);
  assert.equal(normalizeConfig({ webhookUrl: "https://example.com/hook" }, base).webhookUrl, "https://example.com/hook");
  assert.throws(() => normalizeConfig({ webhookUrl: "file:///etc/passwd" }, base), /http/);
  assert.throws(() => normalizeConfig({ webhookUrl: "not a url" }, base), /格式/);
});

test("toCsv: 表头、协议/地址、引号与公式防护", () => {
  const csv = toCsv([
    port({ process: 'a,b"', label: "=SUM(A1)", address: "0.0.0.0" }),
    port({ port: 5353, protocol: "udp", address: "*", process: "dns", label: "DNS" }),
  ]);
  assert.ok(csv.startsWith("\uFEFF"));
  const lines = csv.slice(1).split("\r\n");
  assert.equal(lines[0], "port,protocol,address,process,pid,memory_kb,category,label");
  assert.ok(lines[1]?.includes('"a,b"""'));
  assert.ok(lines[1]?.includes("'=SUM(A1)"));
  assert.ok(lines[2]?.startsWith("5353,udp"));
  assert.equal(csvEscape('a,b"'), '"a,b"""');
  assert.equal(csvEscape("=1+1"), "'=1+1");
});

test("toMarkdown/toExcelXml: 转义与编码", () => {
  const entries = [port({ process: "a|b", label: "x<y", mem: 2048 })];
  const md = toMarkdown(entries);
  assert.ok(md.includes("a\\|b"));
  assert.ok(md.includes("| 端口 | 协议 | 地址 |"));
  const xls = toExcelXml([port({ process: "a&b<c", label: "L" })]);
  assert.ok(xls.includes('encoding="UTF-8"'));
  assert.ok(xls.includes("a&amp;b&lt;c"));
  assert.equal(escHtml("<x>&\"'"), "&lt;x&gt;&amp;&quot;&#39;");
});

test("dispWidth/pad: 中文宽度与对齐", () => {
  assert.equal(dispWidth("abc"), 3);
  assert.equal(dispWidth("中文"), 4);
  assert.equal(dispWidth("a中"), 3);
  assert.equal(pad("中文", 6), "中文  ");
  assert.equal(pad("ab", 5), "ab   ");
  assert.equal(pad("中文", 2), "中文");
});