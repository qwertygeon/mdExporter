import { readFile, mkdir } from 'node:fs/promises';
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
  const renderer = deps.renderer ?? createRenderer();
  const transforms = deps.transforms ?? [];

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
}
