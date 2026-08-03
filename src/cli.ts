#!/usr/bin/env node
import { Command } from 'commander';
import { convertMany } from './convert.js';
import type { OutputFormat } from './types.js';

interface CliOptions {
  format: string;
  theme?: string;
  title?: string;
  outDir?: string;
  toc?: boolean;
  tocDepth?: string;
  cover?: boolean;
  date?: string;
  header?: boolean;
  footer?: boolean;
  recursive?: boolean;
  /** commander 의 `--no-embed-images` 대응 — 플래그 미지정 시 true. */
  embedImages: boolean;
}

function resolveFormats(format: string): OutputFormat[] {
  if (format === 'both') return ['html', 'pdf'];
  if (format === 'html' || format === 'pdf') return [format];
  throw new Error(`invalid --format "${format}" (expected: html | pdf | both)`);
}

const program = new Command();

program
  .name('mdexport')
  .description('Markdown → HTML/PDF exporter (content-preserving, pluggable theme)')
  .argument('<inputs...>', 'input markdown file(s) or directory (shell expands globs like *.md)')
  .option('-f, --format <format>', 'output: html | pdf | both', 'both')
  .option('-t, --theme <path>', 'CSS theme file (default: built-in)')
  .option('--title <title>', 'HTML <title> (default: filename; ignored with multiple inputs)')
  .option('-o, --out-dir <dir>', 'output directory (default: alongside input)')
  .option('--toc', 'generate a table of contents')
  .option('--toc-depth <n>', 'TOC heading depth (default 3 = h2–h3)')
  .option('--cover', 'add a cover page')
  .option('--date <date>', 'cover date (shown only when set)')
  .option('--header', 'PDF header with document title')
  .option('--footer', 'PDF footer with page numbers')
  .option('-r, --recursive', 'recurse into subdirectories of directory inputs (skips dotfiles/node_modules)')
  .option('--no-embed-images', 'keep original image paths instead of inlining local images (smaller output; PDF loses them)')
  .action(async (inputs: string[], opts: CliOptions) => {
    const formats: OutputFormat[] = resolveFormats(opts.format);
    let tocDepth: number | undefined;
    if (opts.tocDepth !== undefined) {
      tocDepth = Number(opts.tocDepth);
      if (!Number.isInteger(tocDepth) || tocDepth < 2) {
        throw new Error(`invalid --toc-depth "${opts.tocDepth}" (expected an integer ≥ 2)`);
      }
    }
    // --title 무시 판정(다중 입력 시)은 convertMany 가 확장 후 파일 개수 기준으로 수행한다.
    const outputs = await convertMany(inputs, {
      formats,
      theme: opts.theme,
      title: opts.title,
      outDir: opts.outDir,
      toc: opts.toc ? (tocDepth !== undefined ? { depth: tocDepth } : true) : undefined,
      cover: opts.cover ? (opts.date ? { date: opts.date } : true) : undefined,
      header: opts.header,
      footer: opts.footer,
      recursive: opts.recursive,
      embedImages: opts.embedImages,
    });
    for (const out of outputs) console.log(`✓ ${out}`);
  });

program.parseAsync().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
