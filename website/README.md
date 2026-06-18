# TurboFiles website

A self-contained landing page for TurboFiles. No build step: it's plain HTML/CSS/JS you
can drop on any static host (Nginx, S3/CloudFront, GitHub Pages, your own server).

```
website/
├── index.html        # the landing page
├── styles.css        # design tokens mirror the app (accent blue, deep-blue gradient)
├── main.js           # progressive enhancement: OS detection + download links
├── assets/
│   └── logo.png       # app mark
└── download/          # (you create) self-hosted installers + latest.json
```

## Preview locally

```bash
cd website
python3 -m http.server 8080      # then open http://localhost:8080
```

Use a server, not `file://`, so `main.js` can fetch `download/latest.json`.

## Wiring up the download buttons

The page works out of the box: every **Download** button points at the GitHub
releases page. To serve installers from **your own server** instead:

1. Build the installers and gather them:
   ```bash
   npm run tauri:build               # on each OS (or use CI artifacts)
   scripts/collect-bundles.sh        # -> release-uploads/<version>/ (+ latest.json)
   ```
2. Upload that folder under the site as `download/<version>/`, and copy the newest
   `latest.json` to `download/latest.json`:
   ```bash
   rsync -avz release-uploads/0.1.0/ user@server:/var/www/turbofiles/download/0.1.0/
   cp release-uploads/0.1.0/latest.json /var/www/turbofiles/download/latest.json
   ```
3. `main.js` fetches `download/latest.json` and rewrites the buttons to point at your
   files, shows the version, and highlights the visitor's OS. Adjust the `base`
   constant in `main.js` if you host installers elsewhere.

See [`../docs/INSTALL.md`](../docs/INSTALL.md) and
[`../docs/PERMISSIONS.md`](../docs/PERMISSIONS.md) for build, signing and notarization.

## Customizing

- **Domain/links:** the page links to `github.com/MartinOnami/TurboFiles` (set
  `GITHUB_REPO` in `main.js` if your repo differs). The product domain is
  `xfusion.io`.
- **Screenshots:** the app UI is recreated in pure HTML/CSS (hero window, assistant
  chat, Site Manager modal). To use real PNG screenshots instead, replace the
  `.window` / `.chat` / `.modal-demo` blocks in `index.html` with `<img>` tags.
- **Dark mode** follows the visitor's OS preference automatically.
