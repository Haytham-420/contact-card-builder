// =============================================================================
//  arabic-shaper.js — minimal Arabic text shaper (vendored, no dependencies).
//  ---------------------------------------------------------------------------
//  jsPDF draws text left-to-right and does no Arabic shaping, so before we hand
//  Arabic text to jsPDF we:
//    1. RESHAPE — replace each letter with its correct contextual presentation
//       form (isolated / initial / medial / final), incl. lām-alef ligatures.
//    2. REORDER — lay the result out for right-to-left display (a light bidi
//       that keeps Latin/number runs in their own order).
//  The vendored Amiri subset maps these presentation-form codepoints directly.
//  Exposes window.ArabicShaper = { hasArabic, reshape, toVisual }.
// =============================================================================
(function () {
  "use strict";

  // Per letter: join type + presentation forms.
  //   join: "D" dual-joining, "R" right-joining only, "U" non-joining, "C" causing
  //   [join, isolated, initial, medial, final]   (null where a form doesn't exist)
  var LETTERS = {
    0x0621: ["U", 0xFE80, null, null, null],            // hamza
    0x0622: ["R", 0xFE81, null, null, 0xFE82],          // alef madda
    0x0623: ["R", 0xFE83, null, null, 0xFE84],          // alef hamza above
    0x0624: ["R", 0xFE85, null, null, 0xFE86],          // waw hamza
    0x0625: ["R", 0xFE87, null, null, 0xFE88],          // alef hamza below
    0x0626: ["D", 0xFE89, 0xFE8B, 0xFE8C, 0xFE8A],      // yeh hamza
    0x0627: ["R", 0xFE8D, null, null, 0xFE8E],          // alef
    0x0628: ["D", 0xFE8F, 0xFE91, 0xFE92, 0xFE90],      // beh
    0x0629: ["R", 0xFE93, null, null, 0xFE94],          // teh marbuta
    0x062A: ["D", 0xFE95, 0xFE97, 0xFE98, 0xFE96],      // teh
    0x062B: ["D", 0xFE99, 0xFE9B, 0xFE9C, 0xFE9A],      // theh
    0x062C: ["D", 0xFE9D, 0xFE9F, 0xFEA0, 0xFE9E],      // jeem
    0x062D: ["D", 0xFEA1, 0xFEA3, 0xFEA4, 0xFEA2],      // hah
    0x062E: ["D", 0xFEA5, 0xFEA7, 0xFEA8, 0xFEA6],      // khah
    0x062F: ["R", 0xFEA9, null, null, 0xFEAA],          // dal
    0x0630: ["R", 0xFEAB, null, null, 0xFEAC],          // thal
    0x0631: ["R", 0xFEAD, null, null, 0xFEAE],          // reh
    0x0632: ["R", 0xFEAF, null, null, 0xFEB0],          // zain
    0x0633: ["D", 0xFEB1, 0xFEB3, 0xFEB4, 0xFEB2],      // seen
    0x0634: ["D", 0xFEB5, 0xFEB7, 0xFEB8, 0xFEB6],      // sheen
    0x0635: ["D", 0xFEB9, 0xFEBB, 0xFEBC, 0xFEBA],      // sad
    0x0636: ["D", 0xFEBD, 0xFEBF, 0xFEC0, 0xFEBE],      // dad
    0x0637: ["D", 0xFEC1, 0xFEC3, 0xFEC4, 0xFEC2],      // tah
    0x0638: ["D", 0xFEC5, 0xFEC7, 0xFEC8, 0xFEC6],      // zah
    0x0639: ["D", 0xFEC9, 0xFECB, 0xFECC, 0xFECA],      // ain
    0x063A: ["D", 0xFECD, 0xFECF, 0xFED0, 0xFECE],      // ghain
    0x0640: ["C", 0x0640, 0x0640, 0x0640, 0x0640],      // tatweel
    0x0641: ["D", 0xFED1, 0xFED3, 0xFED4, 0xFED2],      // feh
    0x0642: ["D", 0xFED5, 0xFED7, 0xFED8, 0xFED6],      // qaf
    0x0643: ["D", 0xFED9, 0xFEDB, 0xFEDC, 0xFEDA],      // kaf
    0x0644: ["D", 0xFEDD, 0xFEDF, 0xFEE0, 0xFEDE],      // lam
    0x0645: ["D", 0xFEE1, 0xFEE3, 0xFEE4, 0xFEE2],      // meem
    0x0646: ["D", 0xFEE5, 0xFEE7, 0xFEE8, 0xFEE6],      // noon
    0x0647: ["D", 0xFEE9, 0xFEEB, 0xFEEC, 0xFEEA],      // heh
    0x0648: ["R", 0xFEED, null, null, 0xFEEE],          // waw
    0x0649: ["R", 0xFEEF, null, null, 0xFEF0],          // alef maksura
    0x064A: ["D", 0xFEF1, 0xFEF3, 0xFEF4, 0xFEF2],      // yeh
  };

  // lām + alef variant → mandatory ligature [isolated, final].
  var LAM_ALEF = {
    0x0627: [0xFEFB, 0xFEFC],
    0x0622: [0xFEF5, 0xFEF6],
    0x0623: [0xFEF7, 0xFEF8],
    0x0625: [0xFEF9, 0xFEFA],
  };

  // Diacritics / combining marks: transparent to joining, rendered as-is.
  function isTransparent(cp) {
    return (cp >= 0x064B && cp <= 0x065F) || cp === 0x0670 ||
           (cp >= 0x0610 && cp <= 0x061A) ||
           (cp >= 0x06D6 && cp <= 0x06DC) || (cp >= 0x06DF && cp <= 0x06E4) ||
           (cp >= 0x06E7 && cp <= 0x06E8) || (cp >= 0x06EA && cp <= 0x06ED);
  }

  function isArabicCp(cp) {
    return (cp >= 0x0600 && cp <= 0x06FF) ||
           (cp >= 0x0750 && cp <= 0x077F) ||
           (cp >= 0xFB50 && cp <= 0xFDFF) ||
           (cp >= 0xFE70 && cp <= 0xFEFF);
  }

  function hasArabic(str) {
    for (var i = 0; i < str.length; i++) {
      if (isArabicCp(str.charCodeAt(i))) return true;
    }
    return false;
  }

  // Step 1: contextual reshaping (logical order preserved).
  function reshape(str) {
    var chars = Array.from(str);

    // Merge lām + alef into single ligature units first.
    var units = [];
    for (var i = 0; i < chars.length; i++) {
      var cp = chars[i].codePointAt(0);
      if (cp === 0x0644 && i + 1 < chars.length) {
        var lig = LAM_ALEF[chars[i + 1].codePointAt(0)];
        if (lig) {
          units.push({ join: "R", iso: lig[0], init: null, med: null, fin: lig[1], raw: null });
          i++;
          continue;
        }
      }
      var L = LETTERS[cp];
      if (L) {
        units.push({ join: L[0], iso: L[1], init: L[2], med: L[3], fin: L[4], raw: null });
      } else {
        units.push({ join: null, raw: chars[i], transparent: isTransparent(cp) });
      }
    }

    function prevLetter(idx) {
      for (var j = idx - 1; j >= 0; j--) {
        if (units[j].transparent) continue;
        return units[j].join ? units[j] : null;
      }
      return null;
    }
    function nextLetter(idx) {
      for (var j = idx + 1; j < units.length; j++) {
        if (units[j].transparent) continue;
        return units[j].join ? units[j] : null;
      }
      return null;
    }

    var out = "";
    for (var k = 0; k < units.length; k++) {
      var u = units[k];
      if (!u.join) { out += u.raw; continue; }

      var prev = prevLetter(k);
      var next = nextLetter(k);
      var prevJoinsLeft = prev && (prev.join === "D" || prev.join === "C");
      var thisReceives = u.join === "D" || u.join === "R" || u.join === "C";
      var prevConnects = prevJoinsLeft && thisReceives;
      var thisJoinsLeft = u.join === "D" || u.join === "C";
      var nextReceives = next && (next.join === "D" || next.join === "R" || next.join === "C");
      var nextConnects = thisJoinsLeft && nextReceives;

      var form;
      if (u.join === "R") {
        form = prevConnects ? u.fin : u.iso;
      } else if (u.join === "U") {
        form = u.iso;
      } else { // D or C
        if (prevConnects && nextConnects) form = u.med;
        else if (prevConnects) form = u.fin;
        else if (nextConnects) form = u.init;
        else form = u.iso;
      }
      out += form != null ? String.fromCodePoint(form) : "";
    }
    return out;
  }

  // Step 2: reorder reshaped text for RTL display. Light bidi — reverse the
  // order of runs, reverse characters inside Arabic runs, leave Latin/number
  // runs in their own left-to-right order.
  function toVisual(str) {
    var reshaped = reshape(str);
    var runs = [];
    var cur = "", curType = null;
    for (var i = 0; i < reshaped.length; i++) {
      var ch = reshaped[i];
      var t = isArabicCp(ch.charCodeAt(0)) ? "A" : "O";
      if (curType === null) { curType = t; cur = ch; }
      else if (t === curType) { cur += ch; }
      else { runs.push({ type: curType, text: cur }); curType = t; cur = ch; }
    }
    if (cur) runs.push({ type: curType, text: cur });

    var res = "";
    for (var r = runs.length - 1; r >= 0; r--) {
      var run = runs[r];
      res += run.type === "A" ? run.text.split("").reverse().join("") : run.text;
    }
    return res;
  }

  window.ArabicShaper = { hasArabic: hasArabic, reshape: reshape, toVisual: toVisual };
})();
