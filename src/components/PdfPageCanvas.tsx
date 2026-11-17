import React, { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type {
  Annotation,
  DrawAnnotation,
  ImageAnnotation,
  PageState,
  RectAnnotation,
  TextAnnotation,
  ToolType,
} from "../types/pdf";

interface ExtractedTextItem {
  id: string;
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
}

function sampleBackgroundColor(
  canvas: HTMLCanvasElement | null,
  normX: number,
  normY: number,
  normW: number,
  normH: number,
): { bgColor: string; isDarkBg: boolean } {
  if (!canvas || canvas.width === 0 || canvas.height === 0) {
    return { bgColor: "#ffffff", isDarkBg: false };
  }
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { bgColor: "#ffffff", isDarkBg: false };

  const W = canvas.width;
  const H = canvas.height;
  const left = Math.max(0, Math.floor(normX * W) - 2);
  const top = Math.max(0, Math.floor(normY * H) - 2);
  const right = Math.min(W - 1, Math.ceil((normX + normW) * W) + 2);
  const bottom = Math.min(H - 1, Math.ceil((normY + normH) * H) + 2);

  const points: Array<[number, number]> = [];
  for (let i = 0; i <= 4; i++) {
    const px = Math.round(left + ((right - left) * i) / 4);
    const py = Math.round(top + ((bottom - top) * i) / 4);
    points.push([px, top], [px, bottom], [left, py], [right, py]);
  }

  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];

  for (const [px, py] of points) {
    const data = ctx.getImageData(px, py, 1, 1).data;
    rs.push(data[0]);
    gs.push(data[1]);
    bs.push(data[2]);
  }

  const median = (arr: number[]) => {
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 255;
  };

  const r = median(rs);
  const g = median(gs);
  const b = median(bs);
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

  return {
    bgColor: `#${toHex(r)}${toHex(g)}${toHex(b)}`,
    isDarkBg: luminance < 128,
  };
}

export interface OcrBlock {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PdfPageCanvasProps {
  pdfDoc: PDFDocumentProxy;
  pageState: PageState;
  zoom: number;
  activeTool: ToolType;
  toolColor: string;
  fontSize: number;
  strokeWidth: number;
  rectFilled: boolean;
  annotations: Annotation[];
  ocrBlocks: OcrBlock[];
  selectedId: string | null;
  onSelectAnnotation: (id: string | null) => void;
  onAddAnnotation: (ann: Annotation) => void;
  onUpdateAnnotation: (id: string, patch: Partial<Annotation>) => void;
  onDeleteAnnotation: (id: string) => void;
  onCanvasReady?: (canvas: HTMLCanvasElement | null) => void;
  onTextBlocksCountChange?: (count: number) => void;
}

export const PdfPageCanvas: React.FC<PdfPageCanvasProps> = ({
  pdfDoc,
  pageState,
  zoom,
  activeTool,
  toolColor,
  fontSize,
  strokeWidth,
  rectFilled,
  annotations,
  ocrBlocks,
  selectedId,
  onSelectAnnotation,
  onAddAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
  onCanvasReady,
  onTextBlocksCountChange,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const onCanvasReadyRef = useRef(onCanvasReady);
  onCanvasReadyRef.current = onCanvasReady;
  const [pageSize, setPageSize] = useState<{ width: number; height: number }>({
    width: 600,
    height: 800,
  });
  const [extractedTexts, setExtractedTexts] = useState<ExtractedTextItem[]>([]);

  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [draftRect, setDraftRect] = useState<{
    startX: number;
    startY: number;
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const [draftDraw, setDraftDraw] = useState<Array<{ x: number; y: number }> | null>(null);

  const dragStateRef = useRef<{
    mode: "move" | "resize";
    id: string;
    startMouseX: number;
    startMouseY: number;
    origX: number;
    origY: number;
    origW?: number;
    origH?: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel: () => void } | null = null;

    async function renderPage() {
      const page = await pdfDoc.getPage(pageState.sourcePageIndex + 1);
      if (cancelled || !canvasRef.current) return;

      const viewport = page.getViewport({ scale: zoom, rotation: pageState.rotation });
      const canvas = canvasRef.current;
      const dpr = window.devicePixelRatio || 1;

      const w = Math.floor(viewport.width);
      const h = Math.floor(viewport.height);
      setPageSize({ width: w, height: h });

      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const task = page.render({
        canvas,
        canvasContext: ctx,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      });
      renderTask = task;

      try {
        await task.promise;
        if (cancelled) return;
        onCanvasReadyRef.current?.(canvas);

        // Extract selectable/editable text blocks from PDF page
        const textContent = await page.getTextContent();
        if (cancelled) return;
        const items: ExtractedTextItem[] = [];
        for (let i = 0; i < textContent.items.length; i++) {
          const item = textContent.items[i] as {
            str?: string;
            transform?: number[];
            width?: number;
            height?: number;
          };
          if (!item.str || !item.str.trim() || !item.transform) continue;
          const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
          const fontPx = Math.max(8, Math.hypot(tx[2], tx[3]));
          const itemW = Math.max(12, (item.width || 0) * zoom);
          const itemH = fontPx * 1.15;
          items.push({
            id: `pdf-txt-${i}`,
            str: item.str,
            x: Math.max(0, tx[4] / viewport.width),
            y: Math.max(0, (tx[5] - fontPx) / viewport.height),
            width: Math.min(1, itemW / viewport.width),
            height: Math.min(1, itemH / viewport.height),
            fontSize: Math.round(fontPx / zoom),
          });
        }
        setExtractedTexts(items);
      } catch {
        // Cancelled on re-render
      }
    }

    renderPage();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pdfDoc, pageState.sourcePageIndex, pageState.rotation, zoom]);

  const getNormalizedCoords = (clientX: number, clientY: number) => {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    return { x, y };
  };

  // Global mouse move/up for dragging annotations without blocking doubleClick
  useEffect(() => {
    const onWinMove = (e: PointerEvent) => {
      const ds = dragStateRef.current;
      if (!ds) return;
      const { x, y } = getNormalizedCoords(e.clientX, e.clientY);
      const dx = x - ds.startMouseX;
      const dy = y - ds.startMouseY;
      if (ds.mode === "move") {
        onUpdateAnnotation(ds.id, {
          x: Math.max(0, Math.min(0.98, ds.origX + dx)),
          y: Math.max(0, Math.min(0.98, ds.origY + dy)),
        });
      } else if (
        ds.mode === "resize" &&
        ds.origW !== undefined &&
        ds.origH !== undefined
      ) {
        onUpdateAnnotation(ds.id, {
          width: Math.max(0.03, Math.min(1 - ds.origX, ds.origW + dx)),
          height: Math.max(0.03, Math.min(1 - ds.origY, ds.origH + dy)),
        });
      }
    };
    const onWinUp = () => {
      dragStateRef.current = null;
    };
    window.addEventListener("pointermove", onWinMove);
    window.addEventListener("pointerup", onWinUp);
    return () => {
      window.removeEventListener("pointermove", onWinMove);
      window.removeEventListener("pointerup", onWinUp);
    };
  }, [onUpdateAnnotation]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const { x, y } = getNormalizedCoords(e.clientX, e.clientY);

    if (activeTool === "select") {
      if (e.target === overlayRef.current) {
        onSelectAnnotation(null);
        setEditingTextId(null);
      }
      return;
    }

    if (activeTool === "text") {
      // Handled onClick so pointerup does not blur the newly focused textarea
      return;
    }

    if (activeTool === "highlight" || activeTool === "rect") {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDraftRect({ startX: x, startY: y, x, y, w: 0, h: 0 });
      return;
    }

    if (activeTool === "draw") {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDraftDraw([{ x, y }]);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const { x, y } = getNormalizedCoords(e.clientX, e.clientY);

    if (draftRect) {
      const nx = Math.min(draftRect.startX, x);
      const ny = Math.min(draftRect.startY, y);
      const nw = Math.abs(x - draftRect.startX);
      const nh = Math.abs(y - draftRect.startY);
      setDraftRect({ ...draftRect, x: nx, y: ny, w: nw, h: nh });
      return;
    }

    if (draftDraw) {
      setDraftDraw((prev) => (prev ? [...prev, { x, y }] : null));
    }
  };

  const handlePointerUp = () => {
    if (draftRect) {
      if (draftRect.w > 0.008 && draftRect.h > 0.008) {
        const id = crypto.randomUUID();
        const isHighlight = activeTool === "highlight";
        const newRect: RectAnnotation = {
          id,
          pageId: pageState.id,
          type: isHighlight ? "highlight" : "rect",
          x: draftRect.x,
          y: draftRect.y,
          width: draftRect.w,
          height: draftRect.h,
          color: toolColor,
          opacity: isHighlight ? 0.35 : 1,
          filled: isHighlight ? true : rectFilled,
        };
        onAddAnnotation(newRect);
        onSelectAnnotation(id);
      }
      setDraftRect(null);
      return;
    }

    if (draftDraw) {
      if (draftDraw.length >= 2) {
        const id = crypto.randomUUID();
        const newDraw: DrawAnnotation = {
          id,
          pageId: pageState.id,
          type: "draw",
          points: draftDraw,
          color: toolColor,
          strokeWidth,
        };
        onAddAnnotation(newDraw);
        onSelectAnnotation(id);
      }
      setDraftDraw(null);
    }
  };

  const startDrag = (
    e: React.PointerEvent,
    ann: TextAnnotation | RectAnnotation | ImageAnnotation,
  ) => {
    if (activeTool !== "select") return;
    e.stopPropagation();
    onSelectAnnotation(ann.id);
    const { x, y } = getNormalizedCoords(e.clientX, e.clientY);
    dragStateRef.current = {
      mode: "move",
      id: ann.id,
      startMouseX: x,
      startMouseY: y,
      origX: ann.x,
      origY: ann.y,
    };
  };

  const startResize = (
    e: React.PointerEvent,
    ann: RectAnnotation | ImageAnnotation,
  ) => {
    e.stopPropagation();
    const { x, y } = getNormalizedCoords(e.clientX, e.clientY);
    dragStateRef.current = {
      mode: "resize",
      id: ann.id,
      startMouseX: x,
      startMouseY: y,
      origX: ann.x,
      origY: ann.y,
      origW: ann.width,
      origH: ann.height,
    };
  };

  const handleEditExistingPdfText = (item: ExtractedTextItem) => {
    const { bgColor, isDarkBg } = sampleBackgroundColor(
      canvasRef.current,
      item.x,
      item.y,
      item.width,
      item.height,
    );
    const id = crypto.randomUUID();
    const newText: TextAnnotation = {
      id,
      pageId: pageState.id,
      type: "text",
      x: item.x,
      y: item.y,
      text: item.str,
      fontSize: Math.max(8, item.fontSize),
      color: isDarkBg ? "#ffffff" : toolColor,
      replaceRect: {
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
      },
      bgColor,
    };
    onAddAnnotation(newText);
    onSelectAnnotation(id);
    setEditingTextId(id);
  };

  const pageAnnotations = annotations.filter((a) => a.pageId === pageState.id);

  // Combine native PDF text layer with macOS Vision OCR blocks (when run)
  const combinedTextBlocks: ExtractedTextItem[] = [
    ...extractedTexts,
    ...ocrBlocks.map((b, i) => ({
      id: `ocr-txt-${i}`,
      str: b.text,
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      fontSize: Math.max(10, Math.round((b.height * pageSize.height) / zoom * 0.78)),
    })),
  ];

  useEffect(() => {
    onTextBlocksCountChange?.(combinedTextBlocks.length);
  }, [combinedTextBlocks.length, onTextBlocksCountChange]);

  return (
    <div
      className="pdf-page-container"
      style={{ width: pageSize.width, height: pageSize.height }}
    >
      <canvas ref={canvasRef} className="pdf-canvas" />

      <div
        ref={overlayRef}
        className={`pdf-overlay tool-${activeTool}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onClick={(e) => {
          if (activeTool !== "text") return;
          if (e.target !== overlayRef.current) return;
          if (editingTextId) {
            setEditingTextId(null);
            return;
          }
          const { x, y } = getNormalizedCoords(e.clientX, e.clientY);
          const id = crypto.randomUUID();
          const newText: TextAnnotation = {
            id,
            pageId: pageState.id,
            type: "text",
            x,
            y,
            text: "",
            fontSize,
            color: toolColor,
          };
          onAddAnnotation(newText);
          onSelectAnnotation(id);
          setEditingTextId(id);
        }}
      >
        {/* Existing PDF + OCR text hitboxes when Text tool is active */}
        {activeTool === "text" &&
          combinedTextBlocks.map((item) => (
            <div
              key={item.id}
              className="pdf-text-hitbox"
              style={{
                left: `${item.x * 100}%`,
                top: `${item.y * 100}%`,
                width: `${item.width * 100}%`,
                height: `${item.height * 100}%`,
              }}
              title="Click to edit this text"
              onClick={(e) => {
                e.stopPropagation();
                handleEditExistingPdfText(item);
              }}
            />
          ))}

        {/* Cover rectangles for replaced PDF text */}
        {pageAnnotations
          .filter((a): a is TextAnnotation => a.type === "text" && Boolean(a.replaceRect))
          .map((txt) => (
            <div
              key={`${txt.id}-cover`}
              className="ann-text-cover"
              style={{
                left: `calc(${txt.replaceRect!.x * 100}% - 1px)`,
                top: `calc(${txt.replaceRect!.y * 100}% - 1px)`,
                width: `calc(${txt.replaceRect!.width * 100}% + 2px)`,
                height: `calc(${txt.replaceRect!.height * 100}% + 2px)`,
                backgroundColor: txt.bgColor || "#ffffff",
              }}
            />
          ))}

        <svg
          className="pdf-svg-layer"
          viewBox="0 0 1000 1000"
          preserveAspectRatio="none"
        >
          {pageAnnotations
            .filter((a): a is DrawAnnotation => a.type === "draw")
            .map((draw) => {
              const d = draw.points
                .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x * 1000} ${p.y * 1000}`)
                .join(" ");
              const isSel = selectedId === draw.id;
              return (
                <path
                  key={draw.id}
                  d={d}
                  fill="none"
                  stroke={draw.color}
                  strokeWidth={draw.strokeWidth * 1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={isSel ? "svg-selected" : ""}
                  style={{ pointerEvents: activeTool === "select" ? "stroke" : "none" }}
                  onClick={(e) => {
                    if (activeTool !== "select") return;
                    e.stopPropagation();
                    onSelectAnnotation(draw.id);
                  }}
                />
              );
            })}

          {draftDraw && draftDraw.length >= 2 && (
            <path
              d={draftDraw
                .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x * 1000} ${p.y * 1000}`)
                .join(" ")}
              fill="none"
              stroke={toolColor}
              strokeWidth={strokeWidth * 1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>

        {pageAnnotations
          .filter((a): a is RectAnnotation => a.type === "rect" || a.type === "highlight")
          .map((rect) => {
            const isSel = selectedId === rect.id;
            return (
              <div
                key={rect.id}
                className={`ann-rect ${isSel ? "selected" : ""}`}
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.width * 100}%`,
                  height: `${rect.height * 100}%`,
                  backgroundColor: rect.filled ? rect.color : "transparent",
                  border: rect.filled ? "none" : `2px solid ${rect.color}`,
                  opacity: rect.opacity,
                  mixBlendMode: rect.type === "highlight" ? "multiply" : "normal",
                }}
                onPointerDown={(e) => startDrag(e, rect)}
              >
                {isSel && (
                  <div
                    className="resize-handle"
                    onPointerDown={(e) => startResize(e, rect)}
                  />
                )}
              </div>
            );
          })}

        {pageAnnotations
          .filter((a): a is ImageAnnotation => a.type === "image")
          .map((img) => {
            const isSel = selectedId === img.id;
            return (
              <div
                key={img.id}
                className={`ann-image ${isSel ? "selected" : ""}`}
                style={{
                  left: `${img.x * 100}%`,
                  top: `${img.y * 100}%`,
                  width: `${img.width * 100}%`,
                  height: `${img.height * 100}%`,
                }}
                onPointerDown={(e) => startDrag(e, img)}
              >
                <img src={img.dataUrl} alt="" draggable={false} />
                {isSel && (
                  <div
                    className="resize-handle"
                    onPointerDown={(e) => startResize(e, img)}
                  />
                )}
              </div>
            );
          })}

        {draftRect && (
          <div
            className="ann-rect draft"
            style={{
              left: `${draftRect.x * 100}%`,
              top: `${draftRect.y * 100}%`,
              width: `${draftRect.w * 100}%`,
              height: `${draftRect.h * 100}%`,
              backgroundColor:
                activeTool === "highlight" || rectFilled ? toolColor : "transparent",
              border:
                activeTool === "highlight" || rectFilled
                  ? "none"
                  : `2px dashed ${toolColor}`,
              opacity: activeTool === "highlight" ? 0.35 : 0.85,
            }}
          />
        )}

        {pageAnnotations
          .filter((a): a is TextAnnotation => a.type === "text")
          .map((txt) => {
            const isSel = selectedId === txt.id;
            const isEditing = editingTextId === txt.id;
            return (
              <div
                key={txt.id}
                className={`ann-text ${isSel ? "selected" : ""}`}
                style={{
                  left: `${txt.x * 100}%`,
                  top: `${txt.y * 100}%`,
                  color: txt.color,
                  fontSize: `${txt.fontSize * zoom}px`,
                }}
                onPointerDown={(e) => {
                  if (isEditing) {
                    e.stopPropagation();
                    return;
                  }
                  if (activeTool === "text") {
                    e.stopPropagation();
                    onSelectAnnotation(txt.id);
                    setEditingTextId(txt.id);
                    return;
                  }
                  startDrag(e, txt);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onSelectAnnotation(txt.id);
                  setEditingTextId(txt.id);
                }}
              >
                {isEditing ? (
                  <textarea
                    autoFocus
                    placeholder="Type text..."
                    className="ann-textarea"
                    value={txt.text}
                    style={{
                      color: txt.color,
                      fontSize: `${txt.fontSize * zoom}px`,
                      backgroundColor: txt.bgColor || "rgba(255, 255, 255, 0.96)",
                      width: txt.replaceRect
                        ? `${Math.max(
                            txt.replaceRect.width * pageSize.width + 18,
                            txt.text.length * txt.fontSize * zoom * 0.62 + 24,
                          )}px`
                        : `${Math.max(120, txt.text.length * txt.fontSize * zoom * 0.62 + 28)}px`,
                      height: txt.replaceRect
                        ? `${Math.max(
                            txt.replaceRect.height * pageSize.height + 6,
                            txt.fontSize * zoom * 1.45,
                          )}px`
                        : `${Math.max(32, txt.fontSize * zoom * 1.5)}px`,
                    }}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) =>
                      onUpdateAnnotation(txt.id, { text: e.target.value })
                    }
                    onBlur={() => {
                      setEditingTextId(null);
                      if (!txt.text.trim()) {
                        onDeleteAnnotation(txt.id);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setEditingTextId(null);
                        if (!txt.text.trim()) {
                          onDeleteAnnotation(txt.id);
                        }
                      }
                    }}
                  />
                ) : (
                  <span className="ann-text-content">{txt.text}</span>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
};
