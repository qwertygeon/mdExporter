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
  .action(async (inputs: string[], opts: CliOptions) => {
    const formats: OutputFormat[] = resolveFormats(opts.format);
    let tocDepth: number | undefined;
    if (opts.tocDepth !== undefined) {
      tocDepth = Number(opts.tocDepth);
      if (!Number.isInteger(tocDepth) || tocDepth < 2) {
        throw new Error(`invalid --toc-depth "${opts.tocDepth}" (expected an integer ≥ 2)`);
      }
    }
    // 다중 입력 시 --title 은 문서마다 같은 제목을 강제하므로 무시(각 파일명 사용).
    let title = opts.title;
    if (inputs.length > 1 && title !== undefined) {
      console.warn(`⚠ 입력이 여러 개라 --title "${title}" 을 무시하고 각 파일명을 제목으로 사용합니다.`);
      title = undefined;
    }
    const outputs = await convertMany(inputs, {
      formats,
      theme: opts.theme,
      title,
      outDir: opts.outDir,
      toc: opts.toc ? (tocDepth !== undefined ? { depth: tocDepth } : true) : undefined,
      cover: opts.cover ? (opts.date ? { date: opts.date } : true) : undefined,
      header: opts.header,
      footer: opts.footer,
    });
    for (const out of outputs) console.log(`✓ ${out}`);
  });

program.parseAsync().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
