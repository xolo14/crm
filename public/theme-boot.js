(function () {
  try {
    var key = "crm-ui-theme";
    var stored = localStorage.getItem(key);
    if (!stored || (stored !== "light" && stored !== "dark" && stored !== "system")) {
      try {
        var legacy = localStorage.getItem("theme");
        if (legacy === "light" || legacy === "dark" || legacy === "system") {
          stored = legacy;
          localStorage.setItem(key, legacy);
        }
      } catch (e) {}
      if (!stored) {
        try {
          var g = JSON.parse(localStorage.getItem("crm_general_settings") || "{}");
          if (g.theme === "light" || g.theme === "dark" || g.theme === "system") {
            stored = g.theme;
            localStorage.setItem(key, g.theme);
          }
        } catch (e2) {}
      }
    }
    var theme = stored || "system";
    var dark =
      theme === "dark" ||
      (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", !!dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  } catch (err) {}
})();
