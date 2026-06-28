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
  // 3. Helpers: a safe file name from the contact's name, and a generic
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
  // 4. Wire up the form. For now, "Generate card" downloads the .vcf so we can
  //    verify the data layer. QR (.png) and the PDF plug into this next.
  // ---------------------------------------------------------------------------
  function handleSubmit(event) {
    event.preventDefault();

    var data = readForm();
    if (!data.displayName) {
      window.alert("Please enter a name before generating the card.");
      return;
    }

    var vcard = buildVCard(data);
    downloadText(safeBaseName(data.displayName) + ".vcf", vcard, "text/vcard;charset=utf-8");
  }

  document.addEventListener("DOMContentLoaded", function () {
    var form = document.getElementById("card-form");
    if (form) form.addEventListener("submit", handleSubmit);
    console.log("Contact Card Builder: vCard data layer ready.");
  });

  // Expose for later steps (QR/PDF) and quick console testing.
  window.ContactCard = {
    readForm: readForm,
    buildVCard: buildVCard,
    safeBaseName: safeBaseName,
    downloadText: downloadText,
    downloadBlob: downloadBlob,
  };
})();
