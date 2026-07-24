#!/usr/bin/env node
import { Command } from 'commander';
import { convert } from './convert.js';
import type { OutputFormat } from './types.js';

interface CliOptions {
  format: string;
  theme?: string;
  title?: string;
  outDir?: string;
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
  .action(async (input: string, opts: CliOptions) => {
    const formats: OutputFormat[] = resolveFormats(opts.format);
    const outputs = await convert({
      input,
      formats,
      theme: opts.theme,
      title: opts.title,
      outDir: opts.outDir,
    });
    for (const out of outputs) console.log(`✓ ${out}`);
  });

program.parseAsync().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
