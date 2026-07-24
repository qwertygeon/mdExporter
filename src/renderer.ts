import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import type { Renderer } from './types.js';

const DEFAULT_MARGIN = { top: '18mm', bottom: '18mm', left: '15mm', right: '15mm' };

/** 기본 렌더러 — HTML 은 파일 저장, PDF 는 Chromium 인쇄(HTML/PDF 단일 소스). */
export function createRenderer(): Renderer {
  return {
    async html(doc, outPath) {
      await writeFile(outPath, doc, 'utf8');
    },
    async pdf(doc, outPath, pdf) {
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        // networkidle: 웹폰트(Pretendard CDN) 로드 완료까지 대기
        await page.setContent(doc, { waitUntil: 'networkidle' });
        await page.pdf({
          path: outPath,
          format: pdf.format ?? 'A4',
          margin: pdf.margin ?? DEFAULT_MARGIN,
          printBackground: pdf.printBackground ?? true,
        });
      } finally {
        await browser.close();
      }
    },
  };
}
