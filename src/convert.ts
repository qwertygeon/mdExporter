import { readFile, mkdir } from 'node:fs/promises';
import { basename, extname, join, resolve, dirname } from 'node:path';
import type { ConvertContext, ConvertDeps, ConvertOptions } from './types.js';
import { createParser } from './parser.js';
import { createRenderer } from './renderer.js';
import { resolveTheme } from './theme.js';
import { assembleDocument } from './template.js';

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

  let bodyHtml = parser.render(markdown);
  for (const transform of transforms) bodyHtml = transform(bodyHtml, ctx);

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
    await renderer.pdf(doc, out, options.pdf ?? {});
    outputs.push(out);
  }
  return outputs;
}
