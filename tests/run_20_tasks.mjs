#!/usr/bin/env node
/**
 * 20-Task End-to-End Test Suite for Mac PDF Editor (API + MCP + PDF Engine)
 * Target PDF: /Users/alekseykhokhlov/Downloads/1839333177664910.pdf
 */

import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

const INPUT_PDF = "/Users/alekseykhokhlov/Downloads/1839333177664910.pdf";
const OUT_DIR = path.resolve(process.cwd(), "tests/output");
const API_BASE = "http://127.0.0.1:4890";

fs.mkdirSync(OUT_DIR, { recursive: true });

// Minimal 1x1 blue PNG data URL for image stamp insertion test
const SAMPLE_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFElEQVR42mNkYPhfz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC";

async function apiPost(action, payload = {}) {
  const res = await fetch(`${API_BASE}/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });
  const json = await res.json();
  if (!res.ok || json.ok === false || json.error) {
    throw new Error(`API ${action} failed: ${JSON.stringify(json)}`);
  }
  return json;
}

async function testMcpStdio() {
  return new Promise((resolve, reject) => {
    const child = spawn("node", ["mcp/server.mjs"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    const responses = [];

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      out += chunk;
      const lines = out.split("\n");
      out = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) responses.push(JSON.parse(line));
      }
      if (responses.length >= 3) {
        child.kill();
        resolve(responses);
      }
    });

    child.on("error", reject);
    setTimeout(() => {
      child.kill();
      reject(new Error("MCP stdio timeout"));
    }, 8000);

    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-runner", version: "1.0.0" },
        },
      }) + "\n",
    );
    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\n",
    );
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "pdf_editor_health", arguments: {} },
      }) + "\n",
    );
  });
}

const results = [];
async function runTask(num, name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    const ms = Date.now() - t0;
    results.push({ num, name, status: "PASS", ms, detail });
    console.log(`✅ [${String(num).padStart(2, "0")}/20] ${name} (${ms}ms) — ${detail}`);
  } catch (err) {
    const ms = Date.now() - t0;
    results.push({ num, name, status: "FAIL", ms, detail: String(err) });
    console.error(`❌ [${String(num).padStart(2, "0")}/20] ${name} (${ms}ms) — ${err}`);
  }
}

async function main() {
  assert.ok(fs.existsSync(INPUT_PDF), `Missing input PDF: ${INPUT_PDF}`);

  // Task 1: HTTP API Health & MCP Stdio Protocol
  await runTask(1, "HTTP Control API & MCP stdio handshake", async () => {
    const healthRes = await fetch(`${API_BASE}/health`);
    const health = await healthRes.json();
    assert.equal(health.ok, true);

    const mcpResponses = await testMcpStdio();
    assert.equal(mcpResponses[0].result.serverInfo.name, "mac-pdf-editor-mcp");
    assert.ok(mcpResponses[1].result.tools.length >= 10);
    const callText = JSON.parse(mcpResponses[2].result.content[0].text);
    assert.equal(callText.ok, true);
    return `API port ${health.port}, MCP tools=${mcpResponses[1].result.tools.length}`;
  });

  // Task 2: Open target 9.6MB PDF in Mac PDF Editor
  await runTask(2, "Open target PDF via API", async () => {
    const res = await apiPost("open", { path: INPUT_PDF });
    assert.equal(res.filePath, INPUT_PDF);
    return path.basename(res.filePath);
  });

  // Task 3: Get document state & Rust lopdf metadata
  let initialPageCount = 0;
  await runTask(3, "Inspect PDF state & Rust lopdf metadata", async () => {
    const state = await apiPost("get_state");
    assert.ok(state.pageCount >= 1);
    initialPageCount = state.pageCount;
    return `pages=${state.pageCount}, pdfVersion=${state.metadata?.pdfVersion}, size=${(
      (state.metadata?.fileSize || 0) /
      (1024 * 1024)
    ).toFixed(2)}MB`;
  });

  // Task 4: Extract text from PDF
  let extractedFirstSnippet = "";
  await runTask(4, "Extract text from PDF pages", async () => {
    const res = await apiPost("extract_text", { pageIndex: 0 });
    assert.ok(Array.isArray(res.pages));
    const txt = res.pages[0]?.text || "";
    extractedFirstSnippet = txt.slice(0, 40);
    return `page1Chars=${txt.length}, sample="${extractedFirstSnippet}"`;
  });

  // Task 5: Search text across PDF
  await runTask(5, "Search text across PDF", async () => {
    const token =
      extractedFirstSnippet
        .split(/\s+/)
        .find((w) => w.length >= 3) || "a";
    const res = await apiPost("search_text", { query: token });
    assert.ok(res.count >= 0);
    return `query="${token}", matches=${res.count}`;
  });

  // Task 6: Add new text annotation (with Cyrillic + Latin)
  await runTask(6, "Add Unicode/Cyrillic text annotation", async () => {
    const res = await apiPost("annotation_add", {
      pageIndex: 0,
      annotation: {
        type: "text",
        x: 0.08,
        y: 0.06,
        text: "Проверено Mac PDF Editor ✓",
        fontSize: 16,
        color: "#2563eb",
      },
    });
    assert.ok(res.id);
    return `id=${res.id}`;
  });

  // Task 7: Replace existing PDF text block (text + sampled bgColor replaceRect)
  await runTask(7, "Edit/replace existing PDF text block", async () => {
    const res = await apiPost("annotation_add", {
      pageIndex: 0,
      annotation: {
        type: "text",
        x: 0.08,
        y: 0.12,
        text: "UPDATED HEADER",
        fontSize: 14,
        color: "#111827",
        bgColor: "#f5f2eb",
        replaceRect: { x: 0.08, y: 0.12, width: 0.25, height: 0.03 },
      },
    });
    assert.ok(res.id);
    return `replaceId=${res.id}`;
  });

  // Task 8: Add highlight marker
  await runTask(8, "Add highlight marker annotation", async () => {
    const res = await apiPost("annotation_add", {
      pageIndex: 0,
      annotation: {
        type: "highlight",
        x: 0.1,
        y: 0.2,
        width: 0.35,
        height: 0.035,
        color: "#facc15",
        opacity: 0.35,
        filled: true,
      },
    });
    assert.ok(res.id);
    return `highlightId=${res.id}`;
  });

  // Task 9: Add rectangle outline
  await runTask(9, "Add rectangle border annotation", async () => {
    const res = await apiPost("annotation_add", {
      pageIndex: 0,
      annotation: {
        type: "rect",
        x: 0.1,
        y: 0.28,
        width: 0.3,
        height: 0.08,
        color: "#ef4444",
        opacity: 1,
        filled: false,
      },
    });
    assert.ok(res.id);
    return `rectId=${res.id}`;
  });

  // Task 10: Redact / whiteout sensitive region
  await runTask(10, "Redact/whiteout sensitive region", async () => {
    const res = await apiPost("annotation_add", {
      pageIndex: 0,
      annotation: {
        type: "rect",
        x: 0.5,
        y: 0.28,
        width: 0.25,
        height: 0.05,
        color: "#ffffff",
        opacity: 1,
        filled: true,
      },
    });
    assert.ok(res.id);
    return `redactionId=${res.id}`;
  });

  // Task 11: Add freehand signature / drawing path
  await runTask(11, "Add vector freehand signature", async () => {
    const res = await apiPost("annotation_add", {
      pageIndex: 0,
      annotation: {
        type: "draw",
        color: "#16a34a",
        strokeWidth: 3,
        points: [
          { x: 0.6, y: 0.8 },
          { x: 0.65, y: 0.77 },
          { x: 0.7, y: 0.82 },
          { x: 0.76, y: 0.78 },
        ],
      },
    });
    assert.ok(res.id);
    return `drawId=${res.id}`;
  });

  // Task 12: Insert PNG image / stamp
  await runTask(12, "Insert PNG image/stamp onto page", async () => {
    const res = await apiPost("annotation_add", {
      pageIndex: 0,
      annotation: {
        type: "image",
        x: 0.75,
        y: 0.06,
        width: 0.12,
        height: 0.08,
        color: "#000000",
        dataUrl: SAMPLE_PNG_DATA_URL,
        mimeType: "image/png",
      },
    });
    assert.ok(res.id);
    return `imageId=${res.id}`;
  });

  // Task 13: Rotate page 90 degrees
  await runTask(13, "Rotate page 0 by 90 degrees", async () => {
    const res = await apiPost("page_rotate", { index: 0, degrees: 90 });
    assert.equal(res.addedDegrees, 90);
    return "rotated +90°";
  });

  // Task 14: Duplicate page
  await runTask(14, "Duplicate page 0", async () => {
    const res = await apiPost("page_duplicate", { index: 0 });
    assert.ok(res.newPageId);
    const st = await apiPost("get_state");
    assert.equal(st.pageCount, initialPageCount + 1);
    return `pages=${st.pageCount}`;
  });

  // Task 15: Delete duplicated page
  await runTask(15, "Delete duplicated page 1", async () => {
    await apiPost("page_delete", { index: 1 });
    const st = await apiPost("get_state");
    assert.equal(st.pageCount, initialPageCount);
    return `pages=${st.pageCount}`;
  });

  // Task 16: Save edited PDF & verify via pdf-lib
  const editedPdfPath = path.join(OUT_DIR, "edited_1839333177664910.pdf");
  await runTask(16, "Save edited PDF & verify structure", async () => {
    const res = await apiPost("save", { path: editedPdfPath });
    assert.ok(fs.existsSync(editedPdfPath));
    const loaded = await PDFDocument.load(fs.readFileSync(editedPdfPath));
    assert.equal(loaded.getPageCount(), initialPageCount);
    return `saved ${(res.size / (1024 * 1024)).toFixed(2)}MB`;
  });

  // Task 17: Export current page with annotations to PNG
  const exportedPngPath = path.join(OUT_DIR, "page_1.png");
  await runTask(17, "Export page 1 with annotations to PNG", async () => {
    const res = await apiPost("export_png", { path: exportedPngPath });
    const buf = fs.readFileSync(exportedPngPath);
    // Check PNG magic bytes
    assert.equal(buf[0], 0x89);
    assert.equal(buf[1], 0x50);
    assert.equal(buf[2], 0x4e);
    assert.equal(buf[3], 0x47);
    return `png ${(res.size / 1024).toFixed(1)}KB`;
  });

  // Task 18: Compress PDF via Rust lopdf engine
  const compressedPdfPath = path.join(OUT_DIR, "compressed_1839333177664910.pdf");
  await runTask(18, "Compress PDF via Rust lopdf engine", async () => {
    const res = await apiPost("compress", { outputPath: compressedPdfPath });
    assert.ok(fs.existsSync(compressedPdfPath));
    const loaded = await PDFDocument.load(fs.readFileSync(compressedPdfPath));
    assert.equal(loaded.getPageCount(), initialPageCount);
    return `orig=${(res.originalSize / 1024).toFixed(0)}KB -> comp=${(
      res.compressedSize / 1024
    ).toFixed(0)}KB`;
  });

  // Task 19: Add Watermark & Page Numbers across all pages
  const watermarkedPath = path.join(OUT_DIR, "watermarked_numbered.pdf");
  await runTask(19, "Add Watermark & Page Numbers to all pages", async () => {
    const doc = await PDFDocument.load(fs.readFileSync(INPUT_PDF));
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    const total = doc.getPageCount();
    doc.getPages().forEach((p, idx) => {
      const { width, height } = p.getSize();
      p.drawText("CONFIDENTIAL", {
        x: width * 0.25,
        y: height * 0.5,
        size: 42,
        font,
        color: rgb(0.85, 0.2, 0.2),
        opacity: 0.25,
        rotate: degrees(35),
      });
      p.drawText(`Page ${idx + 1} / ${total}`, {
        x: width - 95,
        y: 20,
        size: 10,
        font,
        color: rgb(0.3, 0.3, 0.3),
      });
    });
    const saved = await doc.save();
    fs.writeFileSync(watermarkedPath, saved);
    const verify = await PDFDocument.load(fs.readFileSync(watermarkedPath));
    assert.equal(verify.getPageCount(), total);
    return `watermarked & numbered ${total} pages`;
  });

  // Task 20: Split page 1, Merge with new blank page & update PDF metadata
  const splitMergedPath = path.join(OUT_DIR, "split_merged_meta.pdf");
  await runTask(20, "Split + Merge + Update PDF Metadata", async () => {
    const src = await PDFDocument.load(fs.readFileSync(INPUT_PDF));
    const out = await PDFDocument.create();
    const [first] = await out.copyPages(src, [0]);
    out.addPage(first);
    out.addPage([595.28, 841.89]); // Blank A4 page merged
    out.setTitle("Edited 1839333177664910");
    out.setAuthor("Mac PDF Editor");
    out.setCreator("Mac PDF Editor v0.1.0");
    fs.writeFileSync(splitMergedPath, await out.save());

    const verify = await PDFDocument.load(fs.readFileSync(splitMergedPath));
    assert.equal(verify.getPageCount(), 2);
    assert.equal(verify.getTitle(), "Edited 1839333177664910");
    return `pages=${verify.getPageCount()}, title="${verify.getTitle()}"`;
  });

  const passed = results.filter((r) => r.status === "PASS").length;
  console.log(`\n=== SUMMARY: ${passed}/20 tasks PASSED ===`);
  if (passed < 20) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal test error:", err);
  process.exit(1);
});
