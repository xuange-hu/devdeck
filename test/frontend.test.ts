import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, "..", "src", "web");
const html = readFileSync(join(WEB, "index.html"), "utf-8");

test("前端不再依赖外部脚本，发布包单文件可运行", () => {
  assert.doesNotMatch(html, /<script[^>]+src\s*=/i, "不应再有 <script src>");
  assert.doesNotMatch(html, /<link[^>]+href\s*=\s*["'](?!#|data:)/i, "不应再有外部样式/资源");
  assert.match(html, /__DEVDECK_TOKEN__/, "必须保留服务端注入令牌的占位符");
});

test("关键启动函数全部内联，避免 ReferenceError 首屏崩溃", () => {
  for (const name of [
    "renderGroupFilter",
    "checkMemThreshold",
    "checkMemLeak",
    "loadIntegrationInputs",
    "showTimeline",
    "showDashboard",
    "showWorkspace",
    "showSnapshotCompare",
    "showSearchSuggest",
    "batchTag",
    "showDurationRank",
    "showKeybindings",
    "renderGroupList",
    "getGroupPorts",
  ]) {
    assert.match(html, new RegExp(`function ${name}\\s*\\(`), `缺少函数 ${name}`);
  }
});

test("设置面板 DOM 分组完整，不再错误嵌套", () => {
  const groups = html.match(/class="sgroup"/g) ?? [];
  assert.ok(groups.length >= 7, `设置分组数量不足: ${groups.length}`);
  for (const id of ["ignoreList", "alertList", "customPortList", "groupList", "accentInput", "reportInput", "cfgExportBtn"]) {
    assert.ok(html.includes(`id="${id}"`), `缺少设置元素 ${id}`);
  }
});

test("表头与表体列顺序一致（占用在健康前）", () => {
  const thead = html.slice(html.indexOf("<thead>"), html.indexOf("</thead>"));
  assert.ok(thead.indexOf("c-age") < thead.indexOf("c-health"), "表头占用应在健康之前");
  const tbodyTemplate = html.slice(html.indexOf('var rows = list.map'), html.indexOf('var tbody = $("tbody")'));
  assert.ok(tbodyTemplate.indexOf('class="c-age"') < tbodyTemplate.indexOf('class="c-health"'), "表体占用应在健康之前");
});

test("无障碍与安全基础属性存在", () => {
  assert.ok(html.includes('role="dialog"'));
  assert.ok(html.includes('aria-modal="true"'));
  assert.ok(html.includes('aria-live="polite"'));
  assert.ok(html.includes('role="listbox"'));
  assert.ok(html.includes('aria-label="全选当前列表"'));
  assert.ok(html.includes('Content-Security-Policy') === false, "CSP 由服务端响应头提供");
});

test("src/web 下不再残留未加载的 .js 死代码", () => {
  const jsFiles = readdirSync(WEB).filter((f) => f.endsWith(".js"));
  assert.deepEqual(jsFiles, []);
});

test("前端导出走当前筛选列表，不再依赖服务端全量导出", () => {
  assert.ok(html.includes("var list = filtered();"));
  assert.ok(html.includes("devdeck-portlist-"));
  assert.ok(html.includes("port,protocol,address,process,pid,memory_kb,category,label,note,favorite"));
});

test("键盘快捷键先判断输入框，避免抢输入", () => {
  const typing = html.indexOf("var typing =");
  assert.ok(typing > -1, "缺少 typing 判断");
  for (const shortcut of ['e.key === "?"', 'e.key === "/"', 'e.key === "r" || e.key === "R"']) {
    const index = html.indexOf(shortcut, typing);
    assert.ok(index > typing, `${shortcut} 必须在 typing 检查之后`);
  }
});
test("焦点陷阱、键盘排序与刷新保留焦点", () => {
  assert.ok(html.includes("function trapFocus"));
  assert.ok(html.includes('document.addEventListener("keydown", trapFocus)'));
  assert.ok(html.includes("activeKey"));
  assert.ok(html.includes('data-sort="port" tabindex="0"'));
  assert.ok(html.includes('data-sort="process" tabindex="0"'));
  assert.ok(html.includes('data-sort="pid" tabindex="0"'));
});

test("令牌失效自动刷新与高对比主题覆盖", () => {
  assert.ok(html.includes("state.tokenExpired"));
  assert.ok(html.includes("location.reload()"));
  assert.ok(html.includes("html[data-theme=contrast] .cat"));
  assert.ok(html.includes("html[data-theme=contrast] .cfv.on"));
});