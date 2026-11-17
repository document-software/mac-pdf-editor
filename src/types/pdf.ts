export type ToolType = "select" | "text" | "highlight" | "rect" | "draw";

export interface PdfMetadata {
  pageCount: number;
  pdfVersion: string;
  fileSize: number;
  title: string | null;
  author: string | null;
  subject: string | null;
  creator: string | null;
}

export interface PageState {
  /** Unique ID for React keys & annotation mapping */
  id: string;
  /** 0-based page index in the current loaded PDF bytes */
  sourcePageIndex: number;
  /** Extra rotation in degrees (0, 90, 180, 270) */
  rotation: number;
}

export interface BaseAnnotation {
  id: string;
  pageId: string;
  color: string;
}

export interface TextAnnotation extends BaseAnnotation {
  type: "text";
  /** Normalized coordinates (0..1) relative to page width/height */
  x: number;
  y: number;
  text: string;
  fontSize: number;
  /** Optional area of original PDF text to cover before drawing replacement text */
  replaceRect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Sampled background color under the replaced text */
  bgColor?: string;
}

export interface RectAnnotation extends BaseAnnotation {
  type: "rect" | "highlight";
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  filled: boolean;
}

export interface DrawAnnotation extends BaseAnnotation {
  type: "draw";
  /** Normalized points (0..1) */
  points: Array<{ x: number; y: number }>;
  strokeWidth: number;
}

export interface ImageAnnotation extends BaseAnnotation {
  type: "image";
  x: number;
  y: number;
  width: number;
  height: number;
  dataUrl: string;
  mimeType: "image/png" | "image/jpeg";
}

export type Annotation =
  | TextAnnotation
  | RectAnnotation
  | DrawAnnotation
  | ImageAnnotation;
