(function () {
  var groups = {};
  try {
    groups = JSON.parse(localStorage.getItem("devdeck-groups") || "{}");
  } catch (e) {}
  function save() {
    try {
      localStorage.setItem("devdeck-groups", JSON.stringify(groups));
    } catch (e) {}
  }
  window.renderGroupFilter = function () {
    var sel = document.getElementById("groupFilter");
    if (!sel) return;
    var cur = sel.value;
    sel.innerHTML =
      '<option value="">全部分组</option>' +
      Object.keys(groups)
        .map(function (n) {
          return '<option value="' + n + '"' + (n === cur ? " selected" : "") + ">" + n + "</option>";
        })
        .join("");
  };
  window.addToGroup = function (name, port) {
    if (!name) return;
    if (!groups[name]) groups[name] = [];
    if (groups[name].indexOf(port) < 0) groups[name].push(port);
    save();
    window.renderGroupFilter();
  };
  window.removeGroup = function (name) {
    delete groups[name];
    save();
    window.renderGroupFilter();
  };
  window.getGroupPorts = function (name) {
    return groups[name] || [];
  };
  window.renderGroupList = function () {
    var box = document.getElementById("groupList");
    if (!box) return;
    var names = Object.keys(groups);
    if (!names.length) {
      box.innerHTML = '<span class="hint">暂无分组</span>';
      return;
    }
    box.innerHTML = names
      .map(function (n) {
        return (
          '<span class="ichip">' +
          n +
          " (" +
          groups[n].length +
          ')<button data-ungroup="' +
          n +
          '" title="删除分组">✕</button></span>'
        );
      })
      .join("");
  };
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-ungroup]");
    if (b) {
      window.removeGroup(b.dataset.ungroup);
      window.renderGroupList();
      return;
    }
    if (e.target.id === "groupAddBtn") {
      var name = document.getElementById("groupNameInput").value.trim();
      if (!name) {
        toast("请输入分组名", "error");
        return;
      }
      var p = Number(document.getElementById("groupPortInput").value);
      if (!Number.isInteger(p) || p <= 0) {
        toast("请输入有效端口", "error");
        return;
      }
      window.addToGroup(name, p);
      window.renderGroupList();
      document.getElementById("groupPortInput").value = "";
      toast("已加入分组 " + name, "success");
      return;
    }
  });
  document.addEventListener("change", function (e) {
    if (e.target.id === "groupFilter") {
      state.groupFilter = e.target.value;
      renderTable();
    }
  });
})();
