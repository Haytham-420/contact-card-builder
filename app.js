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
  // 0. Internationalization (English + Arabic). UI strings keyed by data-i18n
  //    attributes in the markup; `t()` reads the current language for strings
  //    built in JS (validation, preview fallback).
  // ---------------------------------------------------------------------------
  var I18N = {
    en: {
      appTitle: "Contact Card Builder",
      tagline: "Make a print-ready business card, QR code, and contact file — all in your browser.",
      formHeading: "Your details",
      legendIdentity: "Identity",
      labelName: "Full name",
      labelTitle: "Title / role",
      legendPhones: "Phone numbers",
      phPhoneLabel: "Label (e.g. WhatsApp)",
      addPhone: "+ Add phone",
      legendContact: "Contact",
      labelEmail: "Email",
      legendLinks: "Links",
      addLink: "+ Add link",
      legendAppearance: "Appearance",
      labelAccent: "Accent color",
      legendOutput: "Output",
      optPdfOnly: "PDF only",
      optAllFiles: "All files (PDF + QR + vCard)",
      labelCardSize: "Card size",
      sizeUs: "US business card — 3.5 × 2 in",
      sizeEu: "EU / ISO — 85 × 55 mm",
      btnGenerate: "Generate card",
      previewHeading: "Preview",
      scanCaption: "Scan to save my contact",
      previewNote: "Live preview — updates as you fill in the form. Click “Generate card” for the print-ready PDF and the real QR.",
      previewName: "Your Name",
      errName: "Please enter a name.",
      errEmail: "That email doesn't look right.",
    },
    ar: {
      appTitle: "منشئ بطاقة التواصل",
      tagline: "أنشئ بطاقة عمل جاهزة للطباعة ورمز QR وملف جهة اتصال — من متصفحك مباشرة.",
      formHeading: "بياناتك",
      legendIdentity: "الهوية",
      labelName: "الاسم الكامل",
      labelTitle: "المسمى الوظيفي",
      legendPhones: "أرقام الهاتف",
      phPhoneLabel: "التسمية (مثل واتساب)",
      addPhone: "+ إضافة هاتف",
      legendContact: "وسائل التواصل",
      labelEmail: "البريد الإلكتروني",
      legendLinks: "الروابط",
      addLink: "+ إضافة رابط",
      legendAppearance: "المظهر",
      labelAccent: "اللون المميز",
      legendOutput: "المخرجات",
      optPdfOnly: "ملف PDF فقط",
      optAllFiles: "كل الملفات (PDF + QR + vCard)",
      labelCardSize: "حجم البطاقة",
      sizeUs: "بطاقة أمريكية — 3.5 × 2 إنش",
      sizeEu: "أوروبية / ISO — 85 × 55 مم",
      btnGenerate: "إنشاء البطاقة",
      previewHeading: "معاينة",
      scanCaption: "امسح لحفظ جهة الاتصال",
      previewNote: "معاينة حية — تتحدث أثناء تعبئة النموذج. اضغط «إنشاء البطاقة» للحصول على ملف PDF الجاهز للطباعة ورمز QR الحقيقي.",
      previewName: "اسمك",
      errName: "يرجى إدخال الاسم.",
      errEmail: "يبدو أن البريد الإلكتروني غير صحيح.",
    },
  };

  var currentLang = "en";

  function t(key) {
    return (I18N[currentLang] && I18N[currentLang][key]) || I18N.en[key] || key;
  }

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
  // 6. Dynamic rows: the "+ Add" buttons append a new phone/link row, and each
  //    row's "×" removes it (keeping at least one row, cleared, so there's
  //    always somewhere to type).
  // ---------------------------------------------------------------------------
  function wireRepeatList(listId, addBtnId) {
    var list = document.getElementById(listId);
    var addBtn = document.getElementById(addBtnId);
    if (!list || !addBtn) return;

    addBtn.addEventListener("click", function () {
      var rows = list.querySelectorAll(".repeat-row");
      var clone = rows[rows.length - 1].cloneNode(true);
      clone.querySelectorAll("input").forEach(function (input) { input.value = ""; });
      list.appendChild(clone);
      var firstInput = clone.querySelector("input");
      if (firstInput) firstInput.focus();
      syncPreview();
    });

    list.addEventListener("click", function (event) {
      var btn = event.target.closest(".row-remove");
      if (!btn) return;
      var row = btn.closest(".repeat-row");
      if (list.querySelectorAll(".repeat-row").length > 1) {
        row.remove();
      } else {
        row.querySelectorAll("input").forEach(function (input) { input.value = ""; });
      }
      syncPreview();
    });
  }

  // ---------------------------------------------------------------------------
  // 7. Live preview. Mirror the form into the preview card as the user types:
  //    name, title, contact lines, accent color, and the card's aspect ratio.
  // ---------------------------------------------------------------------------
  function syncPreview() {
    var card = document.getElementById("card-preview");
    if (!card) return;
    var data = readForm();

    card.style.setProperty("--accent", data.accent);
    card.style.aspectRatio = data.size === "eu" ? "85 / 55" : "3.5 / 2";

    var nameEl = card.querySelector(".card__name");
    var roleEl = card.querySelector(".card__role");
    var linesEl = card.querySelector(".card__lines");

    if (nameEl) nameEl.textContent = data.displayName || t("previewName");
    if (roleEl) {
      roleEl.textContent = data.title;
      roleEl.style.display = data.title ? "" : "none";
    }
    if (!linesEl) return;

    linesEl.innerHTML = "";
    var addLine = function (build) {
      var li = document.createElement("li");
      build(li);
      linesEl.appendChild(li);
    };
    data.phones.forEach(function (phone) {
      addLine(function (li) {
        if (phone.label) {
          var span = document.createElement("span");
          span.className = "card__label";
          span.textContent = phone.label;
          li.appendChild(span);
          li.appendChild(document.createTextNode(" " + phone.number));
        } else {
          li.textContent = phone.number;
        }
      });
    });
    if (data.email) addLine(function (li) { li.textContent = data.email; });
    data.links.forEach(function (link) {
      addLine(function (li) { li.textContent = link; });
    });
  }

  // ---------------------------------------------------------------------------
  // 8. Validation. Show a friendly inline message under a field instead of a
  //    blunt alert: a name is required, and the email (if given) must look valid.
  // ---------------------------------------------------------------------------
  function setFieldError(inputId, message) {
    var input = document.getElementById(inputId);
    if (!input) return;
    var field = input.closest(".field") || input.parentNode;
    var err = field.querySelector(".field-error");
    if (message) {
      if (!err) {
        err = document.createElement("span");
        err.className = "field-error";
        field.appendChild(err);
      }
      err.textContent = message;
      input.setAttribute("aria-invalid", "true");
      input.classList.add("is-invalid");
    } else if (err) {
      err.remove();
      input.removeAttribute("aria-invalid");
      input.classList.remove("is-invalid");
    }
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  // Returns the id of the first invalid field, or null if everything is valid.
  function firstInvalidField(data) {
    if (!data.displayName) {
      setFieldError("name", t("errName"));
      return "name";
    }
    setFieldError("name", "");

    if (data.email && !isValidEmail(data.email)) {
      setFieldError("email", t("errEmail"));
      return "email";
    }
    setFieldError("email", "");

    return null;
  }

  // ---------------------------------------------------------------------------
  // 9. Wire up the form. "Generate card" always produces the PDF and refreshes
  //    the preview; the PDF-only/all-files toggle decides whether the QR .png
  //    and .vcf are downloaded too.
  // ---------------------------------------------------------------------------
  function handleSubmit(event) {
    event.preventDefault();

    var data = readForm();
    var invalid = firstInvalidField(data);
    if (invalid) {
      var el = document.getElementById(invalid);
      if (el) el.focus();
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

  // ---------------------------------------------------------------------------
  // 10. Language: swap every UI string, flip the document direction, and
  //     remember the choice. The card layout mirrors automatically under
  //     dir="rtl" (flex + logical properties).
  // ---------------------------------------------------------------------------
  function applyLanguage(lang) {
    currentLang = lang === "ar" ? "ar" : "en";
    var dict = I18N[currentLang];
    var html = document.documentElement;
    html.lang = currentLang;
    html.dir = currentLang === "ar" ? "rtl" : "ltr";
    try { localStorage.setItem("ccb-lang", currentLang); } catch (e) {}

    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      if (dict[key] != null) el.textContent = dict[key];
    });
    document.querySelectorAll("[data-i18n-ph]").forEach(function (el) {
      var key = el.getAttribute("data-i18n-ph");
      if (dict[key] != null) el.setAttribute("placeholder", dict[key]);
    });

    var toggle = document.getElementById("lang-toggle");
    if (toggle) toggle.textContent = currentLang === "en" ? "العربية" : "English";
  }

  document.addEventListener("DOMContentLoaded", function () {
    var form = document.getElementById("card-form");
    if (form) {
      form.addEventListener("submit", handleSubmit);
      form.addEventListener("input", syncPreview);
      form.addEventListener("change", syncPreview);
      // Clear a field's error as soon as the user edits it.
      form.addEventListener("input", function (event) {
        if (event.target.id === "name" || event.target.id === "email") {
          setFieldError(event.target.id, "");
        }
      });
    }
    wireRepeatList("phone-list", "add-phone");
    wireRepeatList("link-list", "add-link");

    var saved = null;
    try { saved = localStorage.getItem("ccb-lang"); } catch (e) {}
    applyLanguage(saved || "en");
    var toggle = document.getElementById("lang-toggle");
    if (toggle) {
      toggle.addEventListener("click", function () {
        applyLanguage(currentLang === "en" ? "ar" : "en");
      });
    }

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
    applyLanguage: applyLanguage,
  };
})();
