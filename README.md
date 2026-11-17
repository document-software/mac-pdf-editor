# Mac PDF Editor

A fast, open-source, cross-platform desktop PDF editor built with **Tauri v2 (Rust)**, **React + TypeScript**, **PDF.js**, **pdf-lib**, **lopdf**, and **macOS Vision OCR**.

Designed for native macOS ergonomics (Retina HiDPI, `⌘O`/`⌘S`/`⌘Z` shortcuts, native dialogs, light/dark themes) with automated GitHub Actions builds for **macOS (Universal arm64 + x86_64)**, **Windows**, and **Linux**.

## Features

- **View & Navigate**: Sharp HiDPI rendering via `pdfjs-dist`, zoom controls, thumbnail sidebar, light/dark themes.
- **Edit Existing & Scanned Text**:
  - Highlights all editable text blocks on the page when **Text (`T`)** tool is active.
  - Inline editor sized to the exact bounding box of the target text.
  - Automatic **background color sampling** from the rendered canvas for seamless text replacement without harsh white patches.
  - Built-in **macOS Vision OCR** (`OCR` button) to recognize and edit text on scanned/image PDFs.
  - Full Unicode / Cyrillic support when saving.
- **Annotations & Signing**: Highlights, rectangles, whiteout/redaction, freehand drawing/signatures, PNG/JPG image & stamp insertion, full Undo/Redo (`⌘Z` / `⇧⌘Z`).
- **Page Management**: Reorder, rotate (`90°`), duplicate, delete, extract single pages, merge multiple PDFs, create blank A4 PDFs.
- **Rust PDF Engine (`lopdf`)**: Inspect PDF metadata, compress/optimize PDFs, export pages with annotations to PNG.
- **HTTP Control API & MCP Server**: Control the live app programmatically via `http://127.0.0.1:4890` or Model Context Protocol ([`mcp/server.mjs`](mcp/server.mjs)).

See [docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md) for a detailed architectural breakdown.

## Local Development

Requirements: Node.js 20+, Rust (`rustup`), Xcode Command Line Tools (macOS).

```bash
npm install
npm run tauri dev
```

## Build `.app` / `.dmg`

```bash
npm run tauri build
```

## Run 20-Task Automated Test Suite

With the app running:

```bash
node tests/run_20_tasks.mjs
```
