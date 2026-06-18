/* TurboFiles landing page — progressive enhancement only.
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
      card.style.outline = "2px solid #fff";
      card.style.outlineOffset = "2px";
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
        /* no release yet — buttons keep their releases-page fallback */
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

  // ---- first-launch helper modal --------------------------------------------
  // The OS security warning (Gatekeeper / SmartScreen) is shown by the OS itself
  // and can't be branded. This modal — the last screen we control before it —
  // pops up on download with the exact "open it anyway" steps for the user's OS.
  var HELP = {
    macos: {
      name: "Mac",
      steps: [
        'Double-click <b>TurboFiles</b> — a warning appears. Click <b>Done</b>.',
        'Open  → <b>System Settings</b> → <b>Privacy &amp; Security</b>.',
        'Scroll to <b>Security</b>, find "TurboFiles was blocked", click <b>Open Anyway</b>, then confirm with your password or Touch ID.',
      ],
      note: "macOS 14 or earlier: Control-click the app → Open → Open.",
    },
    windows: {
      name: "PC",
      steps: [
        'Run the installer — <b>"Windows protected your PC"</b> appears.',
        "Click <b>More info</b>.",
        "Click <b>Run anyway</b>, then install as usual.",
      ],
      note: "SmartScreen stops warning once the app builds reputation.",
    },
    linux: {
      name: "computer",
      steps: [
        "<b>AppImage:</b> right-click → Properties → allow executing (or <code>chmod +x</code>).",
        "Double-click to run — no system prompt.",
        "<b>.deb / .rpm:</b> install with your package manager as normal.",
      ],
      note: "Most desktops run AppImages straight away.",
    },
  };

  var modal = document.getElementById("launch-help");
  if (modal) {
    var stepsEl = modal.querySelector("[data-lh-steps]");
    var noteEl = modal.querySelector("[data-lh-note]");
    var osNameEl = modal.querySelector("[data-lh-osname]");
    var tabs = modal.querySelectorAll("[data-lh-tab]");
    var lastFocus = null;

    function render(key) {
      var h = HELP[key] || HELP.macos;
      stepsEl.innerHTML = "";
      h.steps.forEach(function (s) {
        var li = document.createElement("li");
        li.innerHTML = s;
        stepsEl.appendChild(li);
      });
      noteEl.innerHTML = h.note || "";
      if (osNameEl) osNameEl.textContent = h.name;
      for (var i = 0; i < tabs.length; i++) {
        tabs[i].classList.toggle("is-active", tabs[i].getAttribute("data-lh-tab") === key);
      }
    }

    function openModal() {
      render(os && HELP[os] ? os : "macos");
      lastFocus = document.activeElement;
      modal.hidden = false;
      // next frame -> CSS transition
      requestAnimationFrame(function () {
        modal.classList.add("is-open");
      });
      var ok = modal.querySelector(".lh__ok");
      if (ok) ok.focus();
      document.addEventListener("keydown", onKey);
    }

    function closeModal() {
      modal.classList.remove("is-open");
      document.removeEventListener("keydown", onKey);
      setTimeout(function () {
        modal.hidden = true;
      }, 180);
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    function onKey(e) {
      if (e.key === "Escape") closeModal();
    }

    for (var t = 0; t < tabs.length; t++) {
      tabs[t].addEventListener("click", function () {
        render(this.getAttribute("data-lh-tab"));
      });
    }
    var closers = modal.querySelectorAll("[data-lh-close]");
    for (var c = 0; c < closers.length; c++) {
      closers[c].addEventListener("click", closeModal);
    }

    // Open the helper whenever a download link is clicked (the download still
    // proceeds — we never preventDefault).
    var dlLinks = document.querySelectorAll('.os-card [data-link]');
    for (var d = 0; d < dlLinks.length; d++) {
      dlLinks[d].addEventListener("click", openModal);
    }
  }
})();
