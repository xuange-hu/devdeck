(function () {
  function applyAccent(c) {
    try {
      if (c) {
        document.documentElement.style.setProperty("--pri", c);
        localStorage.setItem("devdeck-accent", c);
      } else {
        document.documentElement.style.removeProperty("--pri");
        localStorage.removeItem("devdeck-accent");
      }
    } catch (e) {}
  }
  try {
    var ac = localStorage.getItem("devdeck-accent");
    if (ac) applyAccent(ac);
  } catch (e) {}
  document.addEventListener("input", function (e) {
    if (e.target.id === "accentInput") applyAccent(e.target.value);
  });
  document.addEventListener("click", function (e) {
    if (e.target.id === "accentReset") {
      applyAccent("");
      document.getElementById("accentInput").value = "#58a6ff";
    }
  });
})();
