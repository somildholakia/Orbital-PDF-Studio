# Orbital PDF Studio

Browser-based PDF tools for [pdf.dyvona.in](https://pdf.dyvona.in/).

## Deployment

This is a static site. Configure Vercel to use `src` as the Root Directory and leave the build command empty; serve the directory as-is. The app processes PDF files locally in the browser.

## Features

- Merge, split, and organize PDF pages
- Add text annotations and watermarks
- Convert images to PDF and PDF pages to PNG
- Extract selectable PDF text
- Rewrite PDF structure for basic optimization
- Per-tool settings, appearance themes, and accent colors

## Advertising

AdSense is intentionally disabled until the site owner adds the approved publisher ID and ad-slot IDs to `src/ads-config.js`. Never enable placeholder IDs or click your own ads.

## Limitations

Text extraction does not include OCR for scanned pages. Annotation notes are flattened overlays. Optimization does not recompress embedded images.
