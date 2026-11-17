import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import type { Annotation, PageState, TextAnnotation } from "../types/pdf";

function hexToRgb(hex: string) {
  const clean = hex.replace("#", "");
  const num = parseInt(
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean,
    16,
  );
  const r = ((num >> 16) & 255) / 255;
  const g = ((num >> 8) & 255) / 255;
  const b = (num & 255) / 255;
  return rgb(r, g, b);
}

function isWinAnsiSafe(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 255) {
      return false;
    }
  }
  return true;
}

async function dataUrlToBytes(dataUrl: string): Promise<Uint8Array> {
  const res = await fetch(dataUrl);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

async function renderUnicodeTextAsPng(
  ann: TextAnnotation,
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const scale = 3;
  const lines = ann.text.split("\n");
  const lineHeight = ann.fontSize * 1.25;

  const measureCanvas = document.createElement("canvas");
  const mCtx = measureCanvas.getContext("2d")!;
  mCtx.font = `${ann.fontSize}px -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif`;

  let maxWidth = 10;
  for (const line of lines) {
    const w = mCtx.measureText(line || " ").width;
    if (w > maxWidth) maxWidth = w;
  }

  const width = Math.ceil(maxWidth + 8);
  const height = Math.ceil(lines.length * lineHeight + 8);

  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.font = `${ann.fontSize}px -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif`;
  ctx.fillStyle = ann.color;
  ctx.textBaseline = "top";

  lines.forEach((line, idx) => {
    ctx.fillText(line, 2, 2 + idx * lineHeight);
  });

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Canvas toBlob failed"))),
      "image/png",
    );
  });
  const arrayBuffer = await blob.arrayBuffer();
  return { bytes: new Uint8Array(arrayBuffer), width, height };
}

async function applyAnnotationsToPage(
  outDoc: PDFDocument,
  pdfPage: ReturnType<PDFDocument["getPage"]>,
  pageAnnotations: Annotation[],
  helveticaFont: Awaited<ReturnType<PDFDocument["embedFont"]>>,
) {
  const { width, height } = pdfPage.getSize();

  for (const ann of pageAnnotations) {
    if (ann.type === "highlight" || ann.type === "rect") {
      const pdfX = ann.x * width;
      const pdfW = ann.width * width;
      const pdfH = ann.height * height;
      const pdfY = height - ann.y * height - pdfH;
      const color = hexToRgb(ann.color);

      if (ann.filled) {
        pdfPage.drawRectangle({
          x: pdfX,
          y: pdfY,
          width: pdfW,
          height: pdfH,
          color,
          opacity: ann.opacity,
        });
      } else {
        pdfPage.drawRectangle({
          x: pdfX,
          y: pdfY,
          width: pdfW,
          height: pdfH,
          borderColor: color,
          borderWidth: 2,
          opacity: ann.opacity,
        });
      }
    } else if (ann.type === "draw") {
      if (ann.points.length < 2) continue;
      const color = hexToRgb(ann.color);
      for (let i = 1; i < ann.points.length; i++) {
        const p1 = ann.points[i - 1];
        const p2 = ann.points[i];
        pdfPage.drawLine({
          start: { x: p1.x * width, y: height - p1.y * height },
          end: { x: p2.x * width, y: height - p2.y * height },
          thickness: ann.strokeWidth,
          color,
        });
      }
    } else if (ann.type === "image") {
      const imgBytes = await dataUrlToBytes(ann.dataUrl);
      const embedded =
        ann.mimeType === "image/png"
          ? await outDoc.embedPng(imgBytes)
          : await outDoc.embedJpg(imgBytes);
      const pdfX = ann.x * width;
      const pdfW = ann.width * width;
      const pdfH = ann.height * height;
      const pdfY = height - ann.y * height - pdfH;
      pdfPage.drawImage(embedded, {
        x: pdfX,
        y: pdfY,
        width: pdfW,
        height: pdfH,
      });
    } else if (ann.type === "text") {
      if (ann.replaceRect) {
        const rx = ann.replaceRect.x * width;
        const rw = ann.replaceRect.width * width;
        const rh = ann.replaceRect.height * height;
        const ry = height - ann.replaceRect.y * height - rh;
        pdfPage.drawRectangle({
          x: rx - 1,
          y: ry - 1,
          width: rw + 2,
          height: rh + 2,
          color: hexToRgb(ann.bgColor || "#ffffff"),
        });
      }
      if (!ann.text.trim()) continue;
      const pdfX = ann.x * width;

      if (isWinAnsiSafe(ann.text)) {
        const lines = ann.text.split("\n");
        const lineHeight = ann.fontSize * 1.25;
        const color = hexToRgb(ann.color);
        lines.forEach((line, idx) => {
          const pdfY =
            height - ann.y * height - ann.fontSize - idx * lineHeight;
          pdfPage.drawText(line, {
            x: pdfX,
            y: pdfY,
            size: ann.fontSize,
            font: helveticaFont,
            color,
          });
        });
      } else {
        const rendered = await renderUnicodeTextAsPng(ann);
        const pngImage = await outDoc.embedPng(rendered.bytes);
        const pdfY = height - ann.y * height - rendered.height;
        pdfPage.drawImage(pngImage, {
          x: pdfX,
          y: pdfY,
          width: rendered.width,
          height: rendered.height,
        });
      }
    }
  }
}

export async function createBlankPdf(pageCount = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    // Standard A4 portrait in points (595.28 x 841.89)
    doc.addPage([595.28, 841.89]);
  }
  return doc.save();
}

export async function createDemoPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontReg = await doc.embedFont(StandardFonts.Helvetica);

  const p1 = doc.addPage([595.28, 841.89]);
  p1.drawText("Quarterly Product Specification", { x: 56, y: 760, size: 22, font: fontBold, color: rgb(0.1, 0.14, 0.22) });
  p1.drawText("Prepared by Document Software • November 2026", { x: 56, y: 734, size: 11, font: fontReg, color: rgb(0.4, 0.45, 0.52) });
  p1.drawLine({ start: { x: 56, y: 718 }, end: { x: 539, y: 718 }, thickness: 1, color: rgb(0.85, 0.88, 0.92) });

  const lines = [
    "1. Local-First Processing: All PDF rendering, text editing, and compression run offline.",
    "2. Background Color Matching: Edits sample perimeter pixels so replacements blend cleanly.",
    "3. Native macOS Vision OCR: Scanned pages are recognized on-device without cloud uploads.",
    "4. Automation Ready: Built-in local HTTP API (127.0.0.1:4890) and stdio MCP server.",
  ];
  lines.forEach((line, idx) => {
    p1.drawText(line, { x: 56, y: 680 - idx * 28, size: 12, font: fontReg, color: rgb(0.18, 0.22, 0.28) });
  });

  p1.drawRectangle({ x: 56, y: 470, width: 483, height: 76, color: rgb(0.95, 0.97, 1.0), borderColor: rgb(0.75, 0.83, 0.96), borderWidth: 1 });
  p1.drawText("Summary: Approved for release across macOS, Windows, and Linux.", { x: 74, y: 504, size: 12, font: fontBold, color: rgb(0.15, 0.35, 0.78) });

  const p2 = doc.addPage([595.28, 841.89]);
  p2.drawText("Appendix A: Release Checklist", { x: 56, y: 760, size: 18, font: fontBold, color: rgb(0.1, 0.14, 0.22) });
  p2.drawText("All 20 automated end-to-end tasks verified cleanly.", { x: 56, y: 730, size: 12, font: fontReg, color: rgb(0.3, 0.35, 0.42) });

  return doc.save();
}

export async function buildEditedPdf(
  originalBytes: Uint8Array,
  pages: PageState[],
  annotations: Annotation[],
): Promise<Uint8Array> {
  const srcDoc = await PDFDocument.load(originalBytes);
  const outDoc = await PDFDocument.create();
  const helveticaFont = await outDoc.embedFont(StandardFonts.Helvetica);

  for (const pageState of pages) {
    const [copiedPage] = await outDoc.copyPages(srcDoc, [
      pageState.sourcePageIndex,
    ]);
    const currentAngle = copiedPage.getRotation().angle;
    const totalAngle = (currentAngle + pageState.rotation) % 360;
    const pageAnns = annotations.filter((a) => a.pageId === pageState.id);

    if (totalAngle === 0 || pageAnns.length === 0) {
      if (pageState.rotation !== 0) {
        copiedPage.setRotation(degrees(totalAngle));
      }
      const addedPage = outDoc.addPage(copiedPage);
      await applyAnnotationsToPage(outDoc, addedPage, pageAnns, helveticaFont);
    } else {
      // Normalize rotated page into an upright page so all annotations align 1:1
      const { width: w, height: h } = copiedPage.getSize();
      const isQuarterTurn = totalAngle === 90 || totalAngle === 270;
      const visW = isQuarterTurn ? h : w;
      const visH = isQuarterTurn ? w : h;

      const embedded = await outDoc.embedPage(copiedPage);
      const uprightPage = outDoc.addPage([visW, visH]);

      let drawX = 0;
      let drawY = 0;
      let drawRotate = 0;
      if (totalAngle === 90) {
        drawX = 0;
        drawY = visH;
        drawRotate = -90;
      } else if (totalAngle === 180) {
        drawX = visW;
        drawY = visH;
        drawRotate = -180;
      } else if (totalAngle === 270) {
        drawX = visW;
        drawY = 0;
        drawRotate = -270;
      }

      uprightPage.drawPage(embedded, {
        x: drawX,
        y: drawY,
        rotate: degrees(drawRotate),
      });
      await applyAnnotationsToPage(outDoc, uprightPage, pageAnns, helveticaFont);
    }
  }

  return outDoc.save();
}

export async function extractSinglePagePdf(
  originalBytes: Uint8Array,
  pageState: PageState,
  annotations: Annotation[],
): Promise<Uint8Array> {
  return buildEditedPdf(originalBytes, [pageState], annotations);
}

export async function mergePdfBytes(
  baseBytes: Uint8Array,
  extraBytesList: Uint8Array[],
): Promise<Uint8Array> {
  const outDoc = await PDFDocument.load(baseBytes);
  for (const extraBytes of extraBytesList) {
    const extraDoc = await PDFDocument.load(extraBytes);
    const indices = extraDoc.getPageIndices();
    const copied = await outDoc.copyPages(extraDoc, indices);
    for (const p of copied) {
      outDoc.addPage(p);
    }
  }
  return outDoc.save();
}

export async function exportPageWithAnnotationsToPng(
  sourceCanvas: HTMLCanvasElement,
  pageAnnotations: Annotation[],
  zoom: number,
): Promise<Blob> {
  const outCanvas = document.createElement("canvas");
  outCanvas.width = sourceCanvas.width;
  outCanvas.height = sourceCanvas.height;
  const ctx = outCanvas.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable");

  ctx.drawImage(sourceCanvas, 0, 0);

  const W = outCanvas.width;
  const H = outCanvas.height;
  const dpr = window.devicePixelRatio || 1;

  for (const ann of pageAnnotations) {
    ctx.save();
    if (ann.type === "highlight" || ann.type === "rect") {
      ctx.globalAlpha = ann.opacity;
      if (ann.type === "highlight") {
        ctx.globalCompositeOperation = "multiply";
      }
      const rx = ann.x * W;
      const ry = ann.y * H;
      const rw = ann.width * W;
      const rh = ann.height * H;
      if (ann.filled) {
        ctx.fillStyle = ann.color;
        ctx.fillRect(rx, ry, rw, rh);
      } else {
        ctx.strokeStyle = ann.color;
        ctx.lineWidth = 2 * dpr;
        ctx.strokeRect(rx, ry, rw, rh);
      }
    } else if (ann.type === "draw") {
      if (ann.points.length >= 2) {
        ctx.strokeStyle = ann.color;
        ctx.lineWidth = ann.strokeWidth * dpr * zoom;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ann.points.forEach((p, idx) => {
          if (idx === 0) ctx.moveTo(p.x * W, p.y * H);
          else ctx.lineTo(p.x * W, p.y * H);
        });
        ctx.stroke();
      }
    } else if (ann.type === "image") {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = ann.dataUrl;
      });
      ctx.drawImage(img, ann.x * W, ann.y * H, ann.width * W, ann.height * H);
    } else if (ann.type === "text") {
      if (ann.replaceRect) {
        ctx.fillStyle = ann.bgColor || "#ffffff";
        ctx.fillRect(
          ann.replaceRect.x * W - 1 * dpr,
          ann.replaceRect.y * H - 1 * dpr,
          ann.replaceRect.width * W + 2 * dpr,
          ann.replaceRect.height * H + 2 * dpr,
        );
      }
      const pxSize = ann.fontSize * zoom * dpr;
      ctx.font = `${pxSize}px -apple-system, BlinkMacSystemFont, "SF Pro Text", Arial, sans-serif`;
      ctx.fillStyle = ann.color;
      ctx.textBaseline = "top";
      const lines = ann.text.split("\n");
      lines.forEach((line, idx) => {
        ctx.fillText(line, ann.x * W + 4 * dpr, ann.y * H + 2 * dpr + idx * pxSize * 1.25);
      });
    }
    ctx.restore();
  }

  return new Promise<Blob>((resolve, reject) => {
    outCanvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Failed to export PNG"))),
      "image/png",
    );
  });
}
