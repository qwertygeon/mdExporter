import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const moduleDir = dirname(fileURLToPath(import.meta.url));

// 빌드 후 dist/theme.js 기준 → ../themes/default.css (themes 는 dist 옆에 함께 배포)
const DEFAULT_THEME = join(moduleDir, '..', 'themes', 'default.css');

/** 테마 경로가 주어지면 그 CSS 를, 아니면 내장 기본 테마를 읽어 반환한다. */
export async function resolveTheme(themePath?: string): Promise<string> {
  return readFile(themePath ?? DEFAULT_THEME, 'utf8');
}
