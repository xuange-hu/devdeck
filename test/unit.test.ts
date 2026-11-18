import { test } from "node:test";
import assert from "node:assert/strict";
import { metaFor } from "../src/core/ports.js";
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
