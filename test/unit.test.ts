import { test } from "node:test";
import assert from "node:assert/strict";
import { metaFor, parseLsofOutput, parseSsOutput } from "../src/core/ports.js";
import { intList, type DevDeckConfig } from "../src/core/config.js";
import { normalizeConfig, toCsv } from "../src/core/serialize.js";
import { dispWidth, pad } from "../src/core/text.js";

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

test("intList: 过滤与去重", () => {
  assert.deepEqual(intList(null), []);
  assert.deepEqual(intList("x"), []);
  assert.deepEqual(intList([8080, 8080, 3000]), [8080, 3000]);
  assert.deepEqual(intList([0, -1, 70000, 1.5, "80"]), []);
  assert.deepEqual(intList([65535, 65536]), [65535]);
});

const base: DevDeckConfig = { favorites: [], ignored: [], interval: 3, scope: "dev" };

test("normalizeConfig: interval 校验", () => {
  assert.equal(normalizeConfig({ interval: 15 }, base).interval, 15);
  assert.equal(normalizeConfig({ interval: 0 }, base).interval, 0);
  assert.equal(normalizeConfig({ interval: 100 }, base).interval, 3);
  assert.equal(normalizeConfig({ interval: -1 }, base).interval, 3);
  assert.equal(normalizeConfig({ interval: 2.6 }, base).interval, 3);
});

test("normalizeConfig: scope 与列表去重", () => {
  assert.equal(normalizeConfig({ scope: "all" }, base).scope, "all");
  assert.equal(normalizeConfig({ scope: "bad" as never }, base).scope, "dev");
  assert.deepEqual(normalizeConfig({ favorites: [8080, 8080, 0, 99999] }, base).favorites, [8080]);
});

test("toCsv: BOM/表头/转义", () => {
  const csv = toCsv([
    { port: 8080, pid: 1, process: 'a,b"', mem: 100, category: "dev", label: "L" },
  ]);
  assert.ok(csv.startsWith("\uFEFF"));
  const lines = csv.slice(1).split("\r\n");
  assert.equal(lines[0], "port,process,pid,memory_kb,category,label");
  assert.equal(lines[1], '8080,"a,b""",1,100,dev,"L"');
});

test("dispWidth/pad: 中文宽度与对齐", () => {
  assert.equal(dispWidth("abc"), 3);
  assert.equal(dispWidth("中文"), 4);
  assert.equal(dispWidth("a中"), 3);
  assert.equal(pad("中文", 6), "中文  ");
  assert.equal(pad("ab", 5), "ab   ");
  assert.equal(pad("中文", 2), "中文");
});

// Linux 端口解析回归：CI 连续失败的根因是 lsof/ss 取错列，导致监听端口
// 全被丢弃、check 命令误报「空闲」。用真实命令输出样例验证，跨平台可跑。
test("parseLsofOutput: 真实 lsof 输出的 pid 与端口", () => {
  const out = [
    "COMMAND     PID  USER   FD   TYPE  DEVICE SIZE/OFF NODE NAME",
    "node        412 runner 21u  IPv4  12345      0t0  TCP 127.0.0.1:18770 (LISTEN)",
    "nginx       7   root    6u  IPv4  99999      0t0  TCP 0.0.0.0:80 (LISTEN)",
    "postgres   900  root   12u  IPv6  88888      0t0  TCP [::1]:5432 (LISTEN)",
    "node        5   runner 10u  IPv4  11111      0t0  TCP 10.0.0.1:5555->10.0.0.2:443 (ESTABLISHED)",
  ].join("\n");
  const entries = parseLsofOutput(out);
  const byPort = new Map(entries.map((e) => [e.port, e]));
  assert.equal(byPort.get(18770)?.pid, 412);
  assert.equal(byPort.get(18770)?.process, "node");
  assert.equal(byPort.get(80)?.pid, 7);
  assert.equal(byPort.get(5432)?.pid, 900);
  assert.equal(byPort.has(5555), false, "ESTABLISHED 不是监听，应忽略");
});

test("parseSsOutput: 真实 ss 输出的本地端口（非 peer）", () => {
  const out = [
    "State   Recv-Q Send-Q Local Address:Port   Peer Address:Port  Process",
    "LISTEN  0      4096    0.0.0.0:8080        0.0.0.0:*          users:((\"node\",pid=412,fd=21))",
    "LISTEN  0      128     [::]:443            [::]:*             users:((\"nginx\",pid=7,fd=6))",
    "LISTEN  0      128     127.0.0.1:18770     0.0.0.0:*          users:((\"node\",pid=999,fd=30))",
  ].join("\n");
  const entries = parseSsOutput(out);
  const byPort = new Map(entries.map((e) => [e.port, e]));
  assert.equal(byPort.get(8080)?.pid, 412);
  assert.equal(byPort.get(8080)?.process, "node");
  assert.equal(byPort.get(443)?.pid, 7, "IPv6 [::]:443 的端口应取 443");
  assert.equal(byPort.get(18770)?.pid, 999);
  assert.equal(byPort.has(0), false, "peer 的 0.0.0.0:* 不能被当成端口 0");
});
