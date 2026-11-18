(function () {
  document.addEventListener("click", function (e) {
    var t = e.target.closest('[data-act="open"]');
    if (t) {
      var url = "http://localhost:" + t.dataset.port;
      try {
        navigator.clipboard.writeText(url);
      } catch (err) {}
      window.open(url, "_blank");
    }
  });

  var memThreshold = 0;
  try {
    memThreshold = Number(localStorage.getItem("devdeck-mem-threshold") || 0);
  } catch (e) {}
  var memAlerted = new Set();
  window.checkMemThreshold = function (ports) {
    if (!memThreshold) return;
    ports.forEach(function (p) {
      if (p.mem && p.mem / 1024 > memThreshold && !memAlerted.has(p.port)) {
        memAlerted.add(p.port);
        toast(
          "内存告警：" + p.process + " 占用 " + Math.round(p.mem / 1024) + "MB（阈值 " + memThreshold + "MB）",
          "error",
        );
      }
    });
  };

  window.loadIntegrationInputs = function () {
    var mt = document.getElementById("memThresholdInput");
    var wh = document.getElementById("webhookInput");
    var sn = document.getElementById("snapshotInput");
    if (mt) mt.value = memThreshold || "";
    if (wh) wh.value = state.config.webhookUrl || "";
    if (sn) sn.value = state.config.snapshotInterval || "";
  };

  document.addEventListener("change", function (e) {
    var id = e.target.id;
    if (id === "memThresholdInput") {
      memThreshold = Number(e.target.value) || 0;
      try {
        localStorage.setItem("devdeck-mem-threshold", String(memThreshold));
      } catch (err) {}
      toast(memThreshold ? "内存阈值已设为 " + memThreshold + "MB" : "内存告警已关闭", "success");
    } else if (id === "webhookInput") {
      saveConfig({ webhookUrl: e.target.value.trim() }).then(function (ok) {
        if (ok) toast("Webhook 已保存", "success");
      });
    } else if (id === "snapshotInput") {
      var v = Number(e.target.value) || 0;
      saveConfig({ snapshotInterval: v }).then(function (ok) {
        if (ok) toast(v > 0 ? "定时快照已开启（每 " + v + "s）" : "定时快照已关闭", "success");
      });
    }
  });
})();
