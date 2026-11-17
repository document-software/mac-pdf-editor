import React, { useEffect, useRef } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ArrowDown, ArrowUp, Copy, FileOutput, Trash2 } from "lucide-react";
import type { PageState } from "../types/pdf";

interface ThumbnailProps {
  pdfDoc: PDFDocumentProxy;
  pageState: PageState;
  index: number;
  total: number;
  isActive: boolean;
  onSelect: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDuplicate: () => void;
  onExtract: () => void;
  onDelete: () => void;
}

const ThumbnailItem: React.FC<ThumbnailProps> = ({
  pdfDoc,
  pageState,
  index,
  total,
  isActive,
  onSelect,
  onMoveUp,
  onMoveDown,
  onDuplicate,
  onExtract,
  onDelete,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel: () => void } | null = null;

    async function renderThumb() {
      const page = await pdfDoc.getPage(pageState.sourcePageIndex + 1);
      if (cancelled || !canvasRef.current) return;

      const baseViewport = page.getViewport({ scale: 1, rotation: pageState.rotation });
      const targetWidth = 136;
      const scale = targetWidth / baseViewport.width;
      const viewport = page.getViewport({ scale, rotation: pageState.rotation });

      const canvas = canvasRef.current;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;

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
      } catch {
        // Cancelled on re-render
      }
    }

    renderThumb();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pdfDoc, pageState.sourcePageIndex, pageState.rotation]);

  return (
    <div
      className={`thumb-card ${isActive ? "active" : ""}`}
      onClick={onSelect}
    >
      <div className="thumb-canvas-wrap">
        <canvas ref={canvasRef} />
      </div>
      <div className="thumb-footer">
        <span className="thumb-num">{index + 1}</span>
        <div className="thumb-actions" onClick={(e) => e.stopPropagation()}>
          <button
            className="mini-btn"
            onClick={onMoveUp}
            disabled={index === 0}
            title="Move Up"
          >
            <ArrowUp size={12} />
          </button>
          <button
            className="mini-btn"
            onClick={onMoveDown}
            disabled={index === total - 1}
            title="Move Down"
          >
            <ArrowDown size={12} />
          </button>
          <button
            className="mini-btn"
            onClick={onDuplicate}
            title="Duplicate Page"
          >
            <Copy size={12} />
          </button>
          <button
            className="mini-btn"
            onClick={onExtract}
            title="Extract as Single PDF"
          >
            <FileOutput size={12} />
          </button>
          <button
            className="mini-btn danger"
            onClick={onDelete}
            disabled={total <= 1}
            title="Delete Page"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
};

interface SidebarProps {
  pdfDoc: PDFDocumentProxy;
  pages: PageState[];
  currentPage: number;
  onSelectPage: (index: number) => void;
  onMovePage: (index: number, delta: -1 | 1) => void;
  onDuplicatePage: (index: number) => void;
  onExtractPage: (index: number) => void;
  onDeletePage: (index: number) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  pdfDoc,
  pages,
  currentPage,
  onSelectPage,
  onMovePage,
  onDuplicatePage,
  onExtractPage,
  onDeletePage,
}) => {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span>Pages</span>
        <span className="muted">{pages.length}</span>
      </div>
      <div className="thumb-list">
        {pages.map((p, idx) => (
          <ThumbnailItem
            key={p.id}
            pdfDoc={pdfDoc}
            pageState={p}
            index={idx}
            total={pages.length}
            isActive={idx === currentPage}
            onSelect={() => onSelectPage(idx)}
            onMoveUp={() => onMovePage(idx, -1)}
            onMoveDown={() => onMovePage(idx, 1)}
            onDuplicate={() => onDuplicatePage(idx)}
            onExtract={() => onExtractPage(idx)}
            onDelete={() => onDeletePage(idx)}
          />
        ))}
      </div>
    </aside>
  );
};
