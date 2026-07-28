import { writeFile } from 'node:fs/promises';
import { chromium, type Browser } from 'playwright';
import type { Renderer } from './types.js';

const DEFAULT_MARGIN = { top: '18mm', bottom: '18mm', left: '15mm', right: '15mm' };
// 폰트 디코드 대기 상한. fonts.ready 가 끝내 resolve 되지 않아도 인쇄가 무한 대기하지 않도록 한다.
const FONTS_READY_TIMEOUT_MS = 3000;

/**
 * 기본 렌더러 — HTML 은 파일 저장, PDF 는 Chromium 인쇄(HTML/PDF 단일 소스).
 * 브라우저는 최초 PDF 에서 lazy launch 후 재사용하며, dispose() 로 정리한다(일괄 변환 성능).
 * launchBrowser 는 테스트에서 주입 가능하다(기본: chromium.launch).
 */
export function createRenderer(
  launchBrowser: () => Promise<Browser> = () => chromium.launch(),
): Renderer {
  let browser: Browser | null = null;
  return {
    async html(doc, outPath) {
      await writeFile(outPath, doc, 'utf8');
    },
    async pdf(doc, outPath, pdf) {
      if (!browser) browser = await launchBrowser();
      const page = await browser.newPage();
      try {
        // networkidle: 원격 리소스(default-cdn.css 웹폰트·이미지 등) 로드 대기.
        // 임베딩 폰트(data-URI)는 네트워크 요청이 없어 networkidle 이 즉시 만족되므로
        // 디코드 완료까지 fonts.ready 로 별도 보강한다.
        await page.setContent(doc, { waitUntil: 'networkidle' });
        // 임베딩 폰트 디코드 완료를 기다리되 상한을 둔다(font-display: swap 이라 미완이어도 렌더 안전).
        // fonts.ready 는 로드 성공/실패 모두에서 resolve 되며, evaluate 실패는 보강용 best-effort 라 흡수.
        const fontsReady = page.evaluate(() => document.fonts.ready).catch(() => {});
        await Promise.race([
          fontsReady,
          new Promise<void>((resolve) => {
            setTimeout(resolve, FONTS_READY_TIMEOUT_MS).unref();
          }),
        ]);
        await page.pdf({
          path: outPath,
          format: pdf.format ?? 'A4',
          margin: pdf.margin ?? DEFAULT_MARGIN,
          printBackground: pdf.printBackground ?? true,
          displayHeaderFooter: pdf.displayHeaderFooter ?? false,
          ...(pdf.headerTemplate ? { headerTemplate: pdf.headerTemplate } : {}),
          ...(pdf.footerTemplate ? { footerTemplate: pdf.footerTemplate } : {}),
        });
      } finally {
        await page.close();
      }
    },
    async dispose() {
      if (browser) {
        await browser.close();
        browser = null;
      }
    },
  };
}
