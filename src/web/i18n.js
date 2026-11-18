var LANG = "zh";
var I18N_EN = {
  "端口监管控制台": "Port Monitor",
  "监听": "Listening",
  "开发": "Dev",
  "数据库": "DB",
  "缓存": "Cache",
  "系统总计": "System",
  "刷新": "Refresh",
  "常用开发端口": "Dev Ports",
  "全部监听": "All Listening",
  "全部": "All",
  "其他": "Other",
  "端口": "Port",
  "服务": "Service",
  "进程": "Process",
  "内存": "Memory",
  "占用": "Age",
  "操作": "Actions",
  "设置": "Settings",
  "导出 CSV": "Export CSV",
  "导出 JSON": "Export JSON",
  "终止选中": "Kill Selected",
  "忽略选中": "Ignore Selected",
  "上次刷新": "Last refresh",
  "扫描耗时": "Scan time",
  "平台": "Platform",
  "监控中": "Live",
  "已暂停": "Paused",
  "实时监控（SSE）": "Live (SSE)",
  "连接异常": "Disconnected",
  "搜索端口 / 进程 / PID…": "Search port / process / PID…",
  "端口变化历史": "Port History",
  "已忽略的端口": "Ignored Ports",
  "暂无忽略的端口": "No ignored ports",
  "端口告警": "Port Alerts",
  "添加": "Add",
  "输入端口号，如 8080": "Enter port, e.g. 8080",
  "未设置告警端口": "No alert ports",
  "完成": "Done",
  "关闭": "Close",
  "取消": "Cancel",
  "确认终止": "Confirm Kill",
  "终止进程": "Kill Process",
  "批量终止进程": "Kill Processes",
  "进程详情": "Process Details",
  "进程名": "Process",
  "可执行路径": "Path",
  "启动时间": "Start Time",
  "命令行": "Command Line",
  "父进程": "Parent",
  "新监听": "Open",
  "已关闭": "Closed",
  "加载中…": "Loading…",
  "错误": "Error",
  "全选": "Select all",
  "收藏置顶": "Pin to top",
  "不再显示": "Hide",
  "复制释放命令": "Copy kill command",
  "立即刷新 (r)": "Refresh (r)",
  "开启新端口浏览器通知": "Enable browser notifications",
  "切换主题": "Toggle theme",
  "端口数量趋势（最近 60 次刷新）": "Port trend (last 60 refreshes)",
  "终止": "Kill",
  "忽略": "Ignore",
  "复制": "Copy",
  "当前没有监听中的端口，一切清闲": "No listening ports, all clear",
  "数据加载失败，请检查后端服务": "Failed to load, check backend",
  "重试": "Retry",
  "刷新": "Refresh",
  "暂无变化记录（服务运行期间监听端口的变化会记录在这里）": "No changes recorded yet",
  "（无权限读取或不可用）": "(no permission or unavailable)",
  "为端口": "For port",
  "设置备注（留空清除）": "set note (empty to clear)"
};
function t(s) {
  return LANG === "en" ? (I18N_EN[s] || s) : s;
}
function loadLang() {
  try {
    LANG = localStorage.getItem("devdeck-lang") || "zh";
  } catch (e) {
    LANG = "zh";
  }
}
function setLang(l) {
  LANG = l;
  try {
    localStorage.setItem("devdeck-lang", l);
  } catch (e) {}
  applyI18n();
}
function applyI18n() {
  var dict = I18N_EN;
  var areas = [
    document.querySelector("header"),
    document.querySelector(".toolbar"),
    document.querySelector("footer"),
  ];
  document.querySelectorAll(".modal .mhead h3").forEach(function (h) {
    areas.push(h);
  });
  areas.forEach(function (root) {
    if (!root) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    var nodes = [];
    var n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(function (node) {
      var v = node.nodeValue.trim();
      if (!v) return;
      if (!node.__zh) node.__zh = v;
      if (LANG === "en") {
        if (dict[v]) node.nodeValue = dict[v];
      } else {
        node.nodeValue = node.__zh;
      }
    });
  });
  document.querySelectorAll("[placeholder],[title]").forEach(function (el) {
    ["placeholder", "title"].forEach(function (attr) {
      var v = el.getAttribute(attr);
      if (!v) return;
      if (!el.__i18n) el.__i18n = {};
      if (!el.__i18n[attr]) el.__i18n[attr] = v;
      if (LANG === "en" && dict[v]) el.setAttribute(attr, dict[v]);
      else if (LANG === "zh") el.setAttribute(attr, el.__i18n[attr]);
    });
  });
  var lb = document.getElementById("langBtn");
  if (lb) lb.textContent = LANG === "en" ? "中" : "EN";
}
function bindLang() {
  var b = document.getElementById("langBtn");
  if (b)
    b.addEventListener("click", function () {
      setLang(LANG === "zh" ? "en" : "zh");
    });
}
