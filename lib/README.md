# `lib/` — vendored third-party libraries

These files are **committed to the repo on purpose** so the app is fully
self-contained: GitHub Pages serves them from this same site, so there's no CDN
dependency and the app works offline. There is **no `npm install`** and no build
step — the browser loads these `.js` files directly via `<script>` tags.

> Libraries are downloaded into this folder in the feature step that first needs
> them (see the roadmap in `CLAUDE.md`), then committed.

## Libraries used

| File                  | Library / version       | Used for                                       | Source |
|-----------------------|-------------------------|------------------------------------------------|--------|
| `qrcode.js`           | qrcode-generator 1.4.4  | Building the QR matrix from the vCard text      | https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js |
| `jspdf.umd.min.js`    | jsPDF 2.5.2             | Generating the PDF; QR drawn as vector squares  | https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js |
| `amiri-font.js`       | Amiri Regular (SIL OFL 1.1), subset | Embedded Arabic font so the PDF can render Arabic | https://github.com/google/fonts/tree/main/ofl/amiri |
| `arabic-shaper.js`    | original (this repo)    | Reshapes + reorders Arabic text for the PDF (jsPDF does no shaping) | — |

`amiri-font.js` is a jsPDF font module: `Amiri-Regular.ttf` was subset (Latin + Arabic
+ presentation forms, layout tables dropped — we pre-shape ourselves) with `fonttools`,
base64-encoded, and wrapped so it registers itself as the `Amiri` font on every jsPDF
document. To regenerate: subset the TTF, then base64-encode it into the same wrapper.

## Rules for this folder
- **Pin a specific version** when vendoring; record the version and source URL here.
- Don't edit the library files by hand — re-download to upgrade and note the new version.
- Prefer the unminified build where it's small enough to keep things readable while learning.
