import { useCallback, useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open, save } from "@tauri-apps/plugin-dialog";
import { FilePlus, FileUp, FolderOpen } from "lucide-react";

import { Toolbar } from "./components/Toolbar";
import { Sidebar } from "./components/Sidebar";
import { PdfPageCanvas, type OcrBlock } from "./components/PdfPageCanvas";
import { Inspector } from "./components/Inspector";
import type { Annotation, PageState, PdfMetadata, ToolType } from "./types/pdf";
import {
  buildEditedPdf,
  createBlankPdf,
  exportPageWithAnnotationsToPng,
  extractSinglePagePdf,
  mergePdfBytes,
} from "./utils/pdfExport";
import "./App.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

interface Snapshot {
  pages: PageState[];
  annotations: Annotation[];
}

export function App() {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [metadata, setMetadata] = useState<PdfMetadata | null>(null);

  const [pages, setPages] = useState<PageState[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  const [past, setPast] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);

  const [activeTool, setActiveTool] = useState<ToolType>("select");
  const [toolColor, setToolColor] = useState<string>("#111827");
  const [fontSize, setFontSize] = useState<number>(16);
  const [strokeWidth, setStrokeWidth] = useState<number>(3);
  const [rectFilled, setRectFilled] = useState<boolean>(false);
  const [zoom, setZoom] = useState<number>(1.2);

  const [showSidebar, setShowSidebar] = useState(true);
  const [showInspector, setShowInspector] = useState(true);
  const [ocrBlocksByPage, setOcrBlocksByPage] = useState<Record<string, OcrBlock[]>>({});
  const [isOcrRunning, setIsOcrRunning] = useState(false);
  const [editableTextCount, setEditableTextCount] = useState(0);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const saved = localStorage.getItem("mac_pdf_theme");
    return saved === "light" ? "light" : "dark";
  });
  const [toast, setToast] = useState<string | null>(null);

  const activeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const apiStateRef = useRef({
    filePath,
    pdfBytes,
    pdfDoc,
    metadata,
    pages,
    currentPage,
    annotations,
    zoom,
  });
  apiStateRef.current = {
    filePath,
    pdfBytes,
    pdfDoc,
    metadata,
    pages,
    currentPage,
    annotations,
    zoom,
  };

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  const pushHistory = useCallback((currPages: PageState[], currAnns: Annotation[]) => {
    setPast((prev) => [...prev.slice(-39), { pages: currPages, annotations: currAnns }]);
    setFuture([]);
  }, []);

  const handleUndo = useCallback(() => {
    setPast((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setFuture((f) => [{ pages, annotations }, ...f]);
      setPages(last.pages);
      setAnnotations(last.annotations);
      setCurrentPage((cp) => Math.max(0, Math.min(cp, last.pages.length - 1)));
      setSelectedId(null);
      setIsDirty(true);
      return prev.slice(0, -1);
    });
  }, [annotations, pages]);

  const handleRedo = useCallback(() => {
    setFuture((prev) => {
      if (prev.length === 0) return prev;
      const next = prev[0];
      setPast((p) => [...p, { pages, annotations }]);
      setPages(next.pages);
      setAnnotations(next.annotations);
      setCurrentPage((cp) => Math.max(0, Math.min(cp, next.pages.length - 1)));
      setSelectedId(null);
      setIsDirty(true);
      return prev.slice(1);
    });
  }, [annotations, pages]);

  const loadPdfFromBytes = useCallback(
    async (bytes: Uint8Array, path: string | null, resetState = true) => {
      try {
        const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
        const doc = await loadingTask.promise;

        setPdfBytes(bytes);
        setPdfDoc((prev) => {
          prev?.cleanup();
          return doc;
        });

        if (resetState) {
          const initialPages: PageState[] = Array.from(
            { length: doc.numPages },
            (_, i) => ({
              id: crypto.randomUUID(),
              sourcePageIndex: i,
              rotation: 0,
            }),
          );
          setPages(initialPages);
          setCurrentPage(0);
          setAnnotations([]);
          setOcrBlocksByPage({});
          setSelectedId(null);
          setPast([]);
          setFuture([]);
          setIsDirty(false);
        }

        if (path) {
          setFilePath(path);
          localStorage.setItem("mac_pdf_last_path", path);
          try {
            const info = await invoke<PdfMetadata>("get_pdf_info", { path });
            setMetadata(info);
          } catch {
            setMetadata(null);
          }
        } else {
          setFilePath(null);
          localStorage.removeItem("mac_pdf_last_path");
          setMetadata({
            pageCount: doc.numPages,
            pdfVersion: "1.7",
            fileSize: bytes.byteLength,
            title: "Новый документ",
            author: null,
            subject: null,
            creator: "Mac PDF Editor",
          });
        }
      } catch (err) {
        showToast(`Ошибка открытия PDF: ${String(err)}`);
      }
    },
    [showToast],
  );

  const handleNewBlank = useCallback(async () => {
    const blankBytes = await createBlankPdf(1);
    await loadPdfFromBytes(blankBytes, null, true);
    showToast("Создан новый пустой PDF (A4)");
  }, [loadPdfFromBytes, showToast]);

  const handleOpenFile = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "PDF Documents", extensions: ["pdf"] }],
    });
    if (!selected || typeof selected !== "string") return;

    try {
      const buffer = await invoke<ArrayBuffer>("read_pdf_bytes", {
        path: selected,
      });
      await loadPdfFromBytes(new Uint8Array(buffer), selected, true);
      showToast(`Открыт: ${baseName(selected)}`);
    } catch (err) {
      showToast(`Не удалось прочитать файл: ${String(err)}`);
    }
  }, [loadPdfFromBytes, showToast]);

  const saveToPath = useCallback(
    async (targetPath: string) => {
      if (!pdfBytes) return;
      try {
        const editedBytes = await buildEditedPdf(pdfBytes, pages, annotations);
        await invoke<number>("save_pdf_bytes", editedBytes, {
          headers: { "x-file-path": encodeURIComponent(targetPath) },
        });
        await loadPdfFromBytes(editedBytes, targetPath, true);
        showToast(`Сохранено: ${baseName(targetPath)}`);
      } catch (err) {
        showToast(`Ошибка сохранения: ${String(err)}`);
      }
    },
    [annotations, loadPdfFromBytes, pages, pdfBytes, showToast],
  );

  const handleSave = useCallback(async () => {
    if (!pdfBytes) return;
    if (filePath) {
      await saveToPath(filePath);
    } else {
      const target = await save({
        filters: [{ name: "PDF Documents", extensions: ["pdf"] }],
        defaultPath: "document.pdf",
      });
      if (target) await saveToPath(target);
    }
  }, [filePath, pdfBytes, saveToPath]);

  const handleSaveAs = useCallback(async () => {
    if (!pdfBytes) return;
    const target = await save({
      filters: [{ name: "PDF Documents", extensions: ["pdf"] }],
      defaultPath: filePath ? baseName(filePath) : "edited.pdf",
    });
    if (target) await saveToPath(target);
  }, [filePath, pdfBytes, saveToPath]);

  const handleMerge = useCallback(async () => {
    if (!pdfBytes) return;
    const selected = await open({
      multiple: true,
      filters: [{ name: "PDF Documents", extensions: ["pdf"] }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    if (paths.length === 0) return;

    try {
      const currentEdited = await buildEditedPdf(pdfBytes, pages, annotations);
      const extraList: Uint8Array[] = [];
      for (const p of paths) {
        const buf = await invoke<ArrayBuffer>("read_pdf_bytes", { path: p });
        extraList.push(new Uint8Array(buf));
      }
      const merged = await mergePdfBytes(currentEdited, extraList);
      await loadPdfFromBytes(merged, filePath, true);
      setIsDirty(true);
      showToast(`Объединено файлов: +${paths.length}`);
    } catch (err) {
      showToast(`Ошибка объединения: ${String(err)}`);
    }
  }, [annotations, filePath, loadPdfFromBytes, pages, pdfBytes, showToast]);

  const handleCompress = useCallback(async () => {
    if (!pdfBytes) return;
    const target = await save({
      filters: [{ name: "PDF Documents", extensions: ["pdf"] }],
      defaultPath: filePath
        ? baseName(filePath).replace(/\.pdf$/i, ".compressed.pdf")
        : "compressed.pdf",
    });
    if (!target) return;

    try {
      const currentBytes = await buildEditedPdf(pdfBytes, pages, annotations);
      const res = await invoke<{ originalSize: number; compressedSize: number }>(
        "compress_pdf_bytes",
        currentBytes,
        { headers: { "x-file-path": encodeURIComponent(target) } },
      );
      const ratio = Math.max(
        0,
        Math.round((1 - res.compressedSize / Math.max(1, res.originalSize)) * 100),
      );
      showToast(
        `Сжато на ${ratio}% (${(res.compressedSize / 1024).toFixed(1)} KB)`,
      );
    } catch (err) {
      showToast(`Ошибка сжатия: ${String(err)}`);
    }
  }, [annotations, filePath, pages, pdfBytes, showToast]);

  const handleExportPng = useCallback(async () => {
    const canvas = activeCanvasRef.current;
    const activePage = pages[currentPage];
    if (!canvas || !activePage) return;
    const target = await save({
      filters: [{ name: "PNG Image", extensions: ["png"] }],
      defaultPath: `page-${currentPage + 1}.png`,
    });
    if (!target) return;

    try {
      const pageAnns = annotations.filter((a) => a.pageId === activePage.id);
      const blob = await exportPageWithAnnotationsToPng(canvas, pageAnns, zoom);
      const buf = new Uint8Array(await blob.arrayBuffer());
      await invoke("save_pdf_bytes", buf, {
        headers: { "x-file-path": encodeURIComponent(target) },
      });
      showToast(`Страница ${currentPage + 1} экспортирована в PNG`);
    } catch (err) {
      showToast(`Ошибка экспорта PNG: ${String(err)}`);
    }
  }, [annotations, currentPage, pages, showToast, zoom]);

  const handleRunOcr = useCallback(async () => {
    const activePage = pages[currentPage];
    if (!pdfDoc || !activePage || isOcrRunning) return;
    setIsOcrRunning(true);
    showToast("Running macOS Vision OCR on current page...");

    try {
      const page = await pdfDoc.getPage(activePage.sourcePageIndex + 1);
      const viewport = page.getViewport({ scale: 2.0, rotation: activePage.rotation });
      const offCanvas = document.createElement("canvas");
      offCanvas.width = Math.floor(viewport.width);
      offCanvas.height = Math.floor(viewport.height);
      const ctx = offCanvas.getContext("2d");
      if (!ctx) throw new Error("2D context unavailable");

      await page.render({ canvas: offCanvas, canvasContext: ctx, viewport }).promise;
      const blob = await new Promise<Blob>((resolve, reject) => {
        offCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encode failed"))), "image/png");
      });
      const pngBytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
      const blocks = await invoke<OcrBlock[]>("ocr_page_png", { pngBytes });

      setOcrBlocksByPage((prev) => ({ ...prev, [activePage.id]: blocks }));
      setActiveTool("text");
      showToast(`OCR complete: ${blocks.length} editable text blocks found`);
    } catch (err) {
      showToast(`OCR failed: ${String(err)}`);
    } finally {
      setIsOcrRunning(false);
    }
  }, [currentPage, isOcrRunning, pages, pdfDoc, showToast]);

  const handleInsertImage = useCallback(async () => {
    const activePage = pages[currentPage];
    if (!activePage) return;

    const selected = await open({
      multiple: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg"] }],
    });
    if (!selected || typeof selected !== "string") return;

    try {
      const buffer = await invoke<ArrayBuffer>("read_pdf_bytes", {
        path: selected,
      });
      const isPng = selected.toLowerCase().endsWith(".png");
      const mimeType: "image/png" | "image/jpeg" = isPng ? "image/png" : "image/jpeg";
      const blob = new Blob([buffer], { type: mimeType });
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(blob);
      });

      const img = new Image();
      img.onload = () => {
        const aspect = img.width / Math.max(1, img.height);
        const normW = 0.28;
        const normH = Math.min(0.5, normW / aspect / 1.414);
        const id = crypto.randomUUID();
        pushHistory(pages, annotations);
        setAnnotations((prev) => [
          ...prev,
          {
            id,
            pageId: activePage.id,
            type: "image",
            x: 0.35,
            y: 0.35,
            width: normW,
            height: normH,
            color: "#000000",
            dataUrl,
            mimeType,
          },
        ]);
        setSelectedId(id);
        setActiveTool("select");
        setIsDirty(true);
        showToast("Изображение добавлено на страницу");
      };
      img.src = dataUrl;
    } catch (err) {
      showToast(`Ошибка вставки изображения: ${String(err)}`);
    }
  }, [annotations, currentPage, pages, pushHistory, showToast]);

  const handleSelectTool = useCallback(
    (tool: ToolType) => {
      setActiveTool(tool);
      if (tool === "highlight" && toolColor === "#111827") {
        setToolColor("#facc15");
      } else if (tool !== "highlight" && toolColor === "#facc15") {
        setToolColor("#111827");
      }
    },
    [toolColor],
  );

  const handleRotateCurrentPage = () => {
    pushHistory(pages, annotations);
    setPages((prev) =>
      prev.map((p, i) =>
        i === currentPage ? { ...p, rotation: (p.rotation + 90) % 360 } : p,
      ),
    );
    setIsDirty(true);
  };

  const handleMovePage = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= pages.length) return;
    pushHistory(pages, annotations);
    setPages((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    if (currentPage === index) setCurrentPage(target);
    else if (currentPage === target) setCurrentPage(index);
    setIsDirty(true);
  };

  const handleDuplicatePage = (index: number) => {
    pushHistory(pages, annotations);
    const orig = pages[index];
    const copy: PageState = { ...orig, id: crypto.randomUUID() };
    setPages((prev) => [
      ...prev.slice(0, index + 1),
      copy,
      ...prev.slice(index + 1),
    ]);
    setCurrentPage(index + 1);
    setIsDirty(true);
  };

  const handleExtractPage = async (index: number) => {
    if (!pdfBytes) return;
    const target = await save({
      filters: [{ name: "PDF Documents", extensions: ["pdf"] }],
      defaultPath: `page-${index + 1}.pdf`,
    });
    if (!target) return;
    try {
      const single = await extractSinglePagePdf(
        pdfBytes,
        pages[index],
        annotations,
      );
      await invoke("save_pdf_bytes", single, {
        headers: { "x-file-path": encodeURIComponent(target) },
      });
      showToast(`Страница ${index + 1} сохранена отдельно`);
    } catch (err) {
      showToast(`Ошибка извлечения: ${String(err)}`);
    }
  };

  const handleDeletePage = (index: number) => {
    if (pages.length <= 1) return;
    pushHistory(pages, annotations);
    const removedId = pages[index].id;
    setPages((prev) => prev.filter((_, i) => i !== index));
    setAnnotations((prev) => prev.filter((a) => a.pageId !== removedId));
    setCurrentPage((prev) => Math.max(0, Math.min(prev, pages.length - 2)));
    setIsDirty(true);
  };

  const handleDeleteSelectedAnnotation = useCallback(() => {
    if (!selectedId) return;
    pushHistory(pages, annotations);
    setAnnotations((prev) => prev.filter((a) => a.id !== selectedId));
    setSelectedId(null);
    setIsDirty(true);
  }, [annotations, pages, pushHistory, selectedId]);

  const selectedAnnotation =
    annotations.find((a) => a.id === selectedId) || null;

  const handleInspectorColorChange = (color: string) => {
    setToolColor(color);
    if (selectedId) {
      pushHistory(pages, annotations);
      setAnnotations((prev) =>
        prev.map((a) => (a.id === selectedId ? { ...a, color } : a)),
      );
      setIsDirty(true);
    }
  };

  const handleInspectorFontSizeChange = (size: number) => {
    setFontSize(size);
    if (selectedId && selectedAnnotation?.type === "text") {
      setAnnotations((prev) =>
        prev.map((a) =>
          a.id === selectedId && a.type === "text" ? { ...a, fontSize: size } : a,
        ),
      );
      setIsDirty(true);
    }
  };

  const handleInspectorStrokeChange = (w: number) => {
    setStrokeWidth(w);
    if (selectedId && selectedAnnotation?.type === "draw") {
      setAnnotations((prev) =>
        prev.map((a) =>
          a.id === selectedId && a.type === "draw" ? { ...a, strokeWidth: w } : a,
        ),
      );
      setIsDirty(true);
    }
  };

  const handleInspectorRectFilledChange = (filled: boolean) => {
    setRectFilled(filled);
    if (selectedId && selectedAnnotation?.type === "rect") {
      pushHistory(pages, annotations);
      setAnnotations((prev) =>
        prev.map((a) =>
          a.id === selectedId && a.type === "rect" ? { ...a, filled } : a,
        ),
      );
      setIsDirty(true);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "TEXTAREA" || target?.tagName === "INPUT";

      if ((isMeta && e.key.toLowerCase() === "r") || e.key === "F5") {
        e.preventDefault();
      } else if (isMeta && e.key.toLowerCase() === "o") {
        e.preventDefault();
        handleOpenFile();
      } else if (isMeta && e.key.toLowerCase() === "n") {
        e.preventDefault();
        handleNewBlank();
      } else if (isMeta && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSaveAs();
      } else if (isMeta && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSave();
      } else if (isMeta && e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        handleRedo();
      } else if (isMeta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        handleUndo();
      } else if (isMeta && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        setZoom((z) => Math.min(3, +(z + 0.15).toFixed(2)));
      } else if (isMeta && e.key === "-") {
        e.preventDefault();
        setZoom((z) => Math.max(0.4, +(z - 0.15).toFixed(2)));
      } else if (!isTyping && !isMeta) {
        const k = e.key.toLowerCase();
        if (k === "v") handleSelectTool("select");
        else if (k === "t") handleSelectTool("text");
        else if (k === "h") handleSelectTool("highlight");
        else if (k === "r") handleSelectTool("rect");
        else if (k === "d") handleSelectTool("draw");
        else if ((e.key === "Backspace" || e.key === "Delete") && selectedId) {
          e.preventDefault();
          handleDeleteSelectedAnnotation();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    handleDeleteSelectedAnnotation,
    handleNewBlank,
    handleOpenFile,
    handleRedo,
    handleSave,
    handleSaveAs,
    handleSelectTool,
    handleUndo,
    selectedId,
  ]);

  // Persist theme and restore last opened PDF after reload/relaunch
  useEffect(() => {
    localStorage.setItem("mac_pdf_theme", theme);
  }, [theme]);

  useEffect(() => {
    const lastPath = localStorage.getItem("mac_pdf_last_path");
    if (!lastPath) return;
    invoke<ArrayBuffer>("read_pdf_bytes", { path: lastPath })
      .then((buf) => loadPdfFromBytes(new Uint8Array(buf), lastPath, true))
      .catch(() => {
        localStorage.removeItem("mac_pdf_last_path");
      });
    // Run only once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Control API bridge from Rust HTTP Server (127.0.0.1:4890)
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    listen<{ reqId: string; action: string; payload: Record<string, unknown> }>(
      "api-command",
      async (event) => {
        const { reqId, action, payload } = event.payload;
        const reply = (result: unknown) =>
          invoke("api_reply", { reqId, result }).catch(() => {});

        try {
          const st = apiStateRef.current;

          if (action === "get_state") {
            await reply({
              ok: true,
              filePath: st.filePath,
              pageCount: st.pages.length,
              currentPage: st.currentPage,
              annotationsCount: st.annotations.length,
              zoom: st.zoom,
              metadata: st.metadata,
            });
            return;
          }

          if (action === "open") {
            const p = String(payload.path || "");
            const buf = await invoke<ArrayBuffer>("read_pdf_bytes", { path: p });
            await loadPdfFromBytes(new Uint8Array(buf), p, true);
            await reply({ ok: true, filePath: p });
            return;
          }

          if (action === "new_blank") {
            const count = Number(payload.pageCount || 1);
            const blank = await createBlankPdf(count);
            await loadPdfFromBytes(blank, null, true);
            await reply({ ok: true, pageCount: count });
            return;
          }

          if (action === "page_select") {
            const idx = Math.max(0, Math.min(st.pages.length - 1, Number(payload.index || 0)));
            setCurrentPage(idx);
            await reply({ ok: true, currentPage: idx });
            return;
          }

          if (action === "page_rotate") {
            const idx = payload.index !== undefined ? Number(payload.index) : st.currentPage;
            const deg = Number(payload.degrees || 90);
            setPages((prev) =>
              prev.map((p, i) => (i === idx ? { ...p, rotation: (p.rotation + deg) % 360 } : p)),
            );
            setIsDirty(true);
            await reply({ ok: true, index: idx, addedDegrees: deg });
            return;
          }

          if (action === "page_duplicate") {
            const idx = payload.index !== undefined ? Number(payload.index) : st.currentPage;
            const orig = st.pages[idx];
            if (!orig) throw new Error("Invalid page index");
            const copy: PageState = { ...orig, id: crypto.randomUUID() };
            setPages((prev) => [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)]);
            setIsDirty(true);
            await reply({ ok: true, newPageId: copy.id });
            return;
          }

          if (action === "page_delete") {
            const idx = Number(payload.index);
            if (st.pages.length <= 1) throw new Error("Cannot delete last page");
            const removed = st.pages[idx];
            if (!removed) throw new Error("Invalid page index");
            setPages((prev) => prev.filter((_, i) => i !== idx));
            setAnnotations((prev) => prev.filter((a) => a.pageId !== removed.id));
            setCurrentPage((cp) => Math.max(0, Math.min(cp, st.pages.length - 2)));
            setIsDirty(true);
            await reply({ ok: true, deletedIndex: idx });
            return;
          }

          if (action === "annotation_add") {
            const targetIdx = payload.pageIndex !== undefined ? Number(payload.pageIndex) : st.currentPage;
            const targetPage = st.pages[targetIdx];
            if (!targetPage) throw new Error("Page not found");
            const rawAnn = (payload.annotation || payload) as Record<string, unknown>;
            const ann = {
              ...rawAnn,
              id: String(rawAnn.id || crypto.randomUUID()),
              pageId: targetPage.id,
            } as Annotation;
            setAnnotations((prev) => [...prev, ann]);
            setIsDirty(true);
            await reply({ ok: true, id: ann.id, pageId: targetPage.id });
            return;
          }

          if (action === "annotation_clear") {
            setAnnotations([]);
            setIsDirty(true);
            await reply({ ok: true });
            return;
          }

          if (action === "extract_text") {
            if (!st.pdfDoc) throw new Error("No PDF loaded");
            const out: Array<{ page: number; text: string }> = [];
            const targetPage = payload.pageIndex !== undefined ? Number(payload.pageIndex) : null;
            for (let i = 0; i < st.pages.length; i++) {
              if (targetPage !== null && i !== targetPage) continue;
              const page = await st.pdfDoc.getPage(st.pages[i].sourcePageIndex + 1);
              const content = await page.getTextContent();
              const text = content.items
                .map((it) => ("str" in it ? it.str : ""))
                .join(" ")
                .replace(/\s+/g, " ")
                .trim();
              out.push({ page: i + 1, text });
            }
            await reply({ ok: true, pages: out });
            return;
          }

          if (action === "search_text") {
            if (!st.pdfDoc) throw new Error("No PDF loaded");
            const q = String(payload.query || "").toLowerCase();
            const matches: Array<{ page: number; str: string }> = [];
            for (let i = 0; i < st.pages.length; i++) {
              const page = await st.pdfDoc.getPage(st.pages[i].sourcePageIndex + 1);
              const content = await page.getTextContent();
              for (const it of content.items) {
                if ("str" in it && it.str.toLowerCase().includes(q)) {
                  matches.push({ page: i + 1, str: it.str });
                }
              }
            }
            await reply({ ok: true, query: q, count: matches.length, matches: matches.slice(0, 50) });
            return;
          }

          if (action === "save") {
            if (!st.pdfBytes) throw new Error("No PDF loaded");
            const outPath = String(payload.path || st.filePath || "");
            if (!outPath) throw new Error("No output path");
            const edited = await buildEditedPdf(st.pdfBytes, st.pages, st.annotations);
            const bytesWritten = await invoke<number>("save_pdf_bytes", edited, {
              headers: { "x-file-path": encodeURIComponent(outPath) },
            });
            await reply({ ok: true, path: outPath, size: bytesWritten });
            return;
          }

          if (action === "compress") {
            if (!st.pdfBytes) throw new Error("No PDF loaded");
            const outPath = String(payload.outputPath || "");
            if (!outPath) throw new Error("No outputPath");
            const edited = await buildEditedPdf(st.pdfBytes, st.pages, st.annotations);
            const res = await invoke<{ originalSize: number; compressedSize: number }>(
              "compress_pdf_bytes",
              edited,
              { headers: { "x-file-path": encodeURIComponent(outPath) } },
            );
            await reply({ ok: true, ...res });
            return;
          }

          if (action === "export_png") {
            const activePage = st.pages[st.currentPage];
            const outPath = String(payload.path || "");
            if (!st.pdfDoc || !activePage || !outPath) throw new Error("Document or path missing");

            const page = await st.pdfDoc.getPage(activePage.sourcePageIndex + 1);
            const viewport = page.getViewport({ scale: st.zoom, rotation: activePage.rotation });
            const dpr = window.devicePixelRatio || 1;
            const canvas = document.createElement("canvas");
            canvas.width = Math.floor(viewport.width * dpr);
            canvas.height = Math.floor(viewport.height * dpr);
            const ctx = canvas.getContext("2d");
            if (!ctx) throw new Error("2D context unavailable");
            await page.render({
              canvas,
              canvasContext: ctx,
              viewport,
              transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
            }).promise;

            const pageAnns = st.annotations.filter((a) => a.pageId === activePage.id);
            const blob = await exportPageWithAnnotationsToPng(canvas, pageAnns, st.zoom);
            const buf = new Uint8Array(await blob.arrayBuffer());
            await invoke("save_pdf_bytes", buf, {
              headers: { "x-file-path": encodeURIComponent(outPath) },
            });
            await reply({ ok: true, path: outPath, size: buf.byteLength });
            return;
          }

          await reply({ ok: false, error: `Unknown action: ${action}` });
        } catch (err) {
          await reply({ ok: false, error: String(err) });
        }
      },
    ).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [loadPdfFromBytes]);

  // Native Tauri v2 Drag & Drop support
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    getCurrentWebview()
      .onDragDropEvent(async (event) => {
        if (event.payload.type === "drop") {
          const pdfPath = event.payload.paths.find((p) =>
            p.toLowerCase().endsWith(".pdf"),
          );
          if (!pdfPath) return;
          try {
            const buffer = await invoke<ArrayBuffer>("read_pdf_bytes", {
              path: pdfPath,
            });
            await loadPdfFromBytes(new Uint8Array(buffer), pdfPath, true);
            showToast(`Открыт: ${baseName(pdfPath)}`);
          } catch (err) {
            showToast(`Ошибка открытия файла: ${String(err)}`);
          }
        }
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {
        // Fallback for non-Tauri browser preview
      });

    return () => {
      unlisten?.();
    };
  }, [loadPdfFromBytes, showToast]);

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.name.toLowerCase().endsWith(".pdf")) return;
    const buf = new Uint8Array(await file.arrayBuffer());
    await loadPdfFromBytes(buf, null, true);
    showToast(`Открыт: ${file.name}`);
  };

  const activePageState = pages[currentPage] || null;

  return (
    <div
      className="app-shell"
      data-theme={theme}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      onContextMenu={(e) => {
        const target = e.target as HTMLElement | null;
        if (target?.tagName === "TEXTAREA" || target?.tagName === "INPUT") return;
        e.preventDefault();
      }}
    >
      <Toolbar
        hasDoc={Boolean(pdfDoc)}
        fileName={filePath ? baseName(filePath) : pdfDoc ? "Untitled.pdf" : null}
        isDirty={isDirty}
        activeTool={activeTool}
        zoom={zoom}
        currentPage={currentPage}
        totalPages={pages.length}
        hasSelection={Boolean(selectedId)}
        canUndo={past.length > 0}
        canRedo={future.length > 0}
        isOcrRunning={isOcrRunning}
        showSidebar={showSidebar}
        showInspector={showInspector}
        theme={theme}
        onNewBlank={handleNewBlank}
        onOpen={handleOpenFile}
        onSave={handleSave}
        onSaveAs={handleSaveAs}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onMerge={handleMerge}
        onCompress={handleCompress}
        onExportPng={handleExportPng}
        onRunOcr={handleRunOcr}
        onInsertImage={handleInsertImage}
        onSelectTool={handleSelectTool}
        onPrevPage={() => setCurrentPage((p) => Math.max(0, p - 1))}
        onNextPage={() => setCurrentPage((p) => Math.min(pages.length - 1, p + 1))}
        onZoomIn={() => setZoom((z) => Math.min(3, +(z + 0.15).toFixed(2)))}
        onZoomOut={() => setZoom((z) => Math.max(0.4, +(z - 0.15).toFixed(2)))}
        onZoomReset={() => setZoom(1.0)}
        onRotatePage={handleRotateCurrentPage}
        onDeleteSelected={handleDeleteSelectedAnnotation}
        onToggleSidebar={() => setShowSidebar((s) => !s)}
        onToggleInspector={() => setShowInspector((s) => !s)}
        onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
      />

      <main className="workspace">
        {pdfDoc && showSidebar && (
          <Sidebar
            pdfDoc={pdfDoc}
            pages={pages}
            currentPage={currentPage}
            onSelectPage={(idx) => {
              setCurrentPage(idx);
              setSelectedId(null);
            }}
            onMovePage={handleMovePage}
            onDuplicatePage={handleDuplicatePage}
            onExtractPage={handleExtractPage}
            onDeletePage={handleDeletePage}
          />
        )}

        <section className="canvas-viewport">
          {!pdfDoc || !activePageState ? (
            <div className="empty-state">
              <div className="empty-card">
                <FileUp size={44} strokeWidth={1.5} />
                <h2>Mac PDF Editor</h2>
                <p>
                  Drop a PDF file here or choose an action below
                </p>
                <div className="empty-actions">
                  <button className="btn-hero primary" onClick={handleOpenFile}>
                    <FolderOpen size={16} />
                    <span>Open PDF</span>
                  </button>
                  <button className="btn-hero" onClick={handleNewBlank}>
                    <FilePlus size={16} />
                    <span>New Blank PDF</span>
                  </button>
                </div>
                <span className="empty-hint">
                  Rust (Tauri + lopdf) • PDF.js • pdf-lib
                </span>
              </div>
            </div>
          ) : (
            <div className="canvas-scroll">
              <PdfPageCanvas
                pdfDoc={pdfDoc}
                pageState={activePageState}
                zoom={zoom}
                activeTool={activeTool}
                toolColor={toolColor}
                fontSize={fontSize}
                strokeWidth={strokeWidth}
                rectFilled={rectFilled}
                annotations={annotations}
                ocrBlocks={ocrBlocksByPage[activePageState.id] || []}
                selectedId={selectedId}
                onSelectAnnotation={setSelectedId}
                onAddAnnotation={(ann) => {
                  pushHistory(pages, annotations);
                  setAnnotations((prev) => [...prev, ann]);
                  setIsDirty(true);
                }}
                onUpdateAnnotation={(id, patch) => {
                  setAnnotations((prev) =>
                    prev.map((a) =>
                      a.id === id ? ({ ...a, ...patch } as Annotation) : a,
                    ),
                  );
                  setIsDirty(true);
                }}
                onDeleteAnnotation={(id) => {
                  setAnnotations((prev) => prev.filter((a) => a.id !== id));
                  setSelectedId((sel) => (sel === id ? null : sel));
                }}
                onCanvasReady={(c) => {
                  activeCanvasRef.current = c;
                }}
                onTextBlocksCountChange={setEditableTextCount}
              />
            </div>
          )}
        </section>

        {pdfDoc && showInspector && (
          <Inspector
            activeTool={activeTool}
            selectedAnnotation={selectedAnnotation}
            toolColor={toolColor}
            fontSize={fontSize}
            strokeWidth={strokeWidth}
            rectFilled={rectFilled}
            editableTextCount={editableTextCount}
            metadata={metadata}
            onChangeColor={handleInspectorColorChange}
            onChangeFontSize={handleInspectorFontSizeChange}
            onChangeStrokeWidth={handleInspectorStrokeChange}
            onChangeRectFilled={handleInspectorRectFilledChange}
            onRunOcr={handleRunOcr}
            isOcrRunning={isOcrRunning}
          />
        )}
      </main>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export default App;
