(function () {
  var portColors = {};
  try {
    portColors = JSON.parse(localStorage.getItem("devdeck-port-colors") || "{}");
  } catch (e) {}
  window.getPortColor = function (port) {
    return portColors[port] || "";
  };
  window.setPortColor = function (port, color) {
    portColors[port] = color;
    try {
      localStorage.setItem("devdeck-port-colors", JSON.stringify(portColors));
    } catch (e) {}
    renderTable();
  };
  var PALETTE = ["#f85149", "#d29922", "#3fb950", "#58a6ff", "#bc8cff", "#f0883e", "#6e7681"];
  document.addEventListener("click", function (e) {
    var dot = e.target.closest(".colorDot");
    if (!dot) return;
    var port = Number(dot.dataset.colorPort);
    var next = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    window.setPortColor(port, next);
  });
})();
