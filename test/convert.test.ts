import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, mkdirSync, writeFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { convert, convertMany } from '../src/convert.js';
import { createRenderer } from '../src/renderer.js';
import { resolveTheme } from '../src/theme.js';
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

describe('convertMany 소유 렌더러 dispose 실경로 (v0.3.0)', () => {
  const batchDir = join(here, 'fixtures', 'batch');
  const fileA = join(batchDir, 'a.md');
  const fileB = join(batchDir, 'b.md');

  /** launchBrowser 주입 fake — browser.close 호출 횟수를 관찰한다(실 chromium 없음). */
  function countingRenderer() {
    let closes = 0;
    let launches = 0;
    let pdfCalls = 0;
    const control = { failAt: -1 };
    const fakePage = {
      setContent: async () => {},
      evaluate: async () => {},
      pdf: async () => {
        pdfCalls++;
        if (pdfCalls === control.failAt) throw new Error('boom');
      },
      close: async () => {},
    };
    const fakeBrowser = {
      newPage: async () => fakePage,
      close: async () => { closes++; },
    } as unknown as Browser;
    const factory = () => createRenderer(async () => { launches++; return fakeBrowser; });
    return { factory, control, stats: () => ({ closes, launches, pdfCalls }) };
  }

  it('PDF 일괄 변환 후 소유 브라우저를 1회만 launch·close 한다', async () => {
    const { factory, stats } = countingRenderer();
    const outDir = join(tmpdir(), 'mdexporter-owned-dispose');
    const outs = await convertMany([fileA, fileB], { formats: ['pdf'], outDir }, { createRenderer: factory });
    expect(outs.length).toBe(2);
    expect(stats().launches).toBe(1); // 재사용
    expect(stats().closes).toBe(1); // convertMany 소유 → 종료 시 dispose
  });

  it('PDF 중간 실패 시에도 finally 로 소유 브라우저를 dispose (누수 방어)', async () => {
    const { factory, control, stats } = countingRenderer();
    control.failAt = 2; // 두 번째 문서 PDF 에서 실패
    const outDir = join(tmpdir(), 'mdexporter-owned-fail');
    await expect(
      convertMany([fileA, fileB], { formats: ['pdf'], outDir }, { createRenderer: factory }),
    ).rejects.toThrow('boom');
    expect(stats().closes).toBe(1); // 예외 전파에도 렌더러 정리
  });
});

describe('expandInputs 엣지 (v0.3.0 회귀 가드)', () => {
  const batchDir = join(here, 'fixtures', 'batch');
  const fileA = join(batchDir, 'a.md');

  it('대문자 .MD 확장자도 매칭한다', async () => {
    const dir = join(tmpdir(), 'mdexporter-edge-upper');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'upper.MD'), '# 대문자 확장자\n', 'utf8');
    const { renderer, docs } = captureRenderer();
    const outs = await convertMany([dir], { formats: ['html'] }, { renderer });
    expect(outs.some((o) => o.endsWith('upper.html'))).toBe(true);
    expect(docs.length).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('파일 + 그 파일을 포함한 디렉터리 중복 지정 → 1회만 변환(dedup)', async () => {
    const { renderer } = captureRenderer();
    const outs = await convertMany([fileA, batchDir], { formats: ['html'] }, { renderer });
    expect(outs.filter((o) => o.endsWith('a.html')).length).toBe(1);
  });

  it('빈 디렉터리(.md 0건) → 무동작 흡수 대신 에러 전파', async () => {
    const dir = join(tmpdir(), 'mdexporter-edge-empty');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const { renderer } = captureRenderer();
    await expect(
      convertMany([dir], { formats: ['html'] }, { renderer }),
    ).rejects.toThrow(/markdown.*파일이 없습니다/);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('convertMany 출력 충돌·디렉터리 엔트리 (PR #3 재리뷰 후속)', () => {
  it('서로 다른 폴더의 동명 파일이 한 --out-dir 로 모이면 충돌 에러(조용한 덮어쓰기 방지)', async () => {
    const base = join(tmpdir(), 'mdexporter-collide');
    const dirA = join(base, 'a');
    const dirB = join(base, 'b');
    rmSync(base, { recursive: true, force: true });
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });
    writeFileSync(join(dirA, 'report.md'), '# A\n', 'utf8');
    writeFileSync(join(dirB, 'report.md'), '# B\n', 'utf8');
    const { renderer } = captureRenderer();
    await expect(
      convertMany(
        [join(dirA, 'report.md'), join(dirB, 'report.md')],
        { formats: ['html'], outDir: join(base, 'out') },
        { renderer },
      ),
    ).rejects.toThrow(/출력 경로 충돌/);
    rmSync(base, { recursive: true, force: true });
  });

  it('.md 로 끝나는 하위 디렉터리는 변환 대상에서 제외(EISDIR 방지)', async () => {
    const dir = join(tmpdir(), 'mdexporter-mddir');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, 'sub.md'), { recursive: true }); // 이름이 .md 인 디렉터리
    writeFileSync(join(dir, 'real.md'), '# 진짜\n', 'utf8');
    const { renderer, docs } = captureRenderer();
    const outs = await convertMany([dir], { formats: ['html'] }, { renderer });
    expect(outs.length).toBe(1);
    expect(outs[0]).toContain('real.html');
    expect(docs.length).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('존재하지 않는 입력 경로는 친절한 메시지로 전파(raw ENOENT 아님)', async () => {
    const { renderer } = captureRenderer();
    await expect(
      convertMany([join(tmpdir(), 'mdexporter-no-such-file-xyz.md')], { formats: ['html'] }, { renderer }),
    ).rejects.toThrow(/입력 경로를 찾을 수 없습니다/);
  });

  it('대소문자만 다른 출력 경로: 대소문자 무시 FS 에서만 충돌 감지(구분 FS 에선 정상 변환)', async () => {
    const base = join(tmpdir(), 'mdexporter-case-collide');
    rmSync(base, { recursive: true, force: true });
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, 'Guide.md'), '# Upper\n', 'utf8');
    writeFileSync(join(base, 'guide.md'), '# Lower\n', 'utf8');

    // 이 파일시스템이 대소문자를 구분하는지 실측(구현의 런타임 프로브와 동일 원리)
    let caseInsensitive: boolean;
    try {
      const probe = join(base, 'CaseProbe.tmp');
      writeFileSync(probe, '');
      caseInsensitive = existsSync(join(base, 'caseprobe.tmp'));
      rmSync(probe, { force: true });
    } catch {
      caseInsensitive = process.platform === 'darwin' || process.platform === 'win32';
    }

    const run = () =>
      convertMany(
        [join(base, 'Guide.md'), join(base, 'guide.md')],
        { formats: ['html'], outDir: join(base, 'out') },
        { renderer: captureRenderer().renderer },
      );

    if (caseInsensitive) {
      // Guide/guide 가 디스크에서 같은 파일 → 조용한 덮어쓰기 대신 충돌로 차단
      await expect(run()).rejects.toThrow(/출력 경로 충돌/);
    } else {
      // 대소문자 구분 FS 에서는 둘 다 정당한 별개 파일 → 오탐 없이 각각 변환
      const outs = await run();
      expect(outs.length).toBe(2);
    }
    rmSync(base, { recursive: true, force: true });
  });
});

describe('createRenderer 브라우저 재사용 (v0.3.0)', () => {
  it('SC-3: 여러 PDF 호출에서 브라우저를 1회만 launch, dispose 로 닫는다', async () => {
    let launches = 0;
    let closes = 0;
    let pages = 0;
    const fakePage = { setContent: async () => {}, evaluate: async () => {}, pdf: async () => {}, close: async () => {} };
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

// 심링크 생성 가능 여부를 모듈 로드 시점에 1회 probe. 미지원 환경(권한 제약 등)에서는
// SC-6 을 skip 처리한다 — 실패가 아니라 그 환경에서 검증 불가능한 전제 조건이기 때문.
let symlinkSupported = true;
try {
  const probeDir = join(tmpdir(), 'mdexporter-symlink-probe');
  rmSync(probeDir, { recursive: true, force: true });
  mkdirSync(probeDir, { recursive: true });
  symlinkSync(probeDir, join(probeDir, 'self'), 'dir');
  rmSync(probeDir, { recursive: true, force: true });
} catch {
  symlinkSupported = false;
}

describe('재귀 순회 (v0.3.0 002)', () => {
  it('SC-1: -r 하위 트리 전부 변환', async () => {
    const dir = join(tmpdir(), 'mdexporter-recursive-sc1');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, 'sub', 'deep'), { recursive: true });
    writeFileSync(join(dir, 'a.md'), '# A\n', 'utf8');
    writeFileSync(join(dir, 'sub', 'b.md'), '# B\n', 'utf8');
    writeFileSync(join(dir, 'sub', 'deep', 'c.md'), '# C\n', 'utf8');
    const { renderer } = captureRenderer();
    const outs = await convertMany([dir], { recursive: true, formats: ['html'] }, { renderer });
    expect(outs.length).toBe(3);
    expect(outs.some((o) => o.endsWith('a.html'))).toBe(true);
    expect(outs.some((o) => o.endsWith(join('sub', 'b.html')))).toBe(true);
    expect(outs.some((o) => o.endsWith(join('sub', 'deep', 'c.html')))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('SC-2: 미지정 시 최상위만 변환 (비재귀 회귀 없음)', async () => {
    const dir = join(tmpdir(), 'mdexporter-recursive-sc2');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, 'sub'), { recursive: true });
    writeFileSync(join(dir, 'a.md'), '# A\n', 'utf8');
    writeFileSync(join(dir, 'sub', 'b.md'), '# B\n', 'utf8');
    const { renderer } = captureRenderer();
    const outs = await convertMany([dir], { formats: ['html'] }, { renderer });
    expect(outs.length).toBe(1);
    expect(outs[0].endsWith('a.html')).toBe(true);
    expect(outs.some((o) => o.endsWith('b.html'))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('SC-3: --out-dir + 재귀 → 스캔 루트 기준 상대경로 미러 재구성', async () => {
    const dir = join(tmpdir(), 'mdexporter-recursive-sc3');
    const build = join(tmpdir(), 'mdexporter-recursive-sc3-build');
    rmSync(dir, { recursive: true, force: true });
    rmSync(build, { recursive: true, force: true });
    mkdirSync(join(dir, 'sub', 'deep'), { recursive: true });
    writeFileSync(join(dir, 'sub', 'deep', 'x.md'), '# X\n', 'utf8');
    const { renderer } = captureRenderer();
    const outs = await convertMany([dir], { recursive: true, outDir: build, formats: ['html'] }, { renderer });
    expect(outs.length).toBe(1);
    // 평탄화(build/x.html)가 아니라 하위 경로가 보존됨을 확인
    expect(outs[0].endsWith(join('sub', 'deep', 'x.html'))).toBe(true);
    expect(outs[0]).not.toBe(join(build, 'x.html'));
    rmSync(dir, { recursive: true, force: true });
    rmSync(build, { recursive: true, force: true });
  });

  it('SC-4: --out-dir 미지정 + 재귀 = 산출물이 소스 파일과 같은 폴더', async () => {
    const dir = join(tmpdir(), 'mdexporter-recursive-sc4');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, 'sub'), { recursive: true });
    writeFileSync(join(dir, 'sub', 'x.md'), '# X\n', 'utf8');
    const { renderer } = captureRenderer();
    const outs = await convertMany([dir], { recursive: true, formats: ['html'] }, { renderer });
    expect(outs.length).toBe(1);
    expect(outs[0]).toBe(join(dir, 'sub', 'x.html'));
    rmSync(dir, { recursive: true, force: true });
  });

  it('SC-5: 서로 다른 하위 폴더의 동명 파일은 미러 출력에서 충돌하지 않는다', async () => {
    const dir = join(tmpdir(), 'mdexporter-recursive-sc5');
    const build = join(tmpdir(), 'mdexporter-recursive-sc5-build');
    rmSync(dir, { recursive: true, force: true });
    rmSync(build, { recursive: true, force: true });
    mkdirSync(join(dir, 'x'), { recursive: true });
    mkdirSync(join(dir, 'y'), { recursive: true });
    writeFileSync(join(dir, 'x', 'README.md'), '# X\n', 'utf8');
    writeFileSync(join(dir, 'y', 'README.md'), '# Y\n', 'utf8');
    const { renderer } = captureRenderer();
    const outs = await convertMany([dir], { recursive: true, outDir: build, formats: ['html'] }, { renderer });
    expect(outs.length).toBe(2);
    expect(outs.some((o) => o === join(build, 'x', 'README.html'))).toBe(true);
    expect(outs.some((o) => o === join(build, 'y', 'README.html'))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
    rmSync(build, { recursive: true, force: true });
  });

  it.skipIf(!symlinkSupported)('SC-6: 순환 디렉터리 심링크가 있어도 유한 시간에 종료하고 중복 방문 없음', async () => {
    const dir = join(tmpdir(), 'mdexporter-recursive-sc6');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.md'), '# A\n', 'utf8');
    symlinkSync(dir, join(dir, 'loop'), 'dir'); // dir/loop -> dir (순환)
    const { renderer } = captureRenderer();
    // vitest 기본 타임아웃이 이미 무한루프에 대한 방어망 — 여기선 정상 resolve + 중복 없음만 확인.
    const outs = await convertMany([dir], { recursive: true, formats: ['html'] }, { renderer });
    expect(outs.length).toBe(1);
    expect(outs[0]).toBe(join(dir, 'a.html'));
    rmSync(dir, { recursive: true, force: true });
  });

  it('SC-7: dot-디렉터리·node_modules 는 순회 대상에서 제외된다', async () => {
    const dir = join(tmpdir(), 'mdexporter-recursive-sc7');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, '.hidden'), { recursive: true });
    mkdirSync(join(dir, 'node_modules'), { recursive: true });
    writeFileSync(join(dir, '.hidden', 'h.md'), '# H\n', 'utf8');
    writeFileSync(join(dir, 'node_modules', 'n.md'), '# N\n', 'utf8');
    writeFileSync(join(dir, 'a.md'), '# A\n', 'utf8');
    const { renderer } = captureRenderer();
    const outs = await convertMany([dir], { recursive: true, formats: ['html'] }, { renderer });
    expect(outs.length).toBe(1);
    expect(outs[0].endsWith('a.html')).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('SC-8: 재귀 스캔 결과 .md 0건이면 에러를 전파한다', async () => {
    const dir = join(tmpdir(), 'mdexporter-recursive-sc8');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, 'sub'), { recursive: true });
    writeFileSync(join(dir, 'sub', 'not-markdown.txt'), 'x', 'utf8');
    const { renderer } = captureRenderer();
    await expect(
      convertMany([dir], { recursive: true, formats: ['html'] }, { renderer }),
    ).rejects.toThrow(/markdown.*파일이 없습니다/);
    rmSync(dir, { recursive: true, force: true });
  });

  it('SC-9: 존재하지 않는 입력 경로는 재귀 지정 시에도 친절 에러를 유지한다', async () => {
    const { renderer } = captureRenderer();
    await expect(
      convertMany(
        [join(tmpdir(), 'mdexporter-recursive-nope')],
        { recursive: true, formats: ['html'] },
        { renderer },
      ),
    ).rejects.toThrow(/입력 경로를 찾을 수 없습니다/);
  });

  it('SC-10: 재귀로 새로 선택된 하위 경로 파일도 원문 내용을 보존한다', async () => {
    const dir = join(tmpdir(), 'mdexporter-recursive-sc10');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, 'sub'), { recursive: true });
    const marker = 'UNIQUE-RECURSIVE-CONTENT-9f3a2c';
    writeFileSync(join(dir, 'sub', 'b.md'), `# B\n\n${marker}\n`, 'utf8');
    const { renderer, docs } = captureRenderer();
    await convertMany([dir], { recursive: true, formats: ['html'] }, { renderer });
    expect(docs.join('\n')).toContain(marker);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('재귀 순회 정적 검증 (v0.3.0 002, SC-11·SC-12)', () => {
  it('SC-11: 재귀 구현이 신규 런타임 의존성을 추가하지 않는다 (node:fs 만 사용)', () => {
    const pkgPath = join(here, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { dependencies: Record<string, string> };
    // 재귀 도입 전 3개(commander·markdown-it·playwright) 그대로 — glob 계열 신규 의존성 0건.
    expect(Object.keys(pkg.dependencies).sort()).toEqual(['commander', 'markdown-it', 'playwright']);

    const src = readFileSync(join(here, '..', 'src', 'convert.ts'), 'utf8');
    expect(src).not.toMatch(/from ['"](fast-glob|glob|globby|fdir|klaw|readdirp)['"]/);
  });

  it('SC-12: USAGE.md 에 --recursive/-r 사용법과 dot-디렉터리·node_modules 스킵 규칙이 명시된다', () => {
    const usage = readFileSync(join(here, '..', 'docs', 'USAGE.md'), 'utf8');
    expect(usage).toContain('--recursive');
    expect(usage).toMatch(/-r\b/);
    expect(usage).toContain('node_modules');
    // dot-디렉터리 스킵 규칙 문구(spec FR-6 계승 표현 중 하나) 존재 확인.
    expect(usage).toMatch(/점\(\.\)|dot-디렉터리|\(dot\)|\.\s*으로\s*시작하는 디렉터리|숨김 디렉터리/);
  });
});

describe('오프라인 폰트 임베딩 (v0.3.0 003)', () => {
  const themesDir = join(here, '..', 'themes');
  const defaultCssPath = join(themesDir, 'default.css');
  const defaultCss = readFileSync(defaultCssPath, 'utf8');

  /** @font-face 블록(default/full 테마) 또는 선행 @import 행(cdn 테마)을 제거해 폰트 외 규칙만 남긴다. */
  function fontlessRules(css: string): string {
    return css
      .replace(/@font-face\s*{[^}]*}/s, '')
      .replace(/^@import[^\n]*\n/, '')
      .trim();
  }

  it('SC-1: 원격 CDN 참조 부재 + 임베딩 존재', () => {
    expect(defaultCss).not.toMatch(/jsdelivr|https?:|@import/);
    expect(defaultCss).toContain('@font-face');
    expect(defaultCss).toMatch(/src:\s*url\(data:font\/woff2;base64,/);
  });

  it('SC-2: 폰트 우선순위 불변', () => {
    const fontFaceBlock = defaultCss.slice(0, defaultCss.indexOf('}') + 1);
    expect(fontFaceBlock).toMatch(/font-family:\s*'Pretendard Variable'/);
    const bodyFontFamily = defaultCss.match(/body\s*{[^}]*font-family:\s*'([^']+)'/)?.[1];
    expect(bodyFontFamily).toMatch(/^Pretendard( Variable)?$/);
  });

  it('SC-3: 가변 굵기 400·700·800 커버', () => {
    expect(defaultCss).toMatch(/font-weight:\s*400\s+800/);
  });

  it('SC-4: 폴백 체인 유지', () => {
    const bodyFontFamilyLine = defaultCss.match(/body\s*{[^}]*font-family:[^;]+;/)?.[0] ?? '';
    // 순서대로 나타나는지 확인 — 각 토큰이 이전 토큰보다 뒤에 위치해야 폴백 순서가 유지된다.
    const order = ['Pretendard', 'Apple SD Gothic Neo', 'Noto Sans KR', '-apple-system', 'sans-serif'];
    let lastIndex = -1;
    for (const token of order) {
      const idx = bodyFontFamilyLine.indexOf(token);
      expect(idx).toBeGreaterThan(lastIndex);
      lastIndex = idx;
    }
  });

  it('SC-5: default-cdn.css 동봉·CDN import', () => {
    const cdnPath = join(themesDir, 'default-cdn.css');
    expect(existsSync(cdnPath)).toBe(true);
    const cdnCss = readFileSync(cdnPath, 'utf8');
    expect(cdnCss).toContain('@import');
    expect(cdnCss.toLowerCase()).toContain('jsdelivr');
    expect(cdnCss.toLowerCase()).toContain('pretendard');
    expect(fontlessRules(cdnCss)).toBe(fontlessRules(defaultCss));
  });

  it('SC-6: --theme default-cdn 회피 경로 적용', async () => {
    const cdnPath = join(themesDir, 'default-cdn.css');
    const css = await resolveTheme(cdnPath);
    expect(css).toMatch(/@import[^\n]*jsdelivr/);
  });

  it('SC-7: OFL 동봉 + files 포함', () => {
    const oflPath = join(themesDir, 'fonts', 'OFL.txt');
    expect(existsSync(oflPath)).toBe(true);
    const ofl = readFileSync(oflPath, 'utf8');
    expect(ofl).toMatch(/SIL Open Font License.*1\.1/s);
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as { files: string[] };
    expect(pkg.files).toContain('themes');
  });

  it('SC-8: networkidle 유지', () => {
    const rendererSrc = readFileSync(join(here, '..', 'src', 'renderer.ts'), 'utf8');
    expect(rendererSrc).toMatch(/waitUntil:\s*['"]networkidle['"]/);
  });

  it('SC-9: 임베딩 테마 내용 문자 단위 보존', async () => {
    const { renderer, docs } = captureRenderer();
    await convertMany([fixture], { formats: ['html'] }, { renderer });
    const source = readFileSync(fixture, 'utf8');
    const words = source.match(/[가-힣A-Za-z0-9]+/g) ?? [];
    for (const word of words) expect(docs[0]).toContain(word);
  });

  it('SC-10: 신규 런타임 의존성 0', () => {
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies).sort()).toEqual(['commander', 'markdown-it', 'playwright']);
    expect(pkg.dependencies).not.toHaveProperty('fonttools');
  });

  // USAGE.md 크기·회피 경로 안내는 6단계 문서 갱신 이후 반영 대상이라 이 시점엔 RED 가 예상된다
  // (5b 재실행 시 문서 갱신 완료 여부로 재판정).
  it('SC-11: USAGE 크기·회피 경로 문서화', () => {
    const usage = readFileSync(join(here, '..', 'docs', 'USAGE.md'), 'utf8');
    expect(usage).toMatch(/크기|KB|MB/);
    expect(usage).toContain('default-cdn.css');
    expect(usage).toContain('default-full.css');
    expect(usage).toContain('--theme');
  });

  it('SC-12: default-full.css 완전 커버 테마 동봉·유효', async () => {
    const fullPath = join(themesDir, 'default-full.css');
    expect(existsSync(fullPath)).toBe(true);
    const fullCss = readFileSync(fullPath, 'utf8');
    expect(fullCss).not.toMatch(/jsdelivr|https?:|@import/);
    expect(fullCss).toContain('@font-face');
    expect(fullCss).toMatch(/src:\s*url\(data:font\/woff2;base64,/);
    expect(fontlessRules(fullCss)).toBe(fontlessRules(defaultCss));

    const resolved = await resolveTheme(fullPath);
    expect(resolved).toMatch(/src:\s*url\(data:font\/woff2;base64,/);
  });
});

describe('로컬 이미지 임베딩 (v0.3.1 001)', () => {
  const imgFixture = join(here, 'fixtures', 'images', 'gradient.png');

  /** console.warn 을 가로채 경고 발생을 단언할 수 있게 한다. */
  function captureWarnings() {
    const messages: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      messages.push(args.map(String).join(' '));
    };
    return { messages, restore: () => { console.warn = original; } };
  }

  /** 이미지가 포함된 markdown 문서를 임시 폴더에 만들고 경로를 돌려준다. */
  function makeDocWithImage(
    body: string,
    layout: { imageAt?: string } = {},
  ): { dir: string; doc: string } {
    const dir = join(tmpdir(), `mdx-img-${process.pid}-${Math.random().toString(36).slice(2)}`);
    const rel = layout.imageAt ?? 'gradient.png';
    const imgPath = join(dir, rel);
    mkdirSync(dirname(imgPath), { recursive: true });
    writeFileSync(imgPath, readFileSync(imgFixture));
    const doc = join(dir, 'doc.md');
    writeFileSync(doc, body, 'utf8');
    return { dir, doc };
  }

  it('SC-1: 상대경로 이미지를 data URI 로 인라인한다', async () => {
    const { dir, doc } = makeDocWithImage('# 제목\n\n![구성도](gradient.png)\n');
    try {
      const { renderer, docs } = captureRenderer();
      await convert({ input: doc, formats: ['html'] }, { renderer });
      expect(docs[0]).toMatch(/<img src="data:image\/png;base64,[A-Za-z0-9+/=]+"/);
      expect(docs[0]).not.toContain('src="gradient.png"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('SC-2: 하위 폴더·상위 참조 경로를 입력 파일 기준으로 해석한다', async () => {
    const dir = join(tmpdir(), `mdx-img2-${process.pid}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(dir, 'sub', 'assets'), { recursive: true });
    mkdirSync(join(dir, 'shared'), { recursive: true });
    const bytes = readFileSync(imgFixture);
    writeFileSync(join(dir, 'sub', 'assets', 'a.png'), bytes);
    writeFileSync(join(dir, 'shared', 'b.png'), bytes);
    const doc = join(dir, 'sub', 'doc.md');
    writeFileSync(doc, '![a](assets/a.png)\n\n![b](../shared/b.png)\n', 'utf8');
    try {
      const { renderer, docs } = captureRenderer();
      await convert({ input: doc, formats: ['html'] }, { renderer });
      const matches = docs[0].match(/data:image\/png;base64,/g) ?? [];
      expect(matches.length).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('SC-3: --out-dir 로 다른 폴더에 출력해도 이미지가 담긴다', async () => {
    const { dir, doc } = makeDocWithImage('![구성도](gradient.png)\n');
    const outDir = join(dir, 'out');
    try {
      const { renderer, docs } = captureRenderer();
      await convert({ input: doc, formats: ['html'], outDir }, { renderer });
      expect(docs[0]).toContain('data:image/png;base64,');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('SC-4: embedImages: false 면 원본 경로가 그대로 남는다', async () => {
    const { dir, doc } = makeDocWithImage('![구성도](gradient.png)\n');
    try {
      const { renderer, docs } = captureRenderer();
      await convert({ input: doc, formats: ['html'], embedImages: false }, { renderer });
      expect(docs[0]).toContain('src="gradient.png"');
      expect(docs[0]).not.toContain('data:image/png;base64,');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('SC-5: 원격 URL·data URI 는 임베딩 대상에서 제외한다', async () => {
    const { dir, doc } = makeDocWithImage(
      '![원격](https://example.com/x.png)\n\n![이미인라인](data:image/gif;base64,R0lGOD)\n',
    );
    try {
      const { renderer, docs } = captureRenderer();
      await convert({ input: doc, formats: ['html'] }, { renderer });
      expect(docs[0]).toContain('src="https://example.com/x.png"');
      expect(docs[0]).toContain('src="data:image/gif;base64,R0lGOD"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('SC-6: 없는 이미지 경로는 원본 src 를 유지하고 변환은 성공한다', async () => {
    const { dir, doc } = makeDocWithImage('![없음](nope.png)\n');
    try {
      const { renderer, docs } = captureRenderer();
      const out = await convert({ input: doc, formats: ['html'] }, { renderer });
      expect(out.length).toBe(1);
      expect(docs[0]).toContain('src="nope.png"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('SC-7: 임베딩 후에도 원본 텍스트·alt 가 보존된다 (P-001)', async () => {
    const body = '# 보고서 제목\n\n본문 문장이다.\n\n![구성도 설명](gradient.png)\n\n마무리 문장.\n';
    const { dir, doc } = makeDocWithImage(body);
    try {
      const { renderer, docs } = captureRenderer();
      await convert({ input: doc, formats: ['html'] }, { renderer });
      for (const word of ['보고서', '제목', '본문', '문장이다', '구성도', '설명', '마무리']) {
        expect(docs[0]).toContain(word);
      }
      expect(docs[0]).toContain('alt="구성도 설명"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('SC-10: 이미지가 없는 문서는 자산 조회 없이 종전 경로로 렌더된다 (회귀 가드)', async () => {
    const { createParser } = await import('../src/parser.js');
    const base = createParser();
    const seen: (unknown | undefined)[] = [];
    const parser = {
      render: (md: string, assets?: ReadonlyMap<string, string>) => {
        seen.push(assets);
        return base.render(md, assets);
      },
      scanImages: base.scanImages,
    };
    const { renderer, docs } = captureRenderer();
    await convert({ input: fixture, formats: ['html'] }, { renderer, parser });
    expect(seen).toEqual([undefined]);
    expect(docs[0]).not.toContain('data:image');
  });

  it('SC-6b: 없는 이미지는 경고로 알린다 (조용한 소실 금지)', async () => {
    const { dir, doc } = makeDocWithImage('![없음](nope.png)\n');
    const warnings = captureWarnings();
    try {
      const { renderer } = captureRenderer();
      await convert({ input: doc, formats: ['html'] }, { renderer });
    } finally {
      warnings.restore();
      rmSync(dir, { recursive: true, force: true });
    }
    expect(warnings.messages.join('\n')).toMatch(/이미지를 찾을 수 없습니다.*nope\.png/);
  });

  it('SC-9b: 원시 HTML <img> 는 경고로 알리고, 주석·원격 참조는 오탐하지 않는다', async () => {
    const { dir, doc } = makeDocWithImage(
      '<img src="gradient.png" width="120">\n\n<!-- <img src="commented.png"> -->\n\n<img src="https://h/x.png">\n',
    );
    const warnings = captureWarnings();
    try {
      const { renderer } = captureRenderer();
      await convert({ input: doc, formats: ['html'] }, { renderer });
    } finally {
      warnings.restore();
      rmSync(dir, { recursive: true, force: true });
    }
    const joined = warnings.messages.join('\n');
    expect(joined).toMatch(/원시 HTML <img> 1개/);
  });

  it('SC-6c: 읽기 실패 원인이 경고에 담긴다 (없음과 구분)', async () => {
    const dir = join(tmpdir(), `mdx-img-dir-${process.pid}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(dir, 'shot.png'), { recursive: true }); // 이미지 경로에 디렉터리
    const doc = join(dir, 'doc.md');
    writeFileSync(doc, '![디렉터리](shot.png)\n', 'utf8');
    const warnings = captureWarnings();
    try {
      const { renderer } = captureRenderer();
      await convert({ input: doc, formats: ['html'] }, { renderer });
    } finally {
      warnings.restore();
      rmSync(dir, { recursive: true, force: true });
    }
    expect(warnings.messages.join('\n')).toMatch(/이미지를 읽을 수 없습니다\(EISDIR\)/);
  });

  it('URL 수식자가 붙은 로컬 참조도 임베딩한다 (?v=·#단편)', async () => {
    const { dir, doc } = makeDocWithImage('![캐시버스터](gradient.png?v=2)\n\n![단편](gradient.png#top)\n');
    try {
      const { renderer, docs } = captureRenderer();
      await convert({ input: doc, formats: ['html'] }, { renderer });
      const matches = docs[0].match(/data:image\/png;base64,/g) ?? [];
      expect(matches.length).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('SC-12: 세 테마의 이미지 규칙이 동일하고 최대 너비를 규칙 안에서 지정한다', async () => {
    const themesDir = join(here, '..', 'themes');
    const blocks = ['default.css', 'default-full.css', 'default-cdn.css'].map((name) => {
      const css = readFileSync(join(themesDir, name), 'utf8');
      const block = /(?:^|\n)img\s*\{([^}]*)\}/.exec(css);
      expect(block, `${name} 에 img 규칙 없음`).not.toBeNull();
      return block![1];
    });
    for (const body of blocks) {
      expect(body).toMatch(/max-width:\s*100%/);
      expect(body).toMatch(/height:\s*auto/);
    }
    expect(new Set(blocks.map((b) => b.replace(/\s+/g, ' ').trim())).size).toBe(1);
  });
});

describe('이미지 자산 해석 단위 (v0.3.1 001)', () => {
  it('isEmbeddableRef: 로컬 경로만 임베딩 대상으로 판정한다', async () => {
    const { isEmbeddableRef } = await import('../src/images.js');
    expect(isEmbeddableRef('a.png')).toBe(true);
    expect(isEmbeddableRef('./sub/a.png')).toBe(true);
    expect(isEmbeddableRef('../up/a.png')).toBe(true);
    expect(isEmbeddableRef('/abs/a.png')).toBe(true);
    expect(isEmbeddableRef('http://h/a.png')).toBe(false);
    expect(isEmbeddableRef('https://h/a.png')).toBe(false);
    expect(isEmbeddableRef('//h/a.png')).toBe(false);
    expect(isEmbeddableRef('data:image/png;base64,AAA')).toBe(false);
    expect(isEmbeddableRef('file:///tmp/a.png')).toBe(false);
    expect(isEmbeddableRef('')).toBe(false);
  });

  it('SC-8: 확장자별 MIME 을 부여하고 미지 확장자는 대상에서 제외한다', async () => {
    const { mimeForImage } = await import('../src/images.js');
    expect(mimeForImage('a.png')).toBe('image/png');
    expect(mimeForImage('a.JPG')).toBe('image/jpeg');
    expect(mimeForImage('a.jpeg')).toBe('image/jpeg');
    expect(mimeForImage('a.gif')).toBe('image/gif');
    expect(mimeForImage('a.webp')).toBe('image/webp');
    expect(mimeForImage('a.svg')).toBe('image/svg+xml');
    expect(mimeForImage('a.avif')).toBe('image/avif');
    expect(mimeForImage('a.txt')).toBeUndefined();
    expect(mimeForImage('noext')).toBeUndefined();
  });

  it('loadImageAssets: 존재 파일은 data URI, 미존재는 missing 으로 분류한다', async () => {
    const { loadImageAssets } = await import('../src/images.js');
    const baseDir = join(here, 'fixtures', 'images');
    const { assets, missing } = await loadImageAssets(['gradient.png', 'nope.png'], baseDir);
    expect(assets.get('gradient.png')).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
    expect(assets.has('nope.png')).toBe(false);
    expect(missing).toEqual([{ ref: 'nope.png', code: 'ENOENT' }]);
  });

  it('같은 파일을 다른 표기로 참조하면 같은 자산을 공유한다 (해석 경로 기준 dedup)', async () => {
    const { loadImageAssets } = await import('../src/images.js');
    const dir = join(tmpdir(), `mdx-dedup-${process.pid}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(dir, 'sub'), { recursive: true });
    const bytes = readFileSync(join(here, 'fixtures', 'images', 'gradient.png'));
    writeFileSync(join(dir, 'same.png'), bytes);
    writeFileSync(join(dir, 'sub', 'other.png'), Buffer.concat([bytes, Buffer.from([0])]));
    try {
      const { assets } = await loadImageAssets(
        ['same.png', './same.png', 'sub/../same.png', 'sub/other.png'],
        dir,
      );
      expect(assets.size).toBe(4);
      const shared = ['same.png', './same.png', 'sub/../same.png'].map((r) => assets.get(r));
      expect(new Set(shared).size).toBe(1); // 같은 파일 → 같은 data URI 문자열
      expect(assets.get('sub/other.png')).not.toBe(shared[0]); // 다른 파일은 공유하지 않는다
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('0바이트 이미지는 임베딩하지 않고 경고한다', async () => {
    const { loadImageAssets } = await import('../src/images.js');
    const dir = join(tmpdir(), `mdx-empty-${process.pid}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'blank.png'), Buffer.alloc(0));
    try {
      const { assets, empty } = await loadImageAssets(['blank.png'], dir);
      expect(assets.has('blank.png')).toBe(false);
      expect(empty).toEqual(['blank.png']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('render 만 가진 파서도 그대로 동작한다 (하위호환 회귀 가드)', async () => {
    const { renderer, docs } = captureRenderer();
    const legacyParser = { render: (_md: string) => '<p>LEGACY BODY</p>' };
    const out = await convert(
      { input: join(here, 'fixtures', 'images', '..', '..', 'fixtures', 'sample.md'), formats: ['html'] },
      { renderer, parser: legacyParser },
    );
    expect(out.length).toBe(1);
    expect(docs[0]).toContain('LEGACY BODY');
  });

  it('SC-9: scanImages 가 markdown 이미지와 원시 HTML img 를 구분해 보고한다', async () => {
    const { createParser } = await import('../src/parser.js');
    const parser = createParser();
    const scan = parser.scanImages!('![a](a.png)\n\n<img src="b.png" width="300">\n\n![c](https://h/c.png)\n');
    expect(scan.refs).toEqual(['a.png', 'https://h/c.png']);
    expect(scan.rawHtmlImages).toBe(1);
  });
});
