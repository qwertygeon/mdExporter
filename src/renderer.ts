import { writeFile } from 'node:fs/promises';
import { chromium, type Browser, type Page } from 'playwright';
import type { DiagramRenderRequest, DiagramRenderResult, Renderer } from './types.js';

const DEFAULT_MARGIN = { top: '18mm', bottom: '18mm', left: '15mm', right: '15mm' };
// 폰트 디코드 대기 상한. fonts.ready 가 끝내 resolve 되지 않아도 인쇄가 무한 대기하지 않도록 한다.
const FONTS_READY_TIMEOUT_MS = 3000;

/**
 * 임베딩 폰트 디코드 완료를 기다리되 상한을 둔다(font-display: swap 이라 미완이어도 렌더 안전).
 * fonts.ready 는 로드 성공/실패 모두에서 resolve 되며, evaluate 실패는 보강용 best-effort 라 흡수.
 */
async function waitForFonts(page: Page): Promise<void> {
  const fontsReady = page.evaluate(() => document.fonts.ready).catch(() => {});
  await Promise.race([
    fontsReady,
    new Promise<void>((resolve) => {
      setTimeout(resolve, FONTS_READY_TIMEOUT_MS).unref();
    }),
  ]);
}

/**
 * 기본 렌더러 — HTML 은 파일 저장, PDF 는 Chromium 인쇄(HTML/PDF 단일 소스).
 * 브라우저는 최초 사용 시 lazy launch 후 재사용하며, dispose() 로 정리한다(일괄 변환 성능).
 * 다이어그램 렌더도 같은 브라우저를 쓴다.
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
        await waitForFonts(page);
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
    async renderDiagrams(request: DiagramRenderRequest): Promise<DiagramRenderResult> {
      const svgs: Array<string | undefined> = request.sources.map(() => undefined);
      const failures: DiagramRenderResult['failures'] = [];
      if (request.sources.length === 0) return { svgs, failures };

      // 브라우저 기동·페이지 준비 실패는 문서 변환 전체를 실패시키지 않는다 — 다이어그램만 포기하고
      // 사유를 돌려준다(개별 다이어그램 실패는 아래 루프에서 자리별로 분류된다).
      let page: Page;
      try {
        if (!browser) browser = await launchBrowser();
        page = await browser.newPage();
      } catch (err) {
        return { svgs, failures, unavailable: err instanceof Error ? err.message : String(err) };
      }

      try {
        try {
          // 최종 문서와 같은 테마를 적용해 라벨 폭 실측을 일치시킨다(한글 라벨이 상자를 넘치지 않게).
          await page.setContent(
            `<!doctype html><html><head><meta charset="utf-8"><style>${request.themeCss}</style></head><body></body></html>`,
            { waitUntil: 'networkidle' },
          );
          await page.addScriptTag({ path: request.bundlePath });
          await waitForFonts(page);
          await page.evaluate((config) => {
            const mermaid = (globalThis as unknown as { mermaid: { initialize(c: unknown): void } }).mermaid;
            mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', ...(config as object) });
          }, request.config);
        } catch (err) {
          // 번들 주입·초기화 실패는 개별 다이어그램이 아니라 렌더 자체가 불가한 상태다.
          return { svgs, failures, unavailable: err instanceof Error ? err.message : String(err) };
        }

        for (const [index, source] of request.sources.entries()) {
          let outcome: { svg?: string; error?: string };
          try {
            outcome = await page.evaluate(
              async ([id, text]) => {
                const mermaid = (globalThis as unknown as {
                  mermaid: { render(id: string, text: string): Promise<{ svg: string }> };
                }).mermaid;
                try {
                  return { svg: (await mermaid.render(id, text)).svg };
                } catch (err) {
                  const message = err instanceof Error ? err.message : String(err);
                  return { error: message };
                }
              },
              [`mdx-diagram-${index}`, source] as const,
            );
          } catch (err) {
            // 페이지 자체가 죽은 경우 — 남은 다이어그램도 렌더할 수 없으므로 전부 실패로 표면화하고 멈춘다.
            const message = err instanceof Error ? err.message : String(err);
            for (let rest = index; rest < request.sources.length; rest += 1) {
              failures.push({ index: rest, message });
            }
            break;
          }
          if (outcome.svg !== undefined) svgs[index] = outcome.svg;
          else failures.push({ index, message: outcome.error ?? '알 수 없는 렌더 실패' });
        }
      } finally {
        await page.close();
      }
      return { svgs, failures };
    },
    async dispose() {
      if (browser) {
        await browser.close();
        browser = null;
      }
    },
  };
}
