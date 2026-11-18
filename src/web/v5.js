(function () {
  function ov(id) {
    return document.getElementById(id);
  }
  function openModal(id) {
    ov(id).classList.add("show");
  }

  window.showDurationRank = function () {
    var now = Date.now();
    var list = state.ports
      .filter(function (p) {
        return p.firstSeen;
      })
      .sort(function (a, b) {
        return a.firstSeen - b.firstSeen;
      })
      .slice(0, 15);
    ov("durationBody").innerHTML = list.length
      ? list
          .map(function (p, i) {
            return (
              '<div style="display:flex;gap:10px;align-items:center;padding:4px 0;font-size:12px"><span class="dim" style="min-width:24px">' +
              (i + 1) +
              '.</span><span class="mono" style="min-width:60px">' +
              p.port +
              '</span><span class="dim" style="flex:1">' +
              esc(p.process) +
              '</span><span class="mono" style="color:var(--pri)">' +
              fmtDuration(p.firstSeen) +
              "</span></div>"
            );
          })
          .join("")
      : '<span class="hint">暂无数据</span>';
    openModal("durationOverlay");
  };

  window.copyStartCommand = function (pid) {
    api("/api/process?pid=" + pid).then(function (d) {
      if (d.ok && d.detail && d.detail.commandLine) {
        var cmd = d.detail.commandLine;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(cmd).then(function () {
            toast("已复制启动命令", "success");
          });
        } else {
          toast("启动命令：" + cmd, "success");
        }
      } else {
        toast("无法获取启动命令（权限或 CIM 不可用）", "error");
      }
    });
  };

  window.showWorkdir = function (pid) {
    api("/api/process?pid=" + pid).then(function (d) {
      if (d.ok && d.detail && d.detail.path) {
        var dir = d.detail.path.replace(/\[^\]+$/, "").replace(/\/[^/]+$/, "");
        toast("工作目录：" + dir, "success");
      } else {
        toast("无法获取工作目录", "error");
      }
    });
  };

  window.checkStartupPorts = function () {
    var common = [3000, 5173, 8080, 5432, 6379, 3306];
    var occupied = state.ports.filter(function (p) {
      return common.indexOf(p.port) >= 0;
    });
    if (occupied.length) {
      toast(
        "启动预警：常用端口被占用 " +
          occupied
            .map(function (p) {
              return p.port + "(" + p.process + ")";
            })
            .join("、"),
        "error",
      );
    } else {
      toast("常用开发端口均空闲", "success");
    }
  };
})();

document.getElementById("durationBtn").addEventListener("click", function () {
  showDurationRank();
});
document.getElementById("startupCheckBtn").addEventListener("click", function () {
  checkStartupPorts();
});
