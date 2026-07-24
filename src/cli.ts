#!/usr/bin/env node
import { Command } from 'commander';
import { convert } from './convert.js';
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
  .argument('<input>', 'input markdown file (.md)')
  .option('-f, --format <format>', 'output: html | pdf | both', 'both')
  .option('-t, --theme <path>', 'CSS theme file (default: built-in)')
  .option('--title <title>', 'HTML <title> (default: filename)')
  .option('-o, --out-dir <dir>', 'output directory (default: alongside input)')
  .option('--toc', 'generate a table of contents')
  .option('--toc-depth <n>', 'TOC heading depth (default 3 = h2–h3)')
  .option('--cover', 'add a cover page')
  .option('--date <date>', 'cover date (shown only when set)')
  .option('--header', 'PDF header with document title')
  .option('--footer', 'PDF footer with page numbers')
  .action(async (input: string, opts: CliOptions) => {
    const formats: OutputFormat[] = resolveFormats(opts.format);
    const outputs = await convert({
      input,
      formats,
      theme: opts.theme,
      title: opts.title,
      outDir: opts.outDir,
      toc: opts.toc ? (opts.tocDepth ? { depth: Number(opts.tocDepth) } : true) : undefined,
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
