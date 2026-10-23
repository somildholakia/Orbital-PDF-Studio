(function () {
  "use strict";

  var $ = function (selector, root) { return (root || document).querySelector(selector); };
  var $$ = function (selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); };
  var PDFLib = window.PDFLib;
  var PDFJS = window.pdfjsLib;
  var JSZip = window.JSZip;
  var files = [];
  var images = [];
  var activeTool = "merge";
  var lastUrl = "";
  var lastBlob = null;
  var lastName = "";
  var toastTimer = 0;
  var previewRequest = 0;

  var tools = {
    merge: { title: "Merge PDFs", desc: "Combine PDFs in your chosen sequence, with optional page sizing and a blank separator.", icon: "↔", tag: "COMBINE FILES", button: "Merge PDFs", intro: "Arrange the file queue, choose how page sizes should behave, and export one document." },
    split: { title: "Split PDF", desc: "Extract selected pages, or split a document into smaller files.", icon: "✂", tag: "PICK YOUR PAGES", button: "Export selected pages", intro: "Select page ranges and decide whether to create one PDF, one file per page, or batches." },
    organize: { title: "Organize pages", desc: "Set your own page order, remove pages, and rotate every exported page.", icon: "▤", tag: "MAKE IT FLOW", button: "Export organized PDF", intro: "Use page numbers like 3,1,2,4-6 to reorder pages. Removed pages are excluded from the export." },
    annotate: { title: "Annotate PDF", desc: "Add a visible text note with custom color, size, opacity and placement.", icon: "✎", tag: "MARK IT UP", button: "Export annotated PDF", intro: "Add a flattened note overlay to selected pages. Existing PDF text is not rewritten." },
    watermark: { title: "Watermark PDF", desc: "Style text watermarks and page numbers independently.", icon: "◈", tag: "FINISH THE DETAILS", button: "Export watermarked PDF", intro: "Tune opacity, angle, size, placement, and numbering before exporting." },
    images: { title: "Images to PDF", desc: "Arrange images into a PDF with paper size, orientation, margins and quality settings.", icon: "▧", tag: "CHANGE FORMATS", button: "Create image PDF", intro: "Choose a paper size and image fit. Image order below becomes the PDF page order." },
    "pdf-images": { title: "PDF to PNG", desc: "Convert chosen PDF pages to high-quality PNG images in a ZIP file.", icon: "▦", tag: "EXPORT IMAGES", button: "Create PNG ZIP", intro: "Choose the page range and rendering scale. Each page is saved as a separate PNG." },
    extract: { title: "Extract text", desc: "Download the selectable text layer from chosen PDF pages.", icon: "¶", tag: "GET THE WORDS", button: "Extract text to TXT", intro: "This reads existing text layers. Scanned pages require OCR, which is not included." },
    optimize: { title: "Optimize PDF", desc: "Rewrite the PDF structure, with optional metadata clearing and size comparison.", icon: "⌁", tag: "LEANER FILES", button: "Optimize PDF", intro: "This can reduce structural overhead but does not recompress embedded images." }
  };

  function escapeHtml(value) {
    var map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) { return map[ch]; });
  }

  function bytes(size) {
    if (size < 1024) return size + " B";
    if (size < 1048576) return (size / 1024).toFixed(1) + " KB";
    return (size / 1048576).toFixed(2) + " MB";
  }

  function note(message, kind) {
    var status = $("#status");
    if (status) {
      status.textContent = message;
      status.dataset.kind = kind || "";
    }
    var toast = $("#toast");
    if (toast) {
      toast.textContent = message;
      toast.classList.add("show");
      window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(function () { toast.classList.remove("show"); }, 3200);
    }
  }

  function getOpt(key) {
    var element = $('[data-opt="' + key + '"]');
    if (!element) return "";
    if (element.type === "checkbox") return element.checked;
    return element.value;
  }

  function section(title) {
    return '<div class="settings-label">' + escapeHtml(title) + '</div>';
  }

  function field(label, key, kind, value, options, help, full) {
    var id = "opt-" + key;
    var wrapper = "field" + (full ? " full" : "");
    var hint = help ? '<small>' + escapeHtml(help) + '</small>' : "";
    if (kind === "checkbox") {
      return '<label class="check-field ' + wrapper + '" for="' + id + '">' +
        '<input id="' + id + '" data-opt="' + key + '" type="checkbox"' + (value ? " checked" : "") + '>' +
        '<span><strong>' + escapeHtml(label) + '</strong>' + hint + '</span></label>';
    }
    var input = "";
    if (kind === "select") {
      input = '<select class="control" id="' + id + '" data-opt="' + key + '">' +
        (options || []).map(function (option) {
          return '<option value="' + escapeHtml(option[0]) + '"' + (String(option[0]) === String(value) ? " selected" : "") + '>' + escapeHtml(option[1]) + '</option>';
        }).join("") + '</select>';
    } else if (kind === "range") {
      var rangeOptions = options || [0, 100, 1, ""];
      var suffix = rangeOptions[3] || "";
      input = '<div class="range-line"><input class="control" id="' + id + '" data-opt="' + key + '" type="range" min="' + rangeOptions[0] + '" max="' + rangeOptions[1] + '" step="' + rangeOptions[2] + '" value="' + escapeHtml(value) + '">' +
        '<span class="range-value" id="' + id + '-value">' + escapeHtml(value) + suffix + '</span></div>';
    } else {
      var attrs = "";
      if (options && typeof options === "object") {
        if (options.min != null) attrs += ' min="' + escapeHtml(options.min) + '"';
        if (options.max != null) attrs += ' max="' + escapeHtml(options.max) + '"';
        if (options.maxlength != null) attrs += ' maxlength="' + escapeHtml(options.maxlength) + '"';
        if (options.step != null) attrs += ' step="' + escapeHtml(options.step) + '"';
      }
      input = '<input class="control" id="' + id + '" data-opt="' + key + '" type="' + (kind === "color" ? "color" : kind === "number" ? "number" : "text") + '"' + attrs + ' value="' + escapeHtml(value) + '">';
    }
    return '<div class="' + wrapper + '"><label for="' + id + '">' + escapeHtml(label) + '</label>' + input + hint + '</div>';
  }

  function renderOptions() {
    var output = "";
    var t = tools[activeTool];
    output += section("Output");
    output += field("Output filename", "outputName", "text",
      activeTool === "merge" ? "orbital-merged.pdf" :
      activeTool === "images" ? "images-to-pdf.pdf" :
      activeTool === "pdf-images" ? "pdf-pages.zip" :
      activeTool === "extract" ? "extracted-text.txt" : "orbital-" + activeTool + ".pdf",
      { maxlength: 100 }, "The file extension is added automatically when needed.", true);

    if (activeTool === "merge") {
      output += section("Page layout");
      output += field("Page size", "pageSize", "select", "preserve", [["preserve", "Keep each source page size"], ["a4", "Fit all pages to A4"], ["letter", "Fit all pages to US Letter"]], "Sizing affects the exported copy, not the source files.", true);
      output += field("Margin (pt)", "margin", "number", "24", { min: 0, max: 180, step: 1 }, "Used when normalizing page sizes.");
      output += field("Order files", "sortFiles", "select", "custom", [["custom", "Use queue order"], ["name", "Alphabetical by filename"]], "Arrow buttons beside each file set the queue order.");
      output += field("Insert a blank page between files", "blankBetween", "checkbox", false, null, "Adds an A4 blank page between each source document.", true);
    } else if (activeTool === "split") {
      output += section("Page selection");
      output += field("Pages to extract", "range", "text", "1-3", { maxlength: 500 }, "Examples: 1-4, 7, 9-11. Leave blank to export all pages.", true);
      output += field("Export mode", "splitMode", "select", "single", [["single", "One PDF containing selected pages"], ["each", "One PDF per page (ZIP)"], ["chunks", "Split into batches (ZIP)"]], "Batch mode groups selected pages into consecutive files.", true);
      output += field("Pages per batch", "chunkSize", "number", "5", { min: 1, max: 500, step: 1 }, "Only used for batch mode.");
    } else if (activeTool === "organize") {
      output += section("Page order");
      output += field("Custom order", "pageOrder", "text", "", { maxlength: 500 }, "Example: 3,1,2,4-6. Leave blank to keep the original order.", true);
      output += field("Remove pages", "removeRanges", "text", "", { maxlength: 500 }, "Ranges refer to positions after applying the custom order.", true);
      output += field("Rotate all pages", "rotateDegrees", "select", "0", [["0", "No change"], ["90", "90° clockwise"], ["180", "180°"], ["270", "270° clockwise"]], "Rotation applies only to the exported copy.", true);
    } else if (activeTool === "annotate") {
      output += section("Note style");
      output += field("Text note", "noteText", "text", "Reviewed", { maxlength: 300 }, "The note is flattened into the exported page.", true);
      output += field("Text color", "noteColor", "color", "#1688ff");
      output += field("Font size (pt)", "noteSize", "range", "18", [8, 48, 1, " pt"]);
      output += field("Opacity", "noteOpacity", "range", "92", [10, 100, 1, "%"]);
      output += field("Placement", "notePosition", "select", "bottom-right", [["center", "Center"], ["top-left", "Top left"], ["top-right", "Top right"], ["bottom-left", "Bottom left"], ["bottom-right", "Bottom right"]], "", true);
      output += field("Apply to pages", "range", "text", "", { maxlength: 500 }, "Examples: 1-3, 6. Leave blank to annotate every page.", true);
      output += field("Bold text", "noteBold", "checkbox", true, null, "");
    } else if (activeTool === "watermark") {
      output += section("Watermark");
      output += field("Watermark text", "waterText", "text", "CONFIDENTIAL", { maxlength: 200 }, "Leave blank if you only need page numbers.", true);
      output += field("Watermark color", "waterColor", "color", "#685cff");
      output += field("Opacity", "waterOpacity", "range", "22", [5, 80, 1, "%"]);
      output += field("Angle", "waterAngle", "range", "-35", [-90, 90, 1, "°"]);
      output += field("Font size (pt)", "waterSize", "range", "36", [10, 80, 1, " pt"]);
      output += field("Placement", "waterPosition", "select", "center", [["center", "Center"], ["top", "Top center"], ["bottom", "Bottom center"], ["bottom-right", "Bottom right"], ["top-left", "Top left"]], "", true);
      output += section("Page numbers");
      output += field("Add page numbers", "addNumbers", "checkbox", false, null, "");
      output += field("First displayed number", "numberStart", "number", "1", { min: 0, max: 100000, step: 1 });
      output += field("Number alignment", "numberAlign", "select", "right", [["left", "Left"], ["center", "Center"], ["right", "Right"]]);
      output += field("Number position", "numberPosition", "select", "bottom-right", [["bottom-left", "Bottom left"], ["bottom-center", "Bottom center"], ["bottom-right", "Bottom right"], ["top-right", "Top right"]]);
      output += field("Apply watermark to pages", "range", "text", "", { maxlength: 500 }, "Examples: 1-5, 8. Blank applies the watermark to all pages.", true);
    } else if (activeTool === "images") {
      output += section("Paper");
      output += field("Page size", "paperSize", "select", "a4", [["a4", "A4"], ["letter", "US Letter"], ["fit", "Fit each image"]]);
      output += field("Orientation", "orientation", "select", "auto", [["auto", "Auto per image"], ["portrait", "Portrait"], ["landscape", "Landscape"]]);
      output += field("Image layout", "imageFit", "select", "contain", [["contain", "Fit inside page"], ["fill", "Fill page (may stretch)"]]);
      output += field("Margins (pt)", "imageMargin", "number", "24", { min: 0, max: 180, step: 1 });
      output += field("Image quality", "imageQuality", "select", "original", [["original", "Original / best quality"], ["high", "High · JPEG 92"], ["balanced", "Balanced · JPEG 82"], ["small", "Smaller · JPEG 68"]], "Lower sizes convert images to JPEG and can remove transparency.", true);
    } else if (activeTool === "pdf-images") {
      output += section("Page range & output");
      output += field("Pages to convert", "range", "text", "", { maxlength: 500 }, "Example: 1-4, 6. Leave blank to export all pages.", true);
      output += field("Render scale", "renderScale", "select", "2", [["1", "Standard · 1×"], ["1.5", "Sharp · 1.5×"], ["2", "High · 2×"], ["3", "Very high · 3×"]], "High scale uses more memory on phones.", true);
      output += field("Image filename prefix", "imagePrefix", "text", "page", { maxlength: 32 });
    } else if (activeTool === "extract") {
      output += section("Text extraction");
      output += field("Pages to read", "range", "text", "", { maxlength: 500 }, "Example: 1-2, 5. Leave blank to read all pages.", true);
      output += field("Text separator", "textSeparator", "select", "paragraph", [["paragraph", "Blank line between pages"], ["line", "Single line between pages"], ["none", "No separator"]], "", true);
      output += field("Include page headings", "pageHeadings", "checkbox", true, null, "");
    } else if (activeTool === "optimize") {
      output += section("Rewrite settings");
      output += field("Use object streams", "objectStreams", "checkbox", true, null, "Can reduce structural overhead for some PDFs.");
      output += field("Clear document metadata", "stripMetadata", "checkbox", false, null, "Removes document title, author, subject, keywords, creator, and producer.", true);
      output += field("Optimization note", "optimizeNote", "text", "No image recompression", { maxlength: 80 }, "PDF structure is rewritten; embedded images are not recompressed.", true);
    }

    $("#workspaceHeading").textContent = t.title;
    $("#workspaceSub").textContent = t.desc;
    $("#settingsTitle").textContent = t.title;
    $("#settingsTag").textContent = t.tag;
    $("#settingsIntro").textContent = t.intro;
    $("#settingsIcon").textContent = t.icon;
    $("#activeToolIcon").textContent = t.icon;
    $("#runBtn").textContent = t.button + " ↓";
    $("#toolOptions").innerHTML = output;
    $("#uploadGlyph").textContent = activeTool === "images" ? "▧" : "⇧";
    $("#uploadTitle").textContent = activeTool === "images" ? "Drop images here" : "Drop PDF files here";
    $("#uploadHint").textContent = activeTool === "images" ? "JPG, PNG, or WebP · Image order becomes page order" : "PDF files only · Files stay on this device";
    $("#chooseFiles").textContent = activeTool === "images" ? "Choose images" : "Choose PDF files";
    $("#queueTitle").textContent = activeTool === "images" ? "Image queue" : "PDF queue";
    $("#pdfInput").hidden = activeTool === "images";
    $("#imageInput").hidden = activeTool !== "images";
    $("#previewBox").hidden = activeTool !== "annotate" && activeTool !== "watermark";
    if (activeTool === "annotate" || activeTool === "watermark") renderPreview();
  }

  function parseRanges(spec, total, preserveOrder) {
    if (!spec || !String(spec).trim()) return Array.from({ length: total }, function (_, i) { return i; });
    var result = [];
    String(spec).split(",").forEach(function (chunk) {
      var part = chunk.trim();
      var match = part.match(/^(\d+)\s*-\s*(\d+)$/);
      if (match) {
        var start = Number(match[1]);
        var end = Number(match[2]);
        if (start < 1 || end < start || end > total) throw new Error("Check page range " + part + ". This document has " + total + " pages.");
        for (var n = start; n <= end; n++) result.push(n - 1);
      } else if (/^\d+$/.test(part)) {
        var page = Number(part);
        if (page < 1 || page > total) throw new Error("Page " + page + " is outside this document.");
        result.push(page - 1);
      } else {
        throw new Error("Use page ranges such as 1-3, 5, 8-10.");
      }
    });
    if (!preserveOrder) result = result.filter(function (value, index) { return result.indexOf(value) === index; }).sort(function (a, b) { return a - b; });
    return result;
  }

  function color(hex) {
    if (!PDFLib) throw new Error("PDF library is still loading. Refresh and try again.");
    var value = String(hex || "#000000").replace("#", "");
    if (value.length === 3) value = value.split("").map(function (ch) { return ch + ch; }).join("");
    return PDFLib.rgb(parseInt(value.slice(0, 2), 16) / 255, parseInt(value.slice(2, 4), 16) / 255, parseInt(value.slice(4, 6), 16) / 255);
  }

  function safeName(value, fallback) {
    var result = String(value || fallback || "export").trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-").slice(0, 100);
    return result || fallback || "export";
  }

  function outputName(fallback, extension) {
    var name = safeName(getOpt("outputName"), fallback);
    name = name.replace(/\.(pdf|zip|txt)$/i, "");
    return name + "." + extension;
  }

  function download(blob, name) {
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastBlob = blob;
    lastName = name;
    lastUrl = URL.createObjectURL(blob);
    var anchor = document.createElement("a");
    anchor.href = lastUrl;
    anchor.download = name;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    var again = $("#downloadAgain");
    again.hidden = false;
    again.onclick = function () {
      if (!lastUrl || !lastBlob) return;
      var a = document.createElement("a");
      a.href = lastUrl;
      a.download = lastName;
      document.body.appendChild(a);
      a.click();
      a.remove();
    };
  }

  function savePdf(data, name) {
    download(new Blob([data], { type: "application/pdf" }), name);
  }

  async function loadPdf(file) {
    if (!PDFLib) throw new Error("PDF processing library is still loading. Refresh and try again.");
    return PDFLib.PDFDocument.load(new Uint8Array(await file.arrayBuffer()));
  }

  function selectedPdf() {
    if (!files.length) throw new Error("Add at least one PDF first.");
    return files[0].file;
  }

  function normalizePage(page, sizeName, margin) {
    if (sizeName === "preserve") return;
    var target = sizeName === "letter" ? { w: 612, h: 792 } : { w: 595.28, h: 841.89 };
    var width = page.getWidth();
    var height = page.getHeight();
    var safeMargin = Math.min(Math.max(0, Number(margin) || 0), Math.min(target.w, target.h) * 0.4);
    var scale = Math.min((target.w - 2 * safeMargin) / width, (target.h - 2 * safeMargin) / height);
    page.scaleContent(scale, scale);
    page.scaleAnnotations(scale, scale);
    page.translateContent((target.w - width * scale) / 2, (target.h - height * scale) / 2);
    page.setSize(target.w, target.h);
  }

  async function copyPages(doc, indices) {
    var result = await PDFLib.PDFDocument.create();
    var copied = await result.copyPages(doc, indices);
    copied.forEach(function (page) { result.addPage(page); });
    return result;
  }

  function ensureLibraries(toolId) {
    if (!PDFLib) throw new Error("PDF library is still loading. Refresh and try again.");
    if ((toolId === "pdf-images" || toolId === "extract") && !PDFJS) throw new Error("PDF reading library is still loading. Refresh and try again.");
    if ((toolId === "pdf-images" || toolId === "split") && !JSZip && (toolId === "pdf-images" || getOpt("splitMode") !== "single")) throw new Error("ZIP library is still loading. Refresh and try again.");
  }

  async function act() {
    var run = $("#runBtn");
    run.disabled = true;
    run.textContent = "Working…";
    note("Processing locally in your browser…", "busy");
    try {
      ensureLibraries(activeTool);
      if (activeTool === "images") {
        if (!images.length) throw new Error("Choose one or more JPG, PNG, or WebP images first.");
        await imagesToPdf();
        return;
      }
      var file = selectedPdf();
      if (activeTool === "merge") {
        await mergePdfs();
        return;
      }
      var doc = await loadPdf(file);
      var total = doc.getPageCount();
      var name = safeName(getOpt("outputName"), "orbital-export");

      if (activeTool === "split") {
        var selected = parseRanges(getOpt("range"), total, true);
        var mode = getOpt("splitMode");
        if (mode === "single") {
          var one = await copyPages(doc, selected);
          savePdf(await one.save({ useObjectStreams: true }), outputName(name, "pdf"));
          note("Exported " + selected.length + " selected page(s) to one PDF.", "success");
        } else {
          var zip = new JSZip();
          var chunkSize = Math.max(1, Number(getOpt("chunkSize")) || 5);
          var groups = mode === "each" ? selected.map(function (index) { return [index]; }) : [];
          if (mode === "chunks") {
            for (var offset = 0; offset < selected.length; offset += chunkSize) groups.push(selected.slice(offset, offset + chunkSize));
          }
          for (var i = 0; i < groups.length; i++) {
            var subset = await copyPages(doc, groups[i]);
            var blob = new Blob([await subset.save({ useObjectStreams: true })], { type: "application/pdf" });
            var label = mode === "each" ? "page-" + String(groups[i][0] + 1).padStart(3, "0") : "part-" + String(i + 1).padStart(3, "0");
            zip.file(label + ".pdf", blob);
          }
          download(await zip.generateAsync({ type: "blob" }), outputName(name, "zip"));
          note("Created " + groups.length + " split PDF(s) in a ZIP file.", "success");
        }
      } else if (activeTool === "organize") {
        var order = getOpt("pageOrder").trim() ? parseRanges(getOpt("pageOrder"), total, true) : Array.from({ length: total }, function (_, i) { return i; });
        var removeSpec = getOpt("removeRanges").trim();
        if (removeSpec) {
          var toRemove = new Set(parseRanges(removeSpec, order.length, false));
          order = order.filter(function (_, i) { return !toRemove.has(i); });
        }
        if (!order.length) throw new Error("Your page selection is empty. Keep at least one page.");
        var organized = await copyPages(doc, order);
        var degrees = Number(getOpt("rotateDegrees") || 0);
        if (degrees) organized.getPages().forEach(function (page) {
          page.setRotation(PDFLib.degrees((((page.getRotation().angle || 0) + degrees) % 360 + 360) % 360));
        });
        savePdf(await organized.save({ useObjectStreams: true }), outputName(name, "pdf"));
        note("Exported " + order.length + " organized page(s).", "success");
      } else if (activeTool === "annotate") {
        var noteText = String(getOpt("noteText") || "").trim();
        if (!noteText) throw new Error("Enter the note text before exporting.");
        var targets = new Set(parseRanges(getOpt("range"), total, false));
        var font = await doc.embedFont(getOpt("noteBold") ? PDFLib.StandardFonts.HelveticaBold : PDFLib.StandardFonts.Helvetica);
        var fontSize = Number(getOpt("noteSize")) || 18;
        var alpha = Number(getOpt("noteOpacity")) / 100;
        var noteColor = color(getOpt("noteColor"));
        var position = getOpt("notePosition");
        doc.getPages().forEach(function (page, index) {
          if (!targets.has(index)) return;
          var width = page.getWidth(), height = page.getHeight(), margin = 24;
          var textWidth = font.widthOfTextAtSize(noteText, fontSize);
          var x = position.indexOf("left") >= 0 ? margin : position.indexOf("right") >= 0 ? width - textWidth - margin : (width - textWidth) / 2;
          var y = position.indexOf("top") === 0 ? height - margin - fontSize : position.indexOf("bottom") === 0 ? margin : (height - fontSize) / 2;
          page.drawText(noteText, { x: Math.max(8, x), y: Math.max(8, y), size: fontSize, font: font, color: noteColor, opacity: alpha });
        });
        savePdf(await doc.save({ useObjectStreams: true }), outputName(name, "pdf"));
        note("Added the note to " + targets.size + " page(s).", "success");
      } else if (activeTool === "watermark") {
        var watermark = String(getOpt("waterText") || "").trim();
        var addNumbers = !!getOpt("addNumbers");
        if (!watermark && !addNumbers) throw new Error("Enter watermark text or enable page numbers.");
        var targetPages = new Set(parseRanges(getOpt("range"), total, false));
        var fontWater = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
        var opacity = Number(getOpt("waterOpacity")) / 100;
        var angle = Number(getOpt("waterAngle")) || 0;
        var size = Number(getOpt("waterSize")) || 36;
        var waterColor = color(getOpt("waterColor"));
        var where = getOpt("waterPosition");
        var startNumber = Number(getOpt("numberStart"));
        doc.getPages().forEach(function (page, index) {
          var width = page.getWidth(), height = page.getHeight(), margin = 26;
          if (watermark && targetPages.has(index)) {
            var measured = fontWater.widthOfTextAtSize(watermark, size);
            var x = where === "top-left" ? margin : where === "bottom-right" ? width - measured - margin : (width - measured) / 2;
            var y = where === "top" ? height - margin - size : where === "bottom" ? margin : (height - size) / 2;
            page.drawText(watermark, { x: Math.max(8, x), y: Math.max(8, y), size: size, font: fontWater, color: waterColor, opacity: opacity, rotate: PDFLib.degrees(angle) });
          }
          if (addNumbers) {
            var label = String(startNumber + index);
            var numberSize = 10;
            var numberWidth = fontWater.widthOfTextAtSize(label, numberSize);
            var numberPosition = getOpt("numberPosition");
            var nx = numberPosition.indexOf("left") >= 0 ? margin : numberPosition.indexOf("center") >= 0 ? (width - numberWidth) / 2 : width - numberWidth - margin;
            var ny = numberPosition.indexOf("top") === 0 ? height - margin - numberSize : margin;
            page.drawText(label, { x: nx, y: ny, size: numberSize, font: fontWater, color: color("#78829a") });
          }
        });
        savePdf(await doc.save({ useObjectStreams: true }), outputName(name, "pdf"));
        note("Watermark export complete. Page numbers " + (addNumbers ? "included." : "not requested."), "success");
      } else if (activeTool === "extract") {
        var range = parseRanges(getOpt("range"), total, true);
        var pdf = await PDFJS.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
        var chunks = [];
        for (var pageIndex of range) {
          var page = await pdf.getPage(pageIndex + 1);
          var content = await page.getTextContent();
          var line = content.items.map(function (item) { return item.str || ""; }).join(" ");
          chunks.push((getOpt("pageHeadings") ? "--- Page " + (pageIndex + 1) + " ---\n" : "") + line);
        }
        var separator = getOpt("textSeparator") === "none" ? "" : getOpt("textSeparator") === "line" ? "\n" : "\n\n";
        download(new Blob([chunks.join(separator)], { type: "text/plain;charset=utf-8" }), outputName(name, "txt"));
        note("Extracted selectable text from " + range.length + " page(s). Scanned pages need OCR.", "success");
      } else if (activeTool === "pdf-images") {
        var pageRange = parseRanges(getOpt("range"), total, true);
        var readingPdf = await PDFJS.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
        var scale = Number(getOpt("renderScale")) || 2;
        var prefix = safeName(getOpt("imagePrefix"), "page");
        var pngZip = new JSZip();
        for (var renderIndex of pageRange) {
          note("Rendering page " + (renderIndex + 1) + " of " + total + "…", "busy");
          var pageToRender = await readingPdf.getPage(renderIndex + 1);
          var viewport = pageToRender.getViewport({ scale: scale });
          var canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          var context = canvas.getContext("2d", { alpha: false });
          await pageToRender.render({ canvasContext: context, viewport: viewport }).promise;
          var png = await new Promise(function (resolve) { canvas.toBlob(resolve, "image/png"); });
          if (!png) throw new Error("Could not render PDF page " + (renderIndex + 1) + ".");
          pngZip.file(prefix + "-" + String(renderIndex + 1).padStart(3, "0") + ".png", png);
          canvas.width = 0;
          canvas.height = 0;
        }
        download(await pngZip.generateAsync({ type: "blob" }), outputName(name, "zip"));
        note("Created " + pageRange.length + " PNG image(s) in a ZIP file.", "success");
      } else if (activeTool === "optimize") {
        if (getOpt("stripMetadata")) {
          doc.setTitle("");
          doc.setAuthor("");
          doc.setSubject("");
          doc.setKeywords([]);
          doc.setCreator("");
          doc.setProducer("");
        }
        var optimized = await doc.save({ useObjectStreams: !!getOpt("objectStreams") });
        var difference = file.size - optimized.length;
        savePdf(optimized, outputName(name, "pdf"));
        note("Output " + bytes(optimized.length) + (difference > 0 ? " · " + bytes(difference) + " smaller" : difference < 0 ? " · " + bytes(-difference) + " larger" : " · same size") + ". Embedded images are not recompressed.", "success");
      }
    } catch (error) {
      console.error(error);
      note(error && error.message ? error.message : "Export failed. Please try another file.", "error");
    } finally {
      run.disabled = false;
      run.textContent = tools[activeTool].button + " ↓";
    }
  }

  async function mergePdfs() {
    if (files.length < 2) throw new Error("Choose at least two PDF files to merge.");
    var ordered = files.slice();
    if (getOpt("sortFiles") === "name") ordered.sort(function (a, b) { return a.file.name.localeCompare(b.file.name); });
    var output = await PDFLib.PDFDocument.create();
    var size = getOpt("pageSize");
    var margin = Number(getOpt("margin")) || 0;
    for (var fileIndex = 0; fileIndex < ordered.length; fileIndex++) {
      note("Merging file " + (fileIndex + 1) + " of " + ordered.length + "…", "busy");
      var source = await loadPdf(ordered[fileIndex].file);
      var pages = await output.copyPages(source, source.getPageIndices());
      pages.forEach(function (page) {
        if (size !== "preserve") normalizePage(page, size, margin);
        output.addPage(page);
      });
      if (getOpt("blankBetween") && fileIndex < ordered.length - 1) output.addPage([595.28, 841.89]);
    }
    savePdf(await output.save({ useObjectStreams: true }), outputName("orbital-merged", "pdf"));
    note("Merged " + ordered.length + " PDF files successfully.", "success");
  }

  async function imagesToPdf() {
    var output = await PDFLib.PDFDocument.create();
    var sizeMode = getOpt("paperSize");
    var orientation = getOpt("orientation");
    var fitMode = getOpt("imageFit");
    var margin = Math.max(0, Number(getOpt("imageMargin")) || 0);
    var qualityMode = getOpt("imageQuality");
    var quality = qualityMode === "high" ? 0.92 : qualityMode === "balanced" ? 0.82 : qualityMode === "small" ? 0.68 : 1;

    for (var imageIndex = 0; imageIndex < images.length; imageIndex++) {
      var original = images[imageIndex];
      var type = (original.type || "").toLowerCase();
      var imageBlob = original;
      var shouldConvert = type === "image/webp" || (quality < 1);
      if (shouldConvert) {
        var bitmap = await createImageBitmap(original);
        var canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        var context = canvas.getContext("2d");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        imageBlob = await new Promise(function (resolve) { canvas.toBlob(resolve, "image/jpeg", quality < 1 ? quality : 0.92); });
        canvas.width = 0;
        canvas.height = 0;
        if (!imageBlob) throw new Error("Could not process image " + original.name + ".");
      }
      var buffer = new Uint8Array(await imageBlob.arrayBuffer());
      var embedded;
      if ((imageBlob.type || type) === "image/png" && !shouldConvert) embedded = await output.embedPng(buffer);
      else if ((imageBlob.type || type) === "image/jpeg" || shouldConvert) embedded = await output.embedJpg(buffer);
      else throw new Error("Unsupported image type: " + original.type + ". Choose JPG, PNG, or WebP.");
      var pageWidth = embedded.width;
      var pageHeight = embedded.height;
      if (sizeMode !== "fit") {
        var dimensions = sizeMode === "letter" ? { w: 612, h: 792 } : { w: 595.28, h: 841.89 };
        var isLandscape = orientation === "landscape" || (orientation === "auto" && embedded.width > embedded.height);
        if (orientation === "portrait") isLandscape = false;
        if (isLandscape) { var swap = dimensions.w; dimensions.w = dimensions.h; dimensions.h = swap; }
        pageWidth = dimensions.w;
        pageHeight = dimensions.h;
      } else {
        var factor = Math.min(1, 1200 / Math.max(pageWidth, pageHeight));
        pageWidth *= factor;
        pageHeight *= factor;
        margin = 0;
      }
      var page = output.addPage([pageWidth, pageHeight]);
      var availableWidth = Math.max(1, pageWidth - 2 * margin);
      var availableHeight = Math.max(1, pageHeight - 2 * margin);
      var drawWidth, drawHeight, drawX, drawY;
      if (fitMode === "fill") {
        drawWidth = availableWidth;
        drawHeight = availableHeight;
        drawX = margin;
        drawY = margin;
      } else {
        var scale = Math.min(availableWidth / embedded.width, availableHeight / embedded.height);
        drawWidth = embedded.width * scale;
        drawHeight = embedded.height * scale;
        drawX = (pageWidth - drawWidth) / 2;
        drawY = (pageHeight - drawHeight) / 2;
      }
      page.drawImage(embedded, { x: drawX, y: drawY, width: drawWidth, height: drawHeight });
    }
    savePdf(await output.save({ useObjectStreams: true }), outputName("images-to-pdf", "pdf"));
    note("Created a PDF from " + images.length + " image(s).", "success");
  }

  function addPdfFiles(fileList) {
    var accepted = 0;
    Array.from(fileList || []).forEach(function (file) {
      if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") return;
      var exists = files.some(function (entry) {
        return entry.file.name === file.name && entry.file.size === file.size && entry.file.lastModified === file.lastModified;
      });
      if (!exists) { files.push({ id: Math.random().toString(36).slice(2), file: file }); accepted++; }
    });
    renderQueue();
    if (files.length) renderPreview();
    note(accepted ? accepted + " PDF file(s) added. Files stay on this device." : "Choose valid PDF files that are not already in the queue.", accepted ? "success" : "error");
  }

  function addImageFiles(fileList) {
    var accepted = 0;
    Array.from(fileList || []).forEach(function (file) {
      var type = (file.type || "").toLowerCase();
      if (!/^image\/(png|jpeg|webp)$/.test(type)) return;
      var exists = images.some(function (entry) {
        return entry.name === file.name && entry.size === file.size && entry.lastModified === file.lastModified;
      });
      if (!exists) { images.push(file); accepted++; }
    });
    renderQueue();
    note(accepted ? accepted + " image(s) added. Their order becomes the PDF page order." : "Choose valid JPG, PNG, or WebP images that are not already in the queue.", accepted ? "success" : "error");
  }

  function renderQueue() {
    var list = $("#fileList");
    var items = activeTool === "images" ? images : files;
    $("#fileCount").textContent = items.length + (activeTool === "images" ? " image(s)" : " PDF file(s)");
    if (!items.length) {
      list.innerHTML = '<div class="empty-queue">Add ' + (activeTool === "images" ? "JPG, PNG, or WebP images" : "one or more PDFs") + " to begin.</div>";
      $("#previewBox").hidden = true;
      return;
    }
    list.innerHTML = items.map(function (entry, index) {
      var file = activeTool === "images" ? entry : entry.file;
      var label = activeTool === "images" ? "IMG" : "PDF";
      return '<div class="file-row"><span class="file-badge">' + label + '</span><div class="file-info"><strong title="' + escapeHtml(file.name) + '">' + escapeHtml(file.name) + '</strong><small>' + bytes(file.size) + '</small></div><div class="file-actions">' +
        '<button class="mini-btn" type="button" data-move="' + index + ':-1" aria-label="Move ' + escapeHtml(file.name) + ' up" title="Move up"' + (index === 0 ? " disabled" : "") + '>↑</button>' +
        '<button class="mini-btn" type="button" data-move="' + index + ':1" aria-label="Move ' + escapeHtml(file.name) + ' down" title="Move down"' + (index === items.length - 1 ? " disabled" : "") + '>↓</button>' +
        '<button class="mini-btn" type="button" data-remove="' + index + '" aria-label="Remove ' + escapeHtml(file.name) + '" title="Remove">×</button>' +
        '</div></div>';
    }).join("");
  }

  function renderPreview() {
    var box = $("#previewBox");
    if (!box || box.hidden || !files.length || (activeTool !== "annotate" && activeTool !== "watermark")) return;
    var requestId = ++previewRequest;
    $("#previewCaption").textContent = activeTool === "annotate" ? "Preview only. Export applies the note to your selected pages." : "Preview only. Export applies the watermark and numbering options.";
    if (!PDFJS) {
      $("#previewLabel").textContent = "Preview library loading";
      return;
    }
    var file = files[0].file;
    file.arrayBuffer().then(function (buffer) {
      return PDFJS.getDocument({ data: new Uint8Array(buffer) }).promise;
    }).then(function (pdf) {
      return pdf.getPage(1);
    }).then(function (page) {
      if (requestId !== previewRequest) return null;
      var originalViewport = page.getViewport({ scale: 1 });
      var viewport = page.getViewport({ scale: Math.min(1, 360 / originalViewport.width) });
      var canvas = $("#previewCanvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      return page.render({ canvasContext: canvas.getContext("2d", { alpha: false }), viewport: viewport }).promise;
    }).then(function () {
      if (requestId !== previewRequest) return;
      var canvas = $("#previewCanvas");
      var ctx = canvas.getContext("2d");
      ctx.save();
      if (activeTool === "watermark" && getOpt("waterText")) {
        ctx.globalAlpha = Number(getOpt("waterOpacity") || 22) / 100;
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(Number(getOpt("waterAngle") || 0) * Math.PI / 180);
        ctx.fillStyle = getOpt("waterColor") || "#685cff";
        ctx.textAlign = "center";
        ctx.font = "bold " + Math.max(10, Number(getOpt("waterSize") || 36) / 2) + "px sans-serif";
        ctx.fillText(getOpt("waterText"), 0, 0, canvas.width * 0.9);
      } else if (activeTool === "annotate" && getOpt("noteText")) {
        ctx.globalAlpha = Number(getOpt("noteOpacity") || 92) / 100;
        ctx.fillStyle = getOpt("noteColor") || "#1688ff";
        ctx.font = (getOpt("noteBold") ? "bold " : "") + Math.max(10, Number(getOpt("noteSize") || 18) / 2) + "px sans-serif";
        ctx.fillText(getOpt("noteText"), 10, canvas.height - 16, canvas.width - 20);
      }
      ctx.restore();
      $("#previewLabel").textContent = "Page 1";
    }).catch(function () {
      if (requestId === previewRequest) $("#previewLabel").textContent = "Preview unavailable";
    });
  }

  function renderSettingsPreview() {
    if (activeTool === "annotate" || activeTool === "watermark") renderPreview();
  }

  function setAccent(value) {
    var accent = /^#[0-9a-f]{6}$/i.test(value) ? value : "#685cff";
    var accents = {
      "#685cff": "#1688ff",
      "#1689ed": "#0f9fba",
      "#1688ff": "#0f9fba",
      "#d946ef": "#a855f7",
      "#10b981": "#0d9488",
      "#f97316": "#c2410c"
    };
    document.documentElement.style.setProperty("--accent", accent);
    document.documentElement.style.setProperty("--accent2", accents[accent] || "#1688ff");
    $$("[data-accent]").forEach(function (button) {
      button.setAttribute("aria-pressed", button.dataset.accent === accent ? "true" : "false");
    });
    try { localStorage.setItem("orbital-accent", accent); } catch (e) {}
  }

  function chooseTool(id) {
    if (!tools[id]) return;
    activeTool = id;
    $$("[data-tool]").forEach(function (button) {
      button.setAttribute("aria-pressed", button.dataset.tool === activeTool ? "true" : "false");
    });
    renderOptions();
    renderQueue();
    if (activeTool !== "images" && files.length) renderPreview();
    if (activeTool === "images") $("#previewBox").hidden = true;
    var destination = location.pathname + (location.search || "") + "#workspace";
    try { history.replaceState(null, "", destination); } catch (e) {}
  }

  function clearQueue() {
    files = [];
    images = [];
    previewRequest++;
    $("#pdfInput").value = "";
    $("#imageInput").value = "";
    $("#previewBox").hidden = true;
    if ($("#previewCanvas")) {
      $("#previewCanvas").width = 0;
      $("#previewCanvas").height = 0;
    }
    renderQueue();
    note("All queued files cleared.", "success");
  }

  function bind() {
    if (PDFJS) PDFJS.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    $("#year").textContent = String(new Date().getFullYear());
    $("#chooseFiles").addEventListener("click", function () { (activeTool === "images" ? $("#imageInput") : $("#pdfInput")).click(); });
    $("#dropArea").addEventListener("click", function (event) {
      if (event.target.closest("button")) return;
      (activeTool === "images" ? $("#imageInput") : $("#pdfInput")).click();
    });
    $("#dropArea").addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        (activeTool === "images" ? $("#imageInput") : $("#pdfInput")).click();
      }
    });
    $("#pdfInput").addEventListener("change", function (event) { addPdfFiles(event.target.files); event.target.value = ""; });
    $("#imageInput").addEventListener("change", function (event) { addImageFiles(event.target.files); event.target.value = ""; });
    ["dragenter", "dragover"].forEach(function (type) {
      $("#dropArea").addEventListener(type, function (event) { event.preventDefault(); $("#dropArea").classList.add("dragover"); });
    });
    ["dragleave", "drop"].forEach(function (type) {
      $("#dropArea").addEventListener(type, function (event) { event.preventDefault(); $("#dropArea").classList.remove("dragover"); });
    });
    $("#dropArea").addEventListener("drop", function (event) {
      if (activeTool === "images") addImageFiles(event.dataTransfer.files);
      else addPdfFiles(event.dataTransfer.files);
    });
    $("#fileList").addEventListener("click", function (event) {
      var moveButton = event.target.closest("[data-move]");
      var removeButton = event.target.closest("[data-remove]");
      var items = activeTool === "images" ? images : files;
      if (moveButton && !moveButton.disabled) {
        var parts = moveButton.dataset.move.split(":");
        var oldIndex = Number(parts[0]);
        var nextIndex = oldIndex + Number(parts[1]);
        if (nextIndex >= 0 && nextIndex < items.length) {
          var moved = items.splice(oldIndex, 1)[0];
          items.splice(nextIndex, 0, moved);
          renderQueue();
          if (activeTool !== "images") renderPreview();
        }
      } else if (removeButton) {
        items.splice(Number(removeButton.dataset.remove), 1);
        renderQueue();
        if (activeTool !== "images" && files.length) renderPreview();
      }
    });
    $("#clearFiles").addEventListener("click", clearQueue);
    $("#toolOptions").addEventListener("input", function (event) {
      var target = event.target;
      if (target.type === "range") {
        var rangeValue = $("#opt-" + target.dataset.opt + "-value");
        if (rangeValue) {
          var suffix = target.dataset.opt === "noteOpacity" || target.dataset.opt === "waterOpacity" ? "%" : target.dataset.opt === "waterAngle" ? "°" : target.dataset.opt === "noteSize" || target.dataset.opt === "waterSize" ? " pt" : "";
          rangeValue.textContent = target.value + suffix;
        }
      }
      if (["noteText", "noteColor", "noteOpacity", "noteSize", "noteBold", "waterText", "waterColor", "waterOpacity", "waterAngle", "waterSize"].indexOf(target.dataset.opt) >= 0) renderSettingsPreview();
    });
    $("#toolOptions").addEventListener("change", function (event) {
      if (["noteText", "noteColor", "noteOpacity", "noteSize", "noteBold", "waterText", "waterColor", "waterOpacity", "waterAngle", "waterSize"].indexOf(event.target.dataset.opt) >= 0) renderSettingsPreview();
    });
    $("#settingsForm").addEventListener("submit", function (event) { event.preventDefault(); act(); });
    $$("[data-tool]").forEach(function (button) { button.addEventListener("click", function () { chooseTool(button.dataset.tool); }); });
    $$("[data-accent]").forEach(function (button) { button.addEventListener("click", function () { setAccent(button.dataset.accent); }); });
    $("#toolSearch").addEventListener("input", function (event) {
      var query = event.target.value.trim().toLowerCase();
      $$("[data-tool]").forEach(function (button) { button.hidden = query !== "" && button.textContent.toLowerCase().indexOf(query) < 0; });
    });

    try { setAccent(localStorage.getItem("orbital-accent") || "#685cff"); } catch (e) { setAccent("#685cff"); }
    var requestedTool = new URLSearchParams(location.search).get("tool");
    if (requestedTool && tools[requestedTool]) activeTool = requestedTool;
    chooseTool(activeTool);
    if (!PDFLib || !PDFJS || !JSZip) {
      note("Loading PDF tools… If the libraries do not appear, refresh this page.", "busy");
    } else {
      note("Ready — choose a workflow and keep your files on this device.", "success");
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();