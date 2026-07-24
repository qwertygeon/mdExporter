import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { convert } from '../src/convert.js';
import type { PdfOptions, Renderer } from '../src/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, 'fixtures', 'sample.md');

/** 브라우저 없이 조립된 HTML 문서·PDF 옵션을 캡처하는 fake 렌더러 */
function captureRenderer() {
  const docs: string[] = [];
  const pdfOpts: PdfOptions[] = [];
  const renderer: Renderer = {
    html: async (doc) => { docs.push(doc); },
    pdf: async (doc, _out, pdf) => { docs.push(doc); pdfOpts.push(pdf); },
  };
  return { renderer, docs, pdfOpts };
}

describe('convert', () => {
  it('SC-2: 원본 텍스트 내용을 보존한다', async () => {
    const { renderer, docs } = captureRenderer();
    await convert({ input: fixture, formats: ['html'] }, { renderer });
    const source = readFileSync(fixture, 'utf8');
    const words = source.match(/[가-힣A-Za-z0-9]+/g) ?? [];
    for (const word of words) expect(docs[0]).toContain(word);
  });

  it('SC-4: 옵션 미지정 시 내장 기본 테마를 사용한다', async () => {
    const { renderer, docs } = captureRenderer();
    await convert({ input: fixture, formats: ['html'] }, { renderer });
    expect(docs[0]).toContain('Pretendard');
  });

  it('SC-3: --theme 로 커스텀 테마를 주입한다', async () => {
    const { renderer, docs } = captureRenderer();
    const theme = join(here, 'fixtures', 'custom.css');
    await convert({ input: fixture, formats: ['html'], theme }, { renderer });
    expect(docs[0]).toContain('CUSTOM-THEME-MARKER');
  });

  it('SC-5: <title> 을 채운다 (명시값 + 파일명 폴백)', async () => {
    const explicit = captureRenderer();
    await convert({ input: fixture, formats: ['html'], title: 'My Doc' }, { renderer: explicit.renderer });
    expect(explicit.docs[0]).toContain('<title>My Doc</title>');

    const fallback = captureRenderer();
    await convert({ input: fixture, formats: ['html'] }, { renderer: fallback.renderer });
    expect(fallback.docs[0]).toContain('<title>sample</title>');
  });

  it('transform 훅이 본문에 적용된다 (확장 지점)', async () => {
    const { renderer, docs } = captureRenderer();
    await convert(
      { input: fixture, formats: ['html'] },
      { renderer, transforms: [(body) => `<div id="wrap">${body}</div>`] },
    );
    expect(docs[0]).toContain('<div id="wrap">');
  });
});

describe('document layout (v0.2.0)', () => {
  it('SC-1: --toc 로 목차 생성 + 헤딩 id·링크', async () => {
    const { renderer, docs } = captureRenderer();
    await convert({ input: fixture, formats: ['html'], toc: true }, { renderer });
    const doc = docs[0];
    expect(doc).toContain('<nav class="toc">');
    // h2 "표 예시" → id·목차 링크
    expect(doc).toMatch(/<h2 id="[^"]+">표 예시<\/h2>/);
    expect(doc).toMatch(/<a href="#[^"]+">표 예시<\/a>/);
  });

  it('SC-2: --toc-depth 가 포함 헤딩 레벨을 제한', async () => {
    const deep = captureRenderer();
    await convert({ input: fixture, formats: ['html'], toc: { depth: 3 } }, { renderer: deep.renderer });
    expect(deep.docs[0]).toContain('>인라인 코드<'); // h3 포함

    const shallow = captureRenderer();
    await convert({ input: fixture, formats: ['html'], toc: { depth: 2 } }, { renderer: shallow.renderer });
    const tocOnly = shallow.docs[0].split('</nav>')[0];
    expect(tocOnly).not.toContain('인라인 코드'); // depth 2 목차엔 h3 없음
    // 단, h3 자체는 본문에 그대로 존재(내용 보존)
    expect(shallow.docs[0]).toContain('인라인 코드');
  });

  it('SC-3: --cover 로 표지 페이지(제목 + 선택 날짜)', async () => {
    const { renderer, docs } = captureRenderer();
    await convert({ input: fixture, formats: ['html'], title: '보고서', cover: { date: '2026-07-24' } }, { renderer });
    expect(docs[0]).toContain('<section class="cover">');
    expect(docs[0]).toContain('<h1 class="cover-title">보고서</h1>');
    expect(docs[0]).toContain('2026-07-24');
  });

  it('SC-4: --header/--footer 가 PDF 옵션에 구성됨', async () => {
    const { renderer, pdfOpts } = captureRenderer();
    await convert({ input: fixture, formats: ['pdf'], title: '보고서', header: true, footer: true }, { renderer });
    const pdf = pdfOpts[0];
    expect(pdf.displayHeaderFooter).toBe(true);
    expect(pdf.headerTemplate).toContain('보고서');
    expect(pdf.footerTemplate).toContain('pageNumber');
  });

  it('SC-5: 옵션 미지정 시 목차·표지 미삽입 (기본 동작 불변)', async () => {
    const { renderer, docs } = captureRenderer();
    await convert({ input: fixture, formats: ['html'] }, { renderer });
    expect(docs[0]).not.toContain('class="toc"');
    expect(docs[0]).not.toContain('class="cover"');
  });

  it('SC-6: 레이아웃 활성 시에도 원문 내용 보존', async () => {
    const { renderer, docs } = captureRenderer();
    await convert({ input: fixture, formats: ['html'], toc: true, cover: true }, { renderer });
    const source = readFileSync(fixture, 'utf8');
    for (const word of source.match(/[가-힣A-Za-z0-9]+/g) ?? []) {
      expect(docs[0]).toContain(word);
    }
  });
});
