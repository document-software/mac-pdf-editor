import React from "react";
import type { Annotation, PdfMetadata, ToolType } from "../types/pdf";

interface InspectorProps {
  activeTool: ToolType;
  selectedAnnotation: Annotation | null;
  toolColor: string;
  fontSize: number;
  strokeWidth: number;
  rectFilled: boolean;
  editableTextCount: number;
  metadata: PdfMetadata | null;
  onChangeColor: (color: string) => void;
  onChangeFontSize: (size: number) => void;
  onChangeStrokeWidth: (w: number) => void;
  onChangeRectFilled: (filled: boolean) => void;
  onRunOcr: () => void;
  isOcrRunning: boolean;
}

const PRESET_COLORS = [
  "#111827", // Black
  "#ef4444", // Red
  "#2563eb", // Blue
  "#16a34a", // Green
  "#facc15", // Yellow (highlight)
  "#ffffff", // White (whiteout)
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const Inspector: React.FC<InspectorProps> = ({
  activeTool,
  selectedAnnotation,
  toolColor,
  fontSize,
  strokeWidth,
  rectFilled,
  editableTextCount,
  metadata,
  onChangeColor,
  onChangeFontSize,
  onChangeStrokeWidth,
  onChangeRectFilled,
  onRunOcr,
  isOcrRunning,
}) => {
  const effectiveColor = selectedAnnotation ? selectedAnnotation.color : toolColor;
  const effectiveFontSize =
    selectedAnnotation && selectedAnnotation.type === "text"
      ? selectedAnnotation.fontSize
      : fontSize;
  const effectiveStroke =
    selectedAnnotation && selectedAnnotation.type === "draw"
      ? selectedAnnotation.strokeWidth
      : strokeWidth;

  return (
    <aside className="inspector">
      <div className="inspector-section">
        <h3>{selectedAnnotation ? "Selected Object" : "Tool Settings"}</h3>
        <div className="field">
          <label>Color</label>
          <div className="color-swatches">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                className={`swatch ${effectiveColor === c ? "active" : ""}`}
                style={{ backgroundColor: c }}
                onClick={() => onChangeColor(c)}
                title={c === "#ffffff" ? "White (Whiteout)" : c}
              />
            ))}
            <input
              type="color"
              value={effectiveColor}
              onChange={(e) => onChangeColor(e.target.value)}
              className="color-picker"
              title="Custom Color"
            />
          </div>
        </div>

        {(activeTool === "text" ||
          selectedAnnotation?.type === "text" ||
          (activeTool === "select" && !selectedAnnotation)) && (
          <div className="field">
            <label>Font Size: {effectiveFontSize}px</label>
            <input
              type="range"
              min={10}
              max={64}
              value={effectiveFontSize}
              onChange={(e) => onChangeFontSize(Number(e.target.value))}
            />
          </div>
        )}

        {(activeTool === "draw" ||
          selectedAnnotation?.type === "draw" ||
          (activeTool === "select" && !selectedAnnotation)) && (
          <div className="field">
            <label>Stroke Width: {effectiveStroke}px</label>
            <input
              type="range"
              min={1}
              max={14}
              value={effectiveStroke}
              onChange={(e) => onChangeStrokeWidth(Number(e.target.value))}
            />
          </div>
        )}

        {(activeTool === "rect" || selectedAnnotation?.type === "rect") && (
          <div className="field checkbox-field">
            <label>
              <input
                type="checkbox"
                checked={
                  selectedAnnotation?.type === "rect"
                    ? selectedAnnotation.filled
                    : rectFilled
                }
                onChange={(e) => onChangeRectFilled(e.target.checked)}
              />
              <span>Filled (useful for whiteout)</span>
            </label>
          </div>
        )}
      </div>

      <div className="inspector-section">
        <h3>Page Text Layer</h3>
        <div className="ocr-status-box">
          <p className="ocr-status-text">
            {editableTextCount > 0
              ? `${editableTextCount} editable text blocks detected on this page.`
              : "No embedded text layer found on this page (scanned/image PDF)."}
          </p>
          <button
            className="btn-ocr-full"
            onClick={onRunOcr}
            disabled={isOcrRunning}
          >
            {isOcrRunning ? "Recognizing text…" : "Run macOS Vision OCR"}
          </button>
        </div>
      </div>

      {metadata && (
        <div className="inspector-section">
          <h3>Document (Rust lopdf)</h3>
          <dl className="meta-list">
            <div>
              <dt>PDF Version</dt>
              <dd>{metadata.pdfVersion}</dd>
            </div>
            <div>
              <dt>File Size</dt>
              <dd>{formatBytes(metadata.fileSize)}</dd>
            </div>
            <div>
              <dt>Pages</dt>
              <dd>{metadata.pageCount}</dd>
            </div>
            {metadata.title && (
              <div>
                <dt>Title</dt>
                <dd>{metadata.title}</dd>
              </div>
            )}
            {metadata.author && (
              <div>
                <dt>Author</dt>
                <dd>{metadata.author}</dd>
              </div>
            )}
            {metadata.creator && (
              <div>
                <dt>Creator</dt>
                <dd>{metadata.creator}</dd>
              </div>
            )}
          </dl>
        </div>
      )}

      <div className="inspector-section hint-section">
        <h3>Shortcuts</h3>
        <ul className="shortcut-list">
          <li><span>⌘O</span> Open PDF</li>
          <li><span>⌘N</span> New Blank PDF</li>
          <li><span>⌘S</span> Save</li>
          <li><span>⌘Z / ⇧⌘Z</span> Undo / Redo</li>
          <li><span>V / T / H / R / D</span> Tools</li>
          <li><span>⌫</span> Delete Selected</li>
          <li><span>⌘+ / ⌘-</span> Zoom</li>
        </ul>
      </div>
    </aside>
  );
};
