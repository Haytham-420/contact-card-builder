// =============================================================================
//  Contact Card Builder — app logic
//  ---------------------------------------------------------------------------
//  Browser-only. Plain JS, classic <script> (no modules, no build step).
//  Loaded AFTER the vendored libs in lib/ (qrcode-generator, jsPDF).
//
//  Roadmap (one small, testable piece per commit — see CLAUDE.md):
//    2. form UI            3. vCard data layer  ← (this step)
//    4. QR (.png)          5. PDF (vector QR)
//    6. file toggle/downloads                   7. polish
// =============================================================================

(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // 1. Read the form into a plain data object.
  //    This is the single source of truth the vCard / QR / PDF are built from.
  // ---------------------------------------------------------------------------
  function readForm() {
    var val = function (id) {
      var el = document.getElementById(id);
      return el ? el.value.trim() : "";
    };

    var displayName = val("name");

    // Split the full name into given + family for the vCard N field.
    // Convention (matches the original script): the LAST word is the family
    // name, everything before it is the given name(s).
    var parts = displayName.split(/\s+/).filter(Boolean);
    var familyName = parts.length > 1 ? parts[parts.length - 1] : "";
    var givenName = parts.length > 1 ? parts.slice(0, -1).join(" ") : displayName;

    // Phones: read every row, keep only those with an actual number.
    var phones = [];
    document.querySelectorAll("#phone-list .repeat-row").forEach(function (row) {
      var label = row.querySelector(".phone-label");
      var number = row.querySelector(".phone-number");
      label = label ? label.value.trim() : "";
      number = number ? number.value.trim() : "";
      if (number) phones.push({ label: label, number: number });
    });

    // Links: read every row, keep only the non-empty ones.
    var links = [];
    document.querySelectorAll("#link-list .link-url").forEach(function (input) {
      var url = input.value.trim();
      if (url) links.push(url);
    });

    var outputEl = document.querySelector('input[name="output"]:checked');

    return {
      displayName: displayName,
      givenName: givenName,
      familyName: familyName,
      title: val("title"),
      phones: phones,
      email: val("email"),
      links: links,
      accent: val("accent") || "#732da0",
      output: outputEl ? outputEl.value : "all",
      size: val("card-size") || "us",
    };
  }

  // ---------------------------------------------------------------------------
  // 2. Build the vCard string (vCard 3.0, the source of truth).
  //    Ported from the Python script: plain TEL lines for max import
  //    compatibility across phones and apps. Lines are joined with CRLF.
  // ---------------------------------------------------------------------------

  // Escape a value for a vCard text field per RFC 6350 / 2426:
  // backslash, comma, semicolon, and newlines must be escaped.
  function escapeVCard(value) {
    return String(value)
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/,/g, "\\,")
      .replace(/;/g, "\\;");
  }

  // Ensure a link has a scheme so it opens as a real URL when saved.
  function normalizeUrl(url) {
    return /^https?:\/\//i.test(url) ? url : "https://" + url;
  }

  function buildVCard(data) {
    var lines = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      // N: Family;Given;Additional;Prefix;Suffix
      "N:" + escapeVCard(data.familyName) + ";" + escapeVCard(data.givenName) + ";;;",
      "FN:" + escapeVCard(data.displayName),
    ];

    if (data.title) lines.push("TITLE:" + escapeVCard(data.title));

    data.phones.forEach(function (phone) {
      lines.push("TEL;type=CELL:" + escapeVCard(phone.number));
    });

    if (data.email) lines.push("EMAIL;type=INTERNET:" + escapeVCard(data.email));

    data.links.forEach(function (link) {
      lines.push("URL:" + escapeVCard(normalizeUrl(link)));
    });

    lines.push("END:VCARD");
    lines.push(""); // trailing CRLF so the file ends with a newline
    return lines.join("\r\n");
  }

  // ---------------------------------------------------------------------------
  // 3. QR code. Build a QR model from the vCard text (the same text the .vcf
  //    holds, so scanning saves the contact), then draw it onto a canvas.
  //    Uses the vendored qrcode-generator library (global `qrcode`).
  // ---------------------------------------------------------------------------

  // typeNumber 0 = auto-pick the smallest size that fits. 'M' error correction
  // matches the original Python script (ERROR_CORRECT_M).
  function buildQrModel(text) {
    if (typeof qrcode === "undefined") {
      throw new Error("qrcode-generator library not loaded (lib/qrcode.js).");
    }
    var qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    return qr;
  }

  // Draw the QR onto a fresh <canvas>. `scale` is px per module; `margin` is the
  // quiet zone in modules (4 is the spec-recommended minimum for reliable scans).
  function drawQrToCanvas(qr, opts) {
    opts = opts || {};
    var scale = opts.scale || 10;
    var margin = opts.margin != null ? opts.margin : 4;
    var dark = opts.dark || "#1c2230";
    var light = opts.light || "#ffffff";

    var count = qr.getModuleCount();
    var size = (count + margin * 2) * scale;

    var canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;

    var ctx = canvas.getContext("2d");
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = dark;
    for (var r = 0; r < count; r++) {
      for (var c = 0; c < count; c++) {
        if (qr.isDark(r, c)) {
          ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
        }
      }
    }
    return canvas;
  }

  // Swap the sample QR placeholder in the preview for the real generated code.
  function renderPreviewQr(canvas) {
    var slot = document.querySelector("#card-preview .qr-placeholder");
    if (!slot) return;
    slot.innerHTML = "";
    slot.classList.add("qr-placeholder--filled");
    var img = new Image();
    img.src = canvas.toDataURL("image/png");
    img.alt = "QR code that saves the contact when scanned";
    slot.appendChild(img);
  }

  // ---------------------------------------------------------------------------
  // 4. PDF business card. A browser port of the original Python canvas layout,
  //    drawn with jsPDF (global `window.jspdf`). The QR is drawn as vector
  //    squares (not a pasted image) so it stays crisp at any print size.
  // ---------------------------------------------------------------------------

  // Card dimensions in points (72 pt = 1 inch; 1 mm = 2.83465 pt).
  var CARD_SIZES = {
    us: { w: 252, h: 144 },         // 3.5 x 2 in
    eu: { w: 240.945, h: 155.906 }, // 85 x 55 mm
  };

  function hexToRgb(hex) {
    hex = String(hex || "").replace("#", "");
    if (hex.length === 3) {
      hex = hex.split("").map(function (ch) { return ch + ch; }).join("");
    }
    var n = parseInt(hex, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function buildPdf(data, qr) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      throw new Error("jsPDF library not loaded (lib/jspdf.umd.min.js).");
    }
    var JsPDF = window.jspdf.jsPDF;
    var size = CARD_SIZES[data.size] || CARD_SIZES.us;
    var W = size.w, H = size.h;

    var doc = new JsPDF({
      unit: "pt",
      format: [W, H],
      orientation: W >= H ? "landscape" : "portrait",
    });

    var ink = hexToRgb("#1c2230");
    var grey = hexToRgb("#73787f");
    var acc = hexToRgb(data.accent);

    var M = 14, leftX = 18;

    // --- QR: vector squares, right side, vertically centered ---
    var qrSize = H * 0.62;
    var qx = W - M - qrSize;
    var qy = (H - qrSize) / 2 - 4;
    var count = qr.getModuleCount();
    var quiet = 2; // white quiet-zone modules inside the QR box, for scannability
    var cell = qrSize / (count + quiet * 2);
    doc.setFillColor(ink.r, ink.g, ink.b);
    for (var r = 0; r < count; r++) {
      for (var c = 0; c < count; c++) {
        if (qr.isDark(r, c)) {
          doc.rect(qx + (c + quiet) * cell, qy + (r + quiet) * cell, cell, cell, "F");
        }
      }
    }
    doc.setTextColor(grey.r, grey.g, grey.b);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.4);
    doc.text("Scan to save my contact", qx + qrSize / 2, qy + qrSize + 9, { align: "center" });

    // --- Left accent bar ---
    doc.setFillColor(acc.r, acc.g, acc.b);
    doc.rect(0, 0, 4, H, "F");

    // --- Name (auto-shrink to fit the text column) ---
    var textMaxX = qx - 10;
    var nameSize = 13;
    doc.setFont("helvetica", "bold");
    while (nameSize > 9 &&
           doc.getStringUnitWidth(data.displayName) * nameSize > (textMaxX - leftX)) {
      nameSize -= 0.5;
    }
    doc.setFontSize(nameSize);
    doc.setTextColor(ink.r, ink.g, ink.b);
    var y = M + nameSize;
    doc.text(data.displayName, leftX, y);

    // --- Title ---
    if (data.title) {
      y += 13;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.6);
      doc.setTextColor(acc.r, acc.g, acc.b);
      doc.text(data.title, leftX, y);
    }

    // --- Divider ---
    y += 7;
    doc.setDrawColor(acc.r, acc.g, acc.b);
    doc.setLineWidth(0.8);
    doc.line(leftX, y, leftX + Math.min(96, textMaxX - leftX), y);

    // --- Contact lines: phones (label + number), email, links ---
    y += 13;
    var step = 11.5;
    data.phones.forEach(function (phone) {
      if (phone.label) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(6.6);
        doc.setTextColor(acc.r, acc.g, acc.b);
        doc.text(phone.label, leftX, y);
        var lw = doc.getStringUnitWidth(phone.label + "  ") * 6.6;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.0);
        doc.setTextColor(ink.r, ink.g, ink.b);
        doc.text(phone.number, leftX + lw, y);
      } else {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.0);
        doc.setTextColor(ink.r, ink.g, ink.b);
        doc.text(phone.number, leftX, y);
      }
      y += step;
    });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.0);
    doc.setTextColor(ink.r, ink.g, ink.b);
    if (data.email) { doc.text(data.email, leftX, y); y += step; }
    data.links.forEach(function (link) { doc.text(link, leftX, y); y += step; });

    return doc;
  }

  // ---------------------------------------------------------------------------
  // 5. Helpers: a safe file name from the contact's name, and a generic
  //    "download this text/blob as a file" routine reused by every output.
  // ---------------------------------------------------------------------------
  function safeBaseName(displayName) {
    var base = displayName
      .trim()
      .replace(/\s+/g, "_")
      .replace(/[^A-Za-z0-9_.\-]/g, "");
    return base || "contact";
  }

  function downloadBlob(filename, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke on the next tick so the download has a chance to start.
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }

  function downloadText(filename, text, mimeType) {
    downloadBlob(filename, new Blob([text], { type: mimeType }));
  }

  // ---------------------------------------------------------------------------
  // 6. Wire up the form. "Generate card" always produces the PDF and refreshes
  //    the preview; the PDF-only/all-files toggle decides whether the QR .png
  //    and .vcf are downloaded too.
  // ---------------------------------------------------------------------------
  function handleSubmit(event) {
    event.preventDefault();

    var data = readForm();
    if (!data.displayName) {
      window.alert("Please enter a name before generating the card.");
      return;
    }

    var vcard = buildVCard(data);
    var base = safeBaseName(data.displayName);
    var qr = buildQrModel(vcard);

    // Always refresh the preview with the real QR.
    var canvas = drawQrToCanvas(qr);
    renderPreviewQr(canvas);

    // The PDF business card is always produced (QR drawn as vector squares).
    buildPdf(data, qr).save(base + "_card.pdf");

    // "All files" additionally downloads the QR .png and the .vcf.
    if (data.output === "all") {
      canvas.toBlob(function (blob) {
        downloadBlob(base + "_QR.png", blob);
      }, "image/png");
      downloadText(base + ".vcf", vcard, "text/vcard;charset=utf-8");
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    var form = document.getElementById("card-form");
    if (form) form.addEventListener("submit", handleSubmit);
    console.log("Contact Card Builder: vCard + QR + PDF ready.");
  });

  // Expose for testing and future steps.
  window.ContactCard = {
    readForm: readForm,
    buildVCard: buildVCard,
    buildQrModel: buildQrModel,
    drawQrToCanvas: drawQrToCanvas,
    buildPdf: buildPdf,
    safeBaseName: safeBaseName,
    downloadText: downloadText,
    downloadBlob: downloadBlob,
  };
})();
