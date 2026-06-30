# Contact Card Builder

Generate a **print-ready PDF business card**, a **QR code**, and a **`.vcf` contact
file** — entirely in your browser. No backend, no signup, no install. Fill in a short
form, pick a card size, and download.

**▶ Try it live: https://haytham-m-khalil.github.io/contact-card-builder/**

![Contact Card Builder — form on the left, live card preview with QR on the right](docs/screenshot.png)

## Features

- **Live preview** that updates as you type, including the accent color and card size.
- **PDF business card** in standard sizes — US 3.5×2 in and EU/ISO 85×55 mm.
- **QR code** that encodes a vCard, so anyone can scan to save your contact. In the PDF
  it's drawn as **vector squares**, so it stays crisp at any print size.
- **`.vcf` contact file** to import the contact directly into any phone or app.
- One or more **labelled phone numbers** plus email and links — add/remove rows freely.
- A toggle for **"PDF only"** vs **"all files"** (PDF + QR `.png` + `.vcf`).
- Editable **accent color** and light inline **validation**.

The `.vcf` is the source of truth; the QR encodes the exact same vCard text, using plain
`TEL` lines for maximum import compatibility across phones and apps.

## How it works

- 100% client-side: plain HTML, CSS, and JavaScript — **no build step, no backend, no
  framework.**
- Built on [jsPDF](https://github.com/parallax/jsPDF) and
  [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator), both
  **vendored locally** in [`lib/`](lib/) so the app is self-contained and works offline.

## Run it locally

Clone or download the repo, then **open `index.html` in your browser** — that's it
(double-clicking the file works).

For a closer-to-production check, serve the folder over http:

```sh
python -m http.server
```

…then open the URL it prints.

## Deploy your own (GitHub Pages — free)

Because it's just static files, you can host your own copy for free:

1. **Fork** this repo (or push your own copy) to GitHub.
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a branch**.
4. Select branch **`main`**, folder **`/ (root)`**, and click **Save**.
5. Wait ~1 minute; GitHub shows your live URL
   (`https://<your-username>.github.io/contact-card-builder/`).

Every push to `main` redeploys automatically.

## Project layout

```
index.html   # markup; loads style.css, then the vendored libs, then app.js
style.css    # all styles
app.js       # all app logic (vCard, QR, PDF, preview, validation)
lib/         # vendored libraries (qrcode-generator, jsPDF) + notes
docs/        # README assets (screenshot)
```

## License

[MIT](LICENSE) © 2026 Haytham M. R. Khalil
