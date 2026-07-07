/** Load GTM + gtag only on public pages (/apply, /verify). Skips internal CRM routes. */
(function () {
  function isPublicAnalyticsPath() {
    var p = (window.location.pathname || "/").replace(/\/+$/, "") || "/";
    if (p === "/apply" || p.indexOf("/apply/") === 0) return true;
    if (p.indexOf("/verify/") === 0) return true;
    return false;
  }

  function loadGtm() {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ "gtm.start": new Date().getTime(), event: "gtm.js" });
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtm.js?id=GTM-PVCW7N6K";
    document.head.appendChild(s);
  }

  function loadGtag() {
    window.dataLayer = window.dataLayer || [];
    function gtag() {
      window.dataLayer.push(arguments);
    }
    window.gtag = gtag;
    gtag("js", new Date());
    gtag("config", "GT-KVFT38ND");
    gtag("config", "AW-18146229952");

    window.gtag_report_conversion = function (url) {
      var callback = function () {
        if (typeof url !== "undefined") {
          window.location = url;
        }
      };
      gtag("event", "conversion", {
        send_to: "AW-18146229952/eAfTCK3sxckcEMD95cxD",
        value: 1.0,
        currency: "INR",
        event_callback: callback,
      });
      return false;
    };

    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=GT-KVFT38ND";
    document.head.appendChild(s);
  }

  function boot() {
    if (!isPublicAnalyticsPath()) return;
    loadGtm();
    loadGtag();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
