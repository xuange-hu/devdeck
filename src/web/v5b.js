(function () {
  function ov(id) {
    return document.getElementById(id);
  }
  function openModal(id) {
    ov(id).classList.add("show");
  }

  window.showSearchSuggest = function () {
    var kw = ov("searchInput").value.trim().toLowerCase();
    var box = ov("searchSuggest");
    if (!kw) {
      box.style.display = "none";
      return;
    }
    var set = new Set();
    state.ports.forEach(function (p) {
      if (String(p.port).indexOf(kw) >= 0) set.add(String(p.port));
      if (p.process.toLowerCase().indexOf(kw) >= 0) set.add(p.process);
    });
    var items = Array.from(set).slice(0, 8);
    if (!items.length) {
      box.style.display = "none";
      return;
    }
    box.innerHTML = items
      .map(function (v) {
        return '<div class="sugitem" data-sug="' + esc(v) + '">' + esc(v) + "</div>";
      })
      .join("");
    box.style.display = "block";
  };

  window.batchTag = function () {
    var pids = Array.from(state.selected);
    if (!pids.length) {
      toast("请先勾选端口", "error");
      return;
    }
    var color = prompt("输入颜色（如 #f85149）或留空取消", "#58a6ff");
    if (color === null) return;
    pids.forEach(function (pid) {
      var p = state.ports.find(function (x) {
        return x.pid === pid;
      });
      if (p) setPortColor(p.port, color);
    });
    toast("已批量设置颜色", "success");
  };

  window.showSnapshotCompare = function () {
    var a = null,
      b = null;
    try {
      a = JSON.parse(localStorage.getItem("devdeck-snapshot") || "null");
      b = state.ports.map(function (p) {
        return { port: p.port, pid: p.pid, process: p.process };
      });
    } catch (e) {}
    if (!a) {
      ov("compareBody").innerHTML = '<span class="hint">请先保存一次快照（点击「快照」按钮）</span>';
    } else {
      var am = {},
        bm = {};
      a.ports.forEach(function (p) {
        am[p.port] = p;
      });
      b.forEach(function (p) {
        bm[p.port] = p;
      });
      var html = '<div style="display:flex;gap:20px"><div style="flex:1"><p class="strong">上次快照</p>';
      html += a.ports
        .map(function (p) {
          var mark = bm[p.port] ? "" : "（已消失）";
          return '<div style="font-size:12px;padding:2px 0">' + p.port + " " + esc(p.process) + mark + "</div>";
        })
        .join("");
      html += '</div><div style="flex:1"><p class="strong">当前</p>';
      html += b
        .map(function (p) {
          var mark = am[p.port] ? "" : "（新增）";
          return '<div style="font-size:12px;padding:2px 0">' + p.port + " " + esc(p.process) + mark + "</div>";
        })
        .join("");
      html += "</div></div>";
      ov("compareBody").innerHTML = html;
    }
    openModal("compareOverlay");
  };

  window.backupToDir = function () {
    var dir = prompt("输入备份目录（如 D:\backups）", "");
    if (!dir) return;
    var data = JSON.stringify({ time: Date.now(), ports: state.ports }, null, 2);
    var blob = new Blob([data], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "devdeck-backup-" + Date.now() + ".json";
    a.click();
    toast("备份文件已下载（请保存到 " + dir + "）", "success");
  };

  window.showKeybindings = function () {
    openModal("keybindOverlay");
  };
})();

document.getElementById("compareBtn").addEventListener("click", function () {
  showSnapshotCompare();
});
document.getElementById("batchTagBtn").addEventListener("click", function () {
  batchTag();
});
document.getElementById("backupDirBtn").addEventListener("click", function () {
  backupToDir();
});
document.getElementById("keybindBtn").addEventListener("click", function () {
  showKeybindings();
});
document.getElementById("searchInput").addEventListener("input", function () {
  showSearchSuggest();
});
document.addEventListener("click", function (e) {
  var item = e.target.closest(".sugitem");
  if (item) {
    document.getElementById("searchInput").value = item.dataset.sug;
    document.getElementById("searchSuggest").style.display = "none";
    state.search = item.dataset.sug;
    renderTable();
  }
});
