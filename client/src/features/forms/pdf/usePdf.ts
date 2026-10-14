'use client';

// 讀取與繪製 PDF 頁面的 hooks（上傳編輯器、簽署時的文件檢視共用）
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useCallback, useEffect, useRef, useState } from 'react';
import { openPdf, renderPdfPage } from './pdfjs';

// 繪製寬度（px，以 2 倍解析度繪製讓畫面清晰）：縮圖 96px、頁面 460px
export const THUMB_RENDER_W = 192;
export const PAGE_RENDER_W = 920;

/** 從同源網址讀取 PDF；url 為 null 時不讀取。離開或換網址時釋放記憶體 */
export function usePdfDocument(url: string | null) {
  const [state, setState] = useState<{ url: string; doc: PDFDocumentProxy | null; error: boolean } | null>(null);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    let loaded: PDFDocumentProxy | null = null;
    openPdf(url)
      .then((doc) => {
        if (cancelled) return void doc.loadingTask.destroy();
        loaded = doc;
        setState({ url, doc, error: false });
      })
      .catch(() => !cancelled && setState({ url, doc: null, error: true }));
    return () => {
      cancelled = true;
      void loaded?.loadingTask.destroy();
    };
  }, [url]);

  // 網址改變後、新文件讀完前不沿用舊的結果
  const current = state && state.url === url ? state : null;
  return { doc: current?.doc ?? null, error: current?.error ?? false, loading: !!url && !current };
}

/**
 * 繪製 PDF 頁面：縮圖依序全部畫出；大圖在 requestPage 時才畫（已畫過就略過）。
 * doc 或 pageWidth（大圖繪製寬度）改變時重新開始，舊的結果不會混進來。
 */
export function usePdfRenders(doc: PDFDocumentProxy | null, pageWidth: number = PAGE_RENDER_W) {
  const [renders, setRenders] = useState<{
    doc: PDFDocumentProxy | null;
    thumbs: Record<number, string>;
    /** 大圖依繪製寬度分開保存（放大時改用較高解析度） */
    pages: Record<string, string>;
  }>({ doc: null, thumbs: {}, pages: {} });
  // 已要求繪製的大圖（依文件分開記錄，key 為「頁碼:寬度」）
  const requested = useRef(new WeakMap<PDFDocumentProxy, Set<string>>());

  const store = useCallback((target: PDFDocumentProxy, kind: 'thumbs' | 'pages', key: number | string, url: string) => {
    setRenders((prev) => {
      const base = prev.doc === target ? prev : { doc: target, thumbs: {}, pages: {} };
      return { ...base, [kind]: { ...base[kind], [key]: url } };
    });
  }, []);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    void (async () => {
      for (let p = 1; p <= doc.numPages && !cancelled; p++) {
        try {
          const url = await renderPdfPage(doc, p, THUMB_RENDER_W);
          if (!cancelled) store(doc, 'thumbs', p, url);
        } catch {
          // 單頁縮圖失敗時維持示意版面
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, store]);

  const requestPage = useCallback(
    (page: number) => {
      if (!doc || page < 1 || page > doc.numPages) return;
      const key = `${page}:${pageWidth}`;
      const done = requested.current.get(doc) ?? new Set<string>();
      requested.current.set(doc, done);
      if (done.has(key)) return;
      done.add(key);
      renderPdfPage(doc, page, pageWidth)
        .then((url) => store(doc, 'pages', key, url))
        .catch(() => done.delete(key));
    },
    [doc, pageWidth, store],
  );

  const current = renders.doc === doc ? renders : { thumbs: {}, pages: {} };
  const pages = current.pages as Record<string, string>;
  /** 指定頁的大圖：目前寬度還沒畫好時，先用已畫好的其他寬度，避免切換縮放時畫面空白 */
  const pageImage = (page: number): string | undefined =>
    pages[`${page}:${pageWidth}`] ?? Object.entries(pages).find(([k]) => k.startsWith(`${page}:`))?.[1];
  return { thumbs: current.thumbs as Record<number, string>, pageImage, requestPage };
}
