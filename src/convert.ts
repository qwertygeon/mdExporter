import { readFile, mkdir, readdir, stat } from 'node:fs/promises';
import { basename, extname, join, resolve, dirname } from 'node:path';
import type { ConvertContext, ConvertDeps, ConvertOptions, PdfOptions, TransformStage } from './types.js';
import { createParser } from './parser.js';
import { createRenderer } from './renderer.js';
import { resolveTheme } from './theme.js';
import { assembleDocument } from './template.js';
import { tocStage, coverStage, pdfHeaderTemplate, pdfFooterTemplate } from './layout.js';

const HF_MARGIN = { top: '22mm', bottom: '22mm', left: '15mm', right: '15mm' };

/** header/footer 옵션을 PdfOptions 로 구성한다 (PDF 전용, 여백 자동 확보). */
function buildPdfOptions(options: ConvertOptions, title: string): PdfOptions {
  const pdf: PdfOptions = { ...(options.pdf ?? {}) };
  if (options.header || options.footer) {
    pdf.displayHeaderFooter = true;
    pdf.headerTemplate = options.header ? pdfHeaderTemplate(title) : '<span></span>';
    pdf.footerTemplate = options.footer ? pdfFooterTemplate() : '<span></span>';
    pdf.margin = pdf.margin ?? HF_MARGIN;
  }
  return pdf;
}

/**
 * markdown 파일을 HTML·PDF 로 변환한다.
 * 파이프라인: parse → transform → template → render. 각 단계는 deps 로 교체 가능하며,
 * 미지정 시 기본 구현을 사용한다. 반환값은 생성된 산출물 경로 목록.
 */
export async function convert(options: ConvertOptions, deps: ConvertDeps = {}): Promise<string[]> {
  const parser = deps.parser ?? createParser();
  // deps.renderer 미공급 시 convert 가 렌더러를 소유하고 종료 시 정리한다(단일 변환 자기완결).
  const ownRenderer = !deps.renderer;
  const renderer = deps.renderer ?? (deps.createRenderer ?? createRenderer)();
  const transforms = deps.transforms ?? [];

  try {
    const inputPath = resolve(options.input);
    const markdown = await readFile(inputPath, 'utf8');
    const stem = basename(inputPath, extname(inputPath));
    const title = options.title ?? stem;
    const theme = await resolveTheme(options.theme);
    const outDir = options.outDir ? resolve(options.outDir) : dirname(inputPath);
    await mkdir(outDir, { recursive: true });

    const ctx: ConvertContext = { title, theme, sourcePath: inputPath };

    // 내장 레이아웃 transform(opt-in) 을 사용자 transform 앞에 배치.
    // 적용 순서: 목차 → 표지 (표지가 최상단에 오도록 마지막 prepend).
    const builtin: TransformStage[] = [];
    if (options.toc) {
      const depth = typeof options.toc === 'object' ? options.toc.depth ?? 3 : 3;
      builtin.push(tocStage(depth));
    }
    if (options.cover) {
      const date = typeof options.cover === 'object' ? options.cover.date : undefined;
      builtin.push(coverStage(title, date));
    }

    let bodyHtml = parser.render(markdown);
    for (const transform of [...builtin, ...transforms]) bodyHtml = transform(bodyHtml, ctx);

    const doc = assembleDocument(bodyHtml, ctx);
    const formats = options.formats ?? ['html', 'pdf'];
    const outputs: string[] = [];

    if (formats.includes('html')) {
      const out = join(outDir, `${stem}.html`);
      await renderer.html(doc, out);
      outputs.push(out);
    }
    if (formats.includes('pdf')) {
      const out = join(outDir, `${stem}.pdf`);
      await renderer.pdf(doc, out, buildPdfOptions(options, title));
      outputs.push(out);
    }
    return outputs;
  } finally {
    if (ownRenderer) await renderer.dispose?.();
  }
}

/** 입력 인자를 실제 파일 목록으로 확장: 디렉터리 → 그 안 `*.md`(비재귀), 파일 → 그대로. 중복 제거·정렬. */
async function expandInputs(inputs: string[]): Promise<string[]> {
  const files = new Set<string>();
  for (const input of inputs) {
    const p = resolve(input);
    const st = await stat(p);
    if (st.isDirectory()) {
      for (const entry of await readdir(p)) {
        if (entry.toLowerCase().endsWith('.md')) files.add(join(p, entry));
      }
    } else {
      files.add(p);
    }
  }
  return [...files].sort();
}

/**
 * 여러 markdown 입력을 일괄 변환한다. 디렉터리 입력은 그 안 `*.md`(비재귀)로 확장한다.
 * PDF 렌더러(브라우저)를 전 입력에 재사용하고 종료 시 1회 정리한다(deps.renderer 미공급 시).
 * 반환값은 생성된 산출물 경로 전체 목록.
 */
export async function convertMany(
  inputs: string[],
  options: Omit<ConvertOptions, 'input'> = {},
  deps: ConvertDeps = {},
): Promise<string[]> {
  const files = await expandInputs(inputs);
  // 매칭 0건을 성공(무동작)으로 흡수하지 않는다 — 변환 대상 부재는 필수 입력 실패로 전파한다.
  if (files.length === 0) {
    throw new Error(
      `변환할 markdown(.md) 파일이 없습니다 (입력: ${inputs.join(', ')}). 디렉터리에 .md 파일이 있는지 확인하세요.`,
    );
  }
  // --title 무시 판정은 CLI 원시 인자 수가 아니라 확장 후 파일 개수 기준 —
  // 단일 디렉터리 입력도 여러 파일로 펼쳐지면 문서마다 같은 제목을 강제하게 되므로.
  let title = options.title;
  if (files.length > 1 && title !== undefined) {
    console.warn(`⚠ 입력이 ${files.length}개라 --title "${title}" 을 무시하고 각 파일명을 제목으로 사용합니다.`);
    title = undefined;
  }
  const ownRenderer = !deps.renderer;
  const renderer = deps.renderer ?? (deps.createRenderer ?? createRenderer)();
  const outputs: string[] = [];
  try {
    for (const file of files) {
      // renderer 를 deps 로 넘겨 convert 가 dispose 하지 않게 한다(convertMany 가 소유·정리).
      const outs = await convert({ ...options, title, input: file }, { ...deps, renderer });
      outputs.push(...outs);
    }
    return outputs;
  } finally {
    if (ownRenderer) await renderer.dispose?.();
  }
}
