/* TurboFiles landing page - progressive enhancement only.
   With JS disabled every Download button still works: it points at the GitHub
   releases page. With JS, the buttons are upgraded to link DIRECTLY at the right
   installer for each OS/format, resolved from the latest GitHub release (no need
   to edit this file when you cut a new version). If you'd rather self-host the
   installers, drop a download/latest.json next to this file and it wins. */

(function () {
  "use strict";

  var GITHUB_REPO = "MartinOnami/TurboFiles"; // <-- change to your repo

  // Map each button to how we recognise its asset in a GitHub release.
  // Order matters for windows (prefer the NSIS -setup.exe over the .msi).
  var TARGETS = [
    { key: "macos", test: function (n) { return /\.dmg$/i.test(n); } },
    { key: "windows", test: function (n) { return /-setup\.exe$/i.test(n); }, alt: function (n) { return /\.msi$/i.test(n); } },
    { key: "windows_msi", test: function (n) { return /\.msi$/i.test(n); } },
    { key: "linux_appimage", test: function (n) { return /\.appimage$/i.test(n); } },
    { key: "linux_deb", test: function (n) { return /\.deb$/i.test(n); } },
    { key: "linux_rpm", test: function (n) { return /\.rpm$/i.test(n); } },
  ];

  // ---- highlight the visitor's platform -------------------------------------
  var ua = navigator.userAgent || "";
  var plat = navigator.platform || "";
  var os = /Win/i.test(ua + plat)
    ? "windows"
    : /Mac/i.test(ua + plat)
      ? "macos"
      : /Linux|X11/i.test(ua + plat)
        ? "linux"
        : null;

  if (os) {
    var card = document.querySelector('.os-card[data-os="' + os + '"]');
    if (card) {
      card.classList.add("is-current");
      var grid = document.getElementById("os-cards");
      if (grid && grid.firstChild !== card) grid.insertBefore(card, grid.firstChild);
    }
  }

  // ---- 1) self-hosted manifest wins, if present -----------------------------
  // download/latest.json: { "version": "0.1.0", "files": { "macos": "...dmg",
  //   "windows": "...exe", "linux_appimage": "...AppImage", "linux_deb": "...",
  //   "linux_rpm": "..." } }
  fetch("download/latest.json", { cache: "no-store" })
    .then(function (r) {
      if (!r.ok) throw new Error("no manifest");
      return r.json();
    })
    .then(function (m) {
      if (!m || !m.files) throw new Error("empty manifest");
      var dir = "download/" + (m.version ? m.version + "/" : "");
      Object.keys(m.files).forEach(function (k) {
        if (m.files[k]) setLink(k, dir + m.files[k], m.files[k]);
      });
      setVersion(m.version);
    })
    .catch(function () {
      // ---- 2) otherwise resolve assets from the latest GitHub release -------
      fetchGitHubRelease();
    });

  function fetchGitHubRelease() {
    fetch("https://api.github.com/repos/" + GITHUB_REPO + "/releases/latest", {
      headers: { Accept: "application/vnd.github+json" },
    })
      .then(function (r) {
        if (!r.ok) throw new Error("no release");
        return r.json();
      })
      .then(function (rel) {
        var assets = (rel && rel.assets) || [];
        TARGETS.forEach(function (t) {
          var hit = assets.filter(function (a) { return t.test(a.name); })[0];
          if (!hit && t.alt) hit = assets.filter(function (a) { return t.alt(a.name); })[0];
          if (hit) setLink(t.key, hit.browser_download_url, hit.name);
        });
        setVersion(rel && (rel.tag_name || rel.name));
      })
      .catch(function () {
        /* no release yet - buttons keep their releases-page fallback */
      });
  }

  function setLink(key, href, file) {
    if (!href) return;
    var links = document.querySelectorAll('[data-link="' + key + '"]');
    for (var i = 0; i < links.length; i++) {
      links[i].setAttribute("href", href);
      links[i].setAttribute("download", "");
      // Expose the exact filename on hover without clobbering the human-readable
      // card label (e.g. "Apple Silicon & Intel") shown in the .os-file span.
      if (file) links[i].setAttribute("title", file);
    }
  }

  function setVersion(v) {
    if (!v) return;
    var s = String(v);
    if (s[0] !== "v") s = "v" + s;
    var el = document.getElementById("version-line");
    if (el) el.textContent = "current release " + s;
  }

  // ---- copy-to-clipboard for the Linux install commands ---------------------
  var copyBtns = document.querySelectorAll(".fl-copy");
  for (var i = 0; i < copyBtns.length; i++) {
    copyBtns[i].addEventListener("click", function () {
      var btn = this;
      var cmd = btn.getAttribute("data-copy") || "";
      var done = function () {
        var prev = btn.textContent;
        btn.textContent = "Copied";
        btn.classList.add("is-copied");
        setTimeout(function () {
          btn.textContent = prev;
          btn.classList.remove("is-copied");
        }, 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(cmd).then(done, fallbackCopy);
      } else {
        fallbackCopy();
      }
      function fallbackCopy() {
        var ta = document.createElement("textarea");
        ta.value = cmd;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand("copy");
          done();
        } catch (e) {
          /* clipboard blocked - leave the command visible to select manually */
        }
        document.body.removeChild(ta);
      }
    });
  }
})();
