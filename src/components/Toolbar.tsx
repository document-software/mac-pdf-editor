import React from "react";
import {
  ChevronLeft,
  ChevronRight,
  FilePlus,
  FilePlus2,
  FolderOpen,
  Highlighter,
  ImageDown,
  ImagePlus,
  Minimize2,
  Moon,
  MousePointer2,
  PanelLeft,
  PanelRight,
  PenTool,
  Redo2,
  RotateCw,
  Save,
  SaveAll,
  ScanText,
  Square,
  Sun,
  Trash2,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { ToolType } from "../types/pdf";

interface ToolbarProps {
  hasDoc: boolean;
  fileName: string | null;
  isDirty: boolean;
  activeTool: ToolType;
  zoom: number;
  currentPage: number;
  totalPages: number;
  hasSelection: boolean;
  canUndo: boolean;
  canRedo: boolean;
  isOcrRunning: boolean;
  showSidebar: boolean;
  showInspector: boolean;
  theme: "dark" | "light";
  onNewBlank: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onMerge: () => void;
  onCompress: () => void;
  onExportPng: () => void;
  onRunOcr: () => void;
  onInsertImage: () => void;
  onSelectTool: (tool: ToolType) => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onRotatePage: () => void;
  onDeleteSelected: () => void;
  onToggleSidebar: () => void;
  onToggleInspector: () => void;
  onToggleTheme: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  hasDoc,
  fileName,
  isDirty,
  activeTool,
  zoom,
  currentPage,
  totalPages,
  hasSelection,
  canUndo,
  canRedo,
  isOcrRunning,
  showSidebar,
  showInspector,
  theme,
  onNewBlank,
  onOpen,
  onSave,
  onSaveAs,
  onUndo,
  onRedo,
  onMerge,
  onCompress,
  onExportPng,
  onRunOcr,
  onInsertImage,
  onSelectTool,
  onPrevPage,
  onNextPage,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onRotatePage,
  onDeleteSelected,
  onToggleSidebar,
  onToggleInspector,
  onToggleTheme,
}) => {
  const tools: Array<{ id: ToolType; label: string; icon: React.ReactNode }> = [
    { id: "select", label: "Select (V)", icon: <MousePointer2 size={16} /> },
    { id: "text", label: "Edit / Add Text (T)", icon: <Type size={16} /> },
    { id: "highlight", label: "Highlight (H)", icon: <Highlighter size={16} /> },
    { id: "rect", label: "Rectangle / Whiteout (R)", icon: <Square size={16} /> },
    { id: "draw", label: "Draw / Signature (D)", icon: <PenTool size={16} /> },
  ];

  return (
    <header className="toolbar">
      <div className="toolbar-group">
        <button
          className={`icon-btn ${showSidebar ? "active" : ""}`}
          onClick={onToggleSidebar}
          title="Toggle Pages Sidebar"
          disabled={!hasDoc}
        >
          <PanelLeft size={16} />
        </button>

        <button className="btn-primary-soft" onClick={onOpen} title="Open PDF (⌘O)">
          <FolderOpen size={15} />
          <span>Open</span>
        </button>

        <button
          className="icon-btn"
          onClick={onNewBlank}
          title="New Blank PDF (⌘N)"
        >
          <FilePlus size={16} />
        </button>

        <button
          className="icon-btn"
          onClick={onSave}
          disabled={!hasDoc}
          title="Save (⌘S)"
        >
          <Save size={16} />
        </button>

        <button
          className="icon-btn"
          onClick={onSaveAs}
          disabled={!hasDoc}
          title="Save As… (⇧⌘S)"
        >
          <SaveAll size={16} />
        </button>

        <div className="divider" />

        <button
          className="icon-btn"
          onClick={onUndo}
          disabled={!hasDoc || !canUndo}
          title="Undo (⌘Z)"
        >
          <Undo2 size={16} />
        </button>

        <button
          className="icon-btn"
          onClick={onRedo}
          disabled={!hasDoc || !canRedo}
          title="Redo (⇧⌘Z)"
        >
          <Redo2 size={16} />
        </button>

        <div className="divider" />

        <button
          className="icon-btn"
          onClick={onMerge}
          disabled={!hasDoc}
          title="Merge with another PDF"
        >
          <FilePlus2 size={16} />
        </button>

        <button
          className="icon-btn"
          onClick={onCompress}
          disabled={!hasDoc}
          title="Compress PDF (Rust lopdf)"
        >
          <Minimize2 size={16} />
        </button>

        <button
          className="icon-btn"
          onClick={onExportPng}
          disabled={!hasDoc}
          title="Export Current Page as PNG"
        >
          <ImageDown size={16} />
        </button>
      </div>

      <div className="toolbar-group toolbar-center">
        {tools.map((t) => (
          <button
            key={t.id}
            className={`tool-btn ${activeTool === t.id ? "active" : ""}`}
            onClick={() => onSelectTool(t.id)}
            disabled={!hasDoc}
            title={t.label}
          >
            {t.icon}
          </button>
        ))}

        <button
          className="icon-btn"
          onClick={onInsertImage}
          disabled={!hasDoc}
          title="Insert Image / Signature (PNG, JPG)"
        >
          <ImagePlus size={16} />
        </button>

        <button
          className={`btn-soft-compact ${isOcrRunning ? "active" : ""}`}
          onClick={onRunOcr}
          disabled={!hasDoc || isOcrRunning}
          title="Recognize Scanned Text (macOS Vision OCR)"
        >
          <ScanText size={14} />
          <span>{isOcrRunning ? "OCR…" : "OCR"}</span>
        </button>

        <div className="divider" />

        <button
          className="btn-soft-compact"
          onClick={onRotatePage}
          disabled={!hasDoc}
          title="Rotate Current Page 90°"
        >
          <RotateCw size={14} />
          <span>90°</span>
        </button>

        <button
          className="icon-btn danger"
          onClick={onDeleteSelected}
          disabled={!hasDoc || !hasSelection}
          title="Delete Selected Element (⌫)"
        >
          <Trash2 size={16} />
        </button>
      </div>

      <div className="toolbar-group">
        {hasDoc && (
          <div className="page-nav">
            <button
              className="icon-btn"
              onClick={onPrevPage}
              disabled={currentPage <= 0}
              title="Previous Page"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="doc-badge" title={fileName || ""}>
              <span className="doc-name">
                {fileName}
                {isDirty ? " •" : ""}
              </span>
              <span className="page-counter">
                {currentPage + 1}/{totalPages}
              </span>
            </span>
            <button
              className="icon-btn"
              onClick={onNextPage}
              disabled={currentPage >= totalPages - 1}
              title="Next Page"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        )}

        <div className="zoom-controls">
          <button
            className="icon-btn"
            onClick={onZoomOut}
            disabled={!hasDoc}
            title="Zoom Out (⌘-)"
          >
            <ZoomOut size={15} />
          </button>
          <button
            className="zoom-label"
            onClick={onZoomReset}
            disabled={!hasDoc}
            title="Reset Zoom (100%)"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            className="icon-btn"
            onClick={onZoomIn}
            disabled={!hasDoc}
            title="Zoom In (⌘+)"
          >
            <ZoomIn size={15} />
          </button>
        </div>

        <button
          className="icon-btn"
          onClick={onToggleTheme}
          title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
        >
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        <button
          className={`icon-btn ${showInspector ? "active" : ""}`}
          onClick={onToggleInspector}
          title="Toggle Inspector"
          disabled={!hasDoc}
        >
          <PanelRight size={16} />
        </button>
      </div>
    </header>
  );
};
