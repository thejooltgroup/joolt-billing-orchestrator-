/* JOOLT white-label bootstrap.
   Any page that includes <script src="/wl.js"></script> becomes re-skinnable:
   visiting ?ref=CODE pulls that reseller's brand and applies colors, name, and a
   "Powered by" badge. Fully fail-open — if anything is missing, the JOOLT default shows. */
(function () {
  try {
    var qs = new URLSearchParams(location.search);
    var ref = qs.get("ref");
    if (ref) { try { localStorage.setItem("joolt_ref", ref); } catch (e) {} }
    else { try { ref = localStorage.getItem("joolt_ref"); } catch (e) {} }
    if (!ref) return;
    ref = ref.toLowerCase().replace(/[^a-z0-9\-]/g, "").slice(0, 60);
    if (!ref) return;

    fetch("/api/brand?ref=" + encodeURIComponent(ref))
      .then(function (r) { return r.json(); })
      .then(function (b) {
        if (!b || !b.ok) return;
        var root = document.documentElement.style;
        // override every accent-var name our pages use, so the skin takes on any page
        if (b.primary) { ["--p", "--primary", "--brand", "--accent-1"].forEach(function (v) { root.setProperty(v, b.primary); }); }
        if (b.accent) { ["--c", "--accent", "--brand2", "--accent-2"].forEach(function (v) { root.setProperty(v, b.accent); }); }
        if (b.primary && b.accent) {
          var grad = "linear-gradient(135deg," + b.primary + "," + b.accent + ")";
          ["--grad"].forEach(function (v) { root.setProperty(v, grad); });
        }
        // brand name / logo swaps on marked elements
        if (b.name) {
          document.title = b.name;
          document.querySelectorAll("[data-wl-name], .brand .n").forEach(function (el) { el.textContent = b.name; });
        }
        if (b.logo) {
          document.querySelectorAll("[data-wl-logo], .brand .mark").forEach(function (el) { el.textContent = b.logo; });
        }
        if (b.tagline) {
          document.querySelectorAll("[data-wl-tagline]").forEach(function (el) { el.textContent = b.tagline; });
        }
        // powered-by badge (only when the reseller opts in)
        if (b.poweredBy && b.name) {
          var badge = document.createElement("div");
          badge.textContent = "Powered by " + b.name;
          badge.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:9999;font:600 11px/1 -apple-system,Segoe UI,Roboto,sans-serif;color:#fff;background:rgba(15,20,40,.72);border:1px solid rgba(255,255,255,.14);padding:7px 11px;border-radius:999px;backdrop-filter:blur(6px);pointer-events:none;letter-spacing:.3px;";
          (document.body || document.documentElement).appendChild(badge);
        }
      })
      .catch(function () {});
  } catch (e) {}
})();
