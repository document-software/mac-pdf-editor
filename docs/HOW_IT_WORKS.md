# How Mac PDF Editor Works

This document explains the internal architecture of **Mac PDF Editor**, a cross-platform desktop PDF editor built with **Tauri v2 (Rust)**, **React + TypeScript**, **PDF.js**, **pdf-lib**, **lopdf**, and **Apple Vision OCR**.

---

## 1. Architecture Overview

```text
┌───────────────────────────────────────────────────────────────────┐
│                      React + TypeScript UI                        │
│  Toolbar • Sidebar (Thumbnails) • PdfPageCanvas • Inspector       │
├─────────────────────────────────┬─────────────────────────────────┤
│   Rendering & Text Extraction   │        PDF Export / Bake        │
│       pdfjs-dist (Worker)       │       pdf-lib + Canvas PNG      │
└────────────────┬────────────────┴────────────────┬────────────────┘
                 │ Tauri IPC (ArrayBuffer / JSON)  │
┌────────────────▼─────────────────────────────────▼────────────────┐
│                        Rust Backend (Tauri v2)                    │
│  • File I/O (read_pdf_bytes, save_pdf_bytes)                      │
│  • PDF Metadata & Compression (lopdf: get/set_pdf_info, compress) │
│  • macOS Vision OCR (ocr_page_png -> Swift VNRecognizeTextRequest)│
│  • Local HTTP Control API (127.0.0.1:4890) -> api-command bridge  │
└─────────────────────────────────┬─────────────────────────────────┘
                                  │
                     ┌────────────▼────────────┐
                     │   MCP Server (stdio)    │
                     │     mcp/server.mjs      │
                     └─────────────────────────┘
```

---

## 2. How Text Editing Works

PDF files do not store paragraphs like Word documents; they store glyphs at absolute `(x, y)` coordinates or, in scanned PDFs, flat raster images. Mac PDF Editor handles both cases:

### A. Native PDF Text Layer (`pdfjs-dist`)
1. When a page renders, [`PdfPageCanvas.tsx`](../src/components/PdfPageCanvas.tsx) calls `page.getTextContent()` and transforms every text run using `pdfjsLib.Util.transform(viewport.transform, item.transform)`.
2. When **Text (`T`)** mode is active, every detected text block is **highlighted** with a dashed blue box (`.pdf-text-hitbox`).
3. Clicking a text block opens an inline `<textarea>` sized to match the exact width and height of the target block (expanding dynamically as you type).

### B. Background Color Sampling (Seamless Replacement)
Instead of stamping a harsh `#ffffff` patch over cream, gray, or colored backgrounds:
1. `sampleBackgroundColor()` reads 16 pixels around the perimeter of the text bounding box directly from the rendered `<canvas>`.
2. It computes the **median RGB color** (filtering out glyph edges) and calculates luminance.
3. That sampled `bgColor` is used for:
   - The inline editor background while typing,
   - The cover rectangle on screen (`.ann-text-cover`),
   - The underlying PDF rectangle (`pdfPage.drawRectangle`) when saving via [`pdfExport.ts`](../src/utils/pdfExport.ts).
4. If the sampled background is dark (`luminance < 128`), the replacement text color automatically defaults to `#ffffff`.

### C. Scanned / Image PDFs (macOS Vision OCR)
If a PDF page has no embedded text layer (e.g., scanned documents), clicking **OCR** in the toolbar or Inspector:
1. Renders the current page at `2.0x` resolution to PNG.
2. Invokes [`ocr_page_png`](../src-tauri/src/pdf.rs) in Rust, which runs Apple's native `Vision.VNRecognizeTextRequest` (`en-US`, `ru-RU`, `.accurate`).
3. Returns normalized `(x, y, width, height, text)` bounding boxes and overlays them as editable highlighted blocks in **Text (`T`)** mode.

### D. Unicode & Cyrillic Support in `pdf-lib`
Standard PDF Type1 fonts (`Helvetica`) only support WinAnsi characters. When saving:
- ASCII / Latin-1 strings are written as native PDF vector text (`pdfPage.drawText`).
- Unicode and Cyrillic strings are automatically rendered at `3x` Retina scale to a transparent PNG and embedded via `outDoc.embedPng` so any language exports without font-encoding errors.

---

## 3. Page Operations & Rotation Alignment

- All annotations are stored in **normalized page coordinates (`0..1`)** relative to the visual page size.
- When saving a page rotated by `90°`, `180°`, or `270°`, [`buildEditedPdf`](../src/utils/pdfExport.ts) normalizes the rotated page into an upright page using `outDoc.embedPage(...)` before applying annotations so every mark stays aligned 1:1.

---

## 4. Local HTTP Control API & MCP Server

When **Mac PDF Editor** is running, it exposes a local HTTP API on **`http://127.0.0.1:4890`**:
- `GET /health`: health check
- `GET /state`: current file path, page count, zoom, annotations count, and `lopdf` metadata
- `POST /command`: `{ "action": "...", "payload": { ... } }` supporting `open`, `new_blank`, `extract_text`, `search_text`, `annotation_add`, `annotation_clear`, `page_select`, `page_rotate`, `page_duplicate`, `page_delete`, `save`, `compress`, and `export_png`.

### Connecting via MCP (`mcp/server.mjs`)
Add this to your MCP client configuration (Claude Desktop, Cursor, Antigravity):

```json
{
  "mcpServers": {
    "mac-pdf-editor": {
      "command": "node",
      "args": ["/Users/alekseykhokhlov/repo/github/mac-pdf-editor/mcp/server.mjs"]
    }
  }
}
```
