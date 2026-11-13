import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PageText, TextItem } from "./layout";

/**
 * Reads the text of a PDF with its position on the page. Only text is read: the
 * pages are never drawn and no image is decoded or kept.
 */
export async function extractPageTexts(bytes: Uint8Array): Promise<PageText[]> {
  const task = getDocument({
    data: bytes,
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: VerbosityLevel.ERRORS,
  });
  const document = await task.promise;
  try {
    const pages: PageText[] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items: TextItem[] = [];
      for (const item of content.items) {
        if (!("str" in item) || item.str.trim() === "") continue;
        const [a, b, c, d, x, y] = item.transform as number[];
        items.push({
          text: item.str,
          x: round(x),
          // PDF measures from the bottom of the page; offers are read top down.
          y: round(viewport.height - y),
          width: round(item.width),
          size: round(Math.hypot(c, d)),
          rotated: Math.abs(b) > 0.01 || a < 0,
        });
      }
      pages.push({ number, width: round(viewport.width), height: round(viewport.height), items });
      page.cleanup();
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

const round = (value: number) => Math.round(value * 10) / 10;
