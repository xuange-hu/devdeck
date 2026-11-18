(function () {
  function ov(id) {
    return document.getElementById(id);
  }
  function openModal(id) {
    ov(id).classList.add("show");
  }

  window.showTimeline = function () {
    var now = Date.now();
    var list = state.ports
      .filter(function (p) {
        return p.firstSeen;
      })
      .sort(function (a, b) {
        return a.firstSeen - b.firstSeen;
      });
    if (!list.length) {
      ov("timelineBody").innerHTML = '<span class="hint">暂无数据</span>';
    } else {
      var earliest = list[0].firstSeen;
      var span = Math.max(1, now - earliest);
      ov("timelineBody").innerHTML = list
        .map(function (p) {
          var start = ((p.firstSeen - earliest) / span) * 100;
          var width = Math.max(2, ((now - p.firstSeen) / span) * 100);
          return (
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:12px"><span class="mono" style="min-width:50px">' +
            p.port +
            '</span><div style="flex:1;height:14px;background:var(--panel2);border-radius:4px;position:relative"><div style="position:absolute;left:' +
            start +
            "%;width:" +
            width +
            '%;height:100%;background:var(--pri);border-radius:4px"></div></div><span class="dim">' +
            fmtDuration(p.firstSeen) +
            "</span></div>"
          );
        })
        .join("");
    }
    openModal("timelineOverlay");
  };

  window.setPortColor = function (port, color) {
    try {
      var colors = JSON.parse(localStorage.getItem("devdeck-port-colors") || "{}");
      colors[port] = color;
      localStorage.setItem("devdeck-port-colors", JSON.stringify(colors));
      renderTable();
    } catch (e) {}
  };

  window.showDashboard = function () {
    var s = state.stats || {};
    var topMem = state.ports
      .filter(function (p) {
        return p.mem;
      })
      .sort(function (a, b) {
        return (b.mem || 0) - (a.mem || 0);
      })
      .slice(0, 5);
    var html =
      '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">' +
      '<span class="stat">监听 <b>' +
      (s.total || 0) +
      "</b></span>" +
      '<span class="stat">开发 <b>' +
      (s.dev || 0) +
      "</b></span>" +
      '<span class="stat">数据库 <b>' +
      (s.db || 0) +
      "</b></span>" +
      '<span class="stat">缓存 <b>' +
      (s.cache || 0) +
      "</b></span></div>" +
      '<p class="strong">内存 Top 5</p>' +
      topMem
        .map(function (p) {
          return (
            '<div style="display:flex;gap:10px;font-size:12px;padding:3px 0"><span class="mono" style="min-width:60px">' +
            p.port +
            '</span><span class="dim">' +
            esc(p.process) +
            '</span><span class="mono">' +
            fmtMem(p.mem) +
            "</span></div>"
          );
        })
        .join("");
    ov("dashBody").innerHTML = html;
    openModal("dashOverlay");
  };

  window.showWorkspace = function () {
    var ws = {
      search: state.search,
      category: state.category,
      scope: state.config.scope,
      view: state.view,
      groupFilter: state.groupFilter,
    };
    try {
      localStorage.setItem("devdeck-workspace", JSON.stringify(ws));
      toast("工作区已保存", "success");
    } catch (e) {}
  };

  window.loadWorkspace = function () {
    try {
      var ws = JSON.parse(localStorage.getItem("devdeck-workspace") || "null");
      if (!ws) {
        toast("暂无保存的工作区", "error");
        return;
      }
      state.search = ws.search || "";
      state.category = ws.category || "all";
      state.view = ws.view || "ports";
      state.groupFilter = ws.groupFilter || "";
      if (ws.scope && ws.scope !== state.config.scope) {
        state.config.scope = ws.scope;
        saveConfig({ scope: ws.scope });
      }
      document.getElementById("searchInput").value = state.search;
      setScopeUi(state.config.scope);
      renderChips();
      renderTable();
      toast("工作区已恢复", "success");
    } catch (e) {
      toast("工作区恢复失败", "error");
    }
  };

  var memHistory = {};
  window.checkMemLeak = function (ports) {
    ports.forEach(function (p) {
      if (!p.mem) return;
      if (!memHistory[p.port]) memHistory[p.port] = [];
      memHistory[p.port].push(p.mem);
      if (memHistory[p.port].length > 10) memHistory[p.port].shift();
      var h = memHistory[p.port];
      if (h.length >= 5) {
        var first = h[0],
          last = h[h.length - 1];
        if (last - first > 50 * 1024 && last > first * 1.2) {
          if (!window._leakAlerted) window._leakAlerted = new Set();
          if (!window._leakAlerted.has(p.port)) {
            window._leakAlerted.add(p.port);
            toast("内存增长告警：" + p.process + "（端口 " + p.port + "）内存持续上升", "error");
          }
        }
      }
    });
  };
})();

document.getElementById("timelineBtn").addEventListener("click", function () {
  showTimeline();
});
document.getElementById("dashBtn").addEventListener("click", function () {
  showDashboard();
});
document.getElementById("wsSaveBtn").addEventListener("click", function () {
  showWorkspace();
});
document.getElementById("wsLoadBtn").addEventListener("click", function () {
  loadWorkspace();
});
