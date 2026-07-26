import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { convert, convertMany } from '../src/convert.js';
import { createRenderer } from '../src/renderer.js';
import { tocStage } from '../src/layout.js';
import type { Browser } from 'playwright';
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

describe('tocStage 견고화 (리뷰 후속)', () => {
  const ctx = { title: 't', theme: '', sourcePath: 's.md' };

  it('여는 태그에 속성이 있어도 매칭하고 기존 id 를 재사용', () => {
    const html = '<h2 id="사전정의">제목</h2><p>x</p>';
    const out = tocStage(3)(html, ctx);
    // 기존 id 보존(재작성 안 함) + 그 id 로 목차 링크
    expect(out).toContain('<h2 id="사전정의">제목</h2>');
    expect(out).toContain('<a href="#사전정의">제목</a>');
    // id 중복 부여 없음
    expect(out.match(/id="/g)?.length).toBe(1);
  });

  it('id 없는 헤딩엔 slugify id 를 부여하고 기존 속성은 보존', () => {
    const html = '<h2 class="x">Hello World</h2>';
    const out = tocStage(3)(html, ctx);
    expect(out).toContain('<h2 class="x" id="hello-world">Hello World</h2>');
  });

  it('비숫자 depth 는 기본 3(h2~h3)으로 클램프', () => {
    const html = '<h2>둘</h2><h3>셋</h3><h4>넷</h4>';
    const out = tocStage(Number('bad'))(html, ctx);
    const toc = out.split('</nav>')[0];
    expect(toc).toContain('>둘<');
    expect(toc).toContain('>셋<');
    expect(toc).not.toContain('>넷<'); // h4 는 기본 depth 3 제외
  });

  it('depth 상한은 h6', () => {
    const html = '<h6>여섯</h6>';
    const out = tocStage(99)(html, ctx);
    expect(out.split('</nav>')[0]).toContain('>여섯<');
  });
});

describe('convertMany 일괄 변환 (v0.3.0)', () => {
  const batchDir = join(here, 'fixtures', 'batch');
  const fileA = join(batchDir, 'a.md');
  const fileB = join(batchDir, 'b.md');

  it('SC-1: 여러 파일 입력 → 각 입력마다 산출', async () => {
    const { renderer, docs } = captureRenderer();
    const outs = await convertMany([fileA, fileB], { formats: ['html'] }, { renderer });
    expect(outs.length).toBe(2);
    expect(outs.some((o) => o.endsWith('a.html'))).toBe(true);
    expect(outs.some((o) => o.endsWith('b.html'))).toBe(true);
    expect(docs.length).toBe(2);
  });

  it('SC-2: 디렉터리 입력 → 그 안 *.md 전부 변환 (정렬된 결정적 순서)', async () => {
    const { renderer } = captureRenderer();
    const outs = await convertMany([batchDir], { formats: ['html'] }, { renderer });
    expect(outs.length).toBe(2);
    expect(outs[0]).toContain('a.html');
    expect(outs[1]).toContain('b.html');
  });

  it('SC-3: caller 가 공급한 renderer 는 convertMany 가 dispose 하지 않는다 (소유권=caller)', async () => {
    let disposed = 0;
    const renderer: Renderer = {
      html: async () => {},
      pdf: async () => {},
      dispose: async () => { disposed++; },
    };
    await convertMany([fileA, fileB], { formats: ['html'] }, { renderer });
    expect(disposed).toBe(0);
  });

  it('SC-4: 단일 입력 convert 회귀 (기존 동작 유지)', async () => {
    const { renderer, docs } = captureRenderer();
    const outs = await convert({ input: fileA, formats: ['html'] }, { renderer });
    expect(outs.length).toBe(1);
    expect(outs[0]).toContain('a.html');
    expect(docs[0]).toContain('문서 A');
  });

  it('SC-5: 일괄 변환도 각 원문 내용 보존', async () => {
    const { renderer, docs } = captureRenderer();
    await convertMany([fileA, fileB], { formats: ['html'] }, { renderer });
    const joined = docs.join('\n');
    expect(joined).toContain('알파');
    expect(joined).toContain('베타');
  });

  it('소유 renderer(미공급) 경로: html-only 는 브라우저 없이 완료', async () => {
    // deps.renderer 미공급 → convertMany 가 createRenderer 소유. html 만이라 chromium launch 없음, dispose no-op.
    const outDir = join(tmpdir(), 'mdexporter-test-out');
    const outs = await convertMany([fileA], { formats: ['html'], outDir });
    expect(outs.length).toBe(1);
    expect(outs[0]).toContain('a.html');
  });
});

describe('createRenderer 브라우저 재사용 (v0.3.0)', () => {
  it('SC-3: 여러 PDF 호출에서 브라우저를 1회만 launch, dispose 로 닫는다', async () => {
    let launches = 0;
    let closes = 0;
    let pages = 0;
    const fakePage = { setContent: async () => {}, pdf: async () => {}, close: async () => {} };
    const fakeBrowser = {
      newPage: async () => { pages++; return fakePage; },
      close: async () => { closes++; },
    } as unknown as Browser;
    const r = createRenderer(async () => { launches++; return fakeBrowser; });
    await r.pdf('<html></html>', join(tmpdir(), 'reuse-1.pdf'), {});
    await r.pdf('<html></html>', join(tmpdir(), 'reuse-2.pdf'), {});
    expect(launches).toBe(1); // 재사용 (매 호출 launch 아님)
    expect(pages).toBe(2);
    await r.dispose!();
    expect(closes).toBe(1);
  });
});
