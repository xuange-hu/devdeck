(function () {
  function ov(id) {
    return document.getElementById(id);
  }
  function openModal(id) {
    ov(id).classList.add("show");
  }

  window.showBatchProbe = function () {
    openModal("batchProbeOverlay");
  };
  window.runBatchProbe = function () {
    var host = ov("batchHost").value.trim() || "127.0.0.1";
    var ports = ov("batchPorts").value.trim();
    if (!ports) {
      toast("请输入端口列表", "error");
      return;
    }
    ov("batchResult").textContent = "探测中…";
    api("/api/probe?host=" + encodeURIComponent(host) + "&ports=" + encodeURIComponent(ports)).then(function (d) {
      var rows = (d.results || []).map(function (r) {
        var color = r.ok ? "var(--ok)" : "var(--bad)";
        return (
          '<div style="display:flex;gap:10px;font-size:12px;padding:4px 0"><span class="mono" style="min-width:60px">' +
          r.port +
          '</span><span style="color:' +
          color +
          '">' +
          (r.ok ? "✓ 可连接" : "✗ " + (r.error || "失败")) +
          '</span><span class="dim">' +
          r.latencyMs +
          "ms</span></div>"
        );
      });
      ov("batchResult").innerHTML = rows.join("") || '<span class="hint">无结果</span>';
    });
  };

  window.showStats = function () {
    var list = state.ports;
    var byCat = {};
    list.forEach(function (p) {
      byCat[p.category] = (byCat[p.category] || 0) + 1;
    });
    var byProc = {};
    list.forEach(function (p) {
      byProc[p.process] = (byProc[p.process] || 0) + 1;
    });
    var procTop = Object.keys(byProc)
      .map(function (k) {
        return { name: k, n: byProc[k] };
      })
      .sort(function (a, b) {
        return b.n - a.n;
      })
      .slice(0, 8);
    var html = '<p class="strong">按分类</p><div style="display:flex;gap:12px;margin:8px 0">';
    ["dev", "db", "cache", "other"].forEach(function (c) {
      html +=
        '<span class="stat"><span class="dot d-' +
        c +
        '"></span>' +
        catName(c) +
        " <b>" +
        (byCat[c] || 0) +
        "</b></span>";
    });
    html += '</div><p class="strong">按进程（Top 8）</p>';
    html += procTop
      .map(function (p) {
        return (
          '<div style="display:flex;gap:10px;font-size:12px;padding:3px 0"><span class="mono" style="min-width:140px">' +
          esc(p.name) +
          '</span><span class="dim">' +
          p.n +
          " 个端口</span></div>"
        );
      })
      .join("");
    ov("statsBody").innerHTML = html;
    openModal("statsOverlay");
  };

  window.showFavPanel = function () {
    var fav = new Set(state.config.favorites);
    var list = state.ports.filter(function (p) {
      return fav.has(p.port);
    });
    if (!list.length) {
      ov("favBody").innerHTML = '<span class="hint">暂无收藏端口</span>';
    } else {
      ov("favBody").innerHTML = list
        .map(function (p) {
          return (
            '<div style="display:flex;gap:10px;align-items:center;padding:4px 0"><span class="mono" style="min-width:60px">' +
            p.port +
            '</span><span class="dim">' +
            esc(p.process) +
            '</span><button class="btn small danger" data-favkill="' +
            p.pid +
            '">终止</button></div>'
          );
        })
        .join("");
    }
    openModal("favOverlay");
  };

  window.showHealthTrend = function () {
    var d = state.trendHealth || [];
    if (d.length < 2) {
      ov("healthBody").innerHTML = '<span class="hint">数据收集中…</span>';
    } else {
      var w = 480,
        h = 120,
        max = Math.max.apply(null, d),
        min = Math.min.apply(null, d),
        range = Math.max(1, max - min);
      var pts = d
        .map(function (v, i) {
          var x = (i / (d.length - 1)) * w;
          var y = h - ((v - min) / range) * (h - 10) - 5;
          return x.toFixed(1) + "," + y.toFixed(1);
        })
        .join(" ");
      ov("healthBody").innerHTML =
        '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '"><polyline points="' + pts + '" fill="none" stroke="var(--pri)" stroke-width="2"/></svg>';
    }
    openModal("healthOverlay");
  };

  window.showHistoryReplay = function () {
    api("/api/history").then(function (d) {
      var ev = d.events || [];
      if (!ev.length) {
        ov("replayBody").innerHTML = '<span class="hint">暂无历史记录</span>';
      } else {
        ov("replayBody").innerHTML = ev
          .slice(0, 50)
          .map(function (e) {
            return (
              '<div class="ev ' +
              e.type +
              '"><span class="t">' +
              fmtTime(e.time) +
              '</span><span class="tag">' +
              (e.type === "open" ? "新监听" : "已关闭") +
              '</span><span class="p">' +
              e.port +
              '</span><span class="n">' +
              esc(e.process) +
              "</span></div>"
            );
          })
          .join("");
      }
      openModal("replayOverlay");
    });
  };

  window.exportFav = function () {
    var data = JSON.stringify(state.config.favorites, null, 2);
    var blob = new Blob([data], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "devdeck-favorites.json";
    a.click();
    toast("收藏已导出", "success");
  };

  window.importFav = function (file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var arr = JSON.parse(reader.result);
        if (!Array.isArray(arr)) throw new Error("bad");
        saveConfig({ favorites: arr }).then(function (ok) {
          if (ok) {
            toast("收藏已导入", "success");
            fetchPorts();
          }
        });
      } catch (e) {
        toast("收藏文件格式错误", "error");
      }
    };
    reader.readAsText(file);
  };

  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-favkill]");
    if (b) {
      killPids([Number(b.dataset.favkill)]);
      ov("favOverlay").classList.remove("show");
    }
  });
})();

document.getElementById("statsBtn").addEventListener("click", function () {
  showStats();
});
document.getElementById("favBtn").addEventListener("click", function () {
  showFavPanel();
});
document.getElementById("replayBtn").addEventListener("click", function () {
  showHistoryReplay();
});
document.getElementById("healthBtn").addEventListener("click", function () {
  showHealthTrend();
});
document.getElementById("batchGo").addEventListener("click", function () {
  runBatchProbe();
});
document.getElementById("favExportBtn").addEventListener("click", function () {
  exportFav();
});
document.getElementById("favImportBtn").addEventListener("click", function () {
  document.getElementById("favFileInput").click();
});
document.getElementById("favFileInput").addEventListener("change", function (e) {
  if (e.target.files[0]) importFav(e.target.files[0]);
  e.target.value = "";
});
