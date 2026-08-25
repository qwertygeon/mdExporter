import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const moduleDir = dirname(fileURLToPath(import.meta.url));

// 빌드 후 dist/diagrams.js 기준 → ../vendor/mermaid/mermaid.min.js (vendor 는 dist 옆에 함께 배포)
const BUNDLE_PATH = join(moduleDir, '..', 'vendor', 'mermaid', 'mermaid.min.js');

/** 다이어그램으로 렌더할 코드펜스의 언어 태그. */
export const MERMAID_FENCE_INFO = 'mermaid';

/** 테마가 mermaid 설정을 실어 보내는 CSS 변수 접두사. */
const THEME_VAR_PREFIX = '--mermaid-';

/**
 * 번들 경로를 돌려준다. 파일이 없으면 undefined —
 * 호출자는 브라우저를 띄우지 않고 다이어그램 렌더를 건너뛴다.
 */
export async function resolveMermaidBundle(): Promise<string | undefined> {
  try {
    await access(BUNDLE_PATH);
    return BUNDLE_PATH;
  } catch {
    return undefined;
  }
}

/**
 * 테마 CSS 의 `:root` 에 선언된 `--mermaid-<키>` 변수를 mermaid 설정으로 옮긴다.
 *
 * 디자인 값을 변환기 코드가 아니라 테마 한 곳에 두기 위한 통로다(constitution P-004).
 * 선언이 하나도 없으면 빈 설정을 돌려주고, 그 경우 mermaid 내장 테마가 그대로 적용된다.
 * 선언이 있으면 `theme: 'base'` 를 함께 지정한다 — 내장 테마는 자기 색을 우선하므로
 * 테마 변수를 반영하려면 base 를 골라야 한다.
 */
export function mermaidConfigFromTheme(themeCss: string): Record<string, unknown> {
  const themeVariables: Record<string, string> = {};
  for (const block of rootBlocks(themeCss)) {
    const re = new RegExp(`${THEME_VAR_PREFIX}([A-Za-z0-9_-]+)\\s*:\\s*([^;]+);`, 'g');
    for (const m of block.matchAll(re)) {
      themeVariables[m[1]] = m[2].trim();
    }
  }
  if (Object.keys(themeVariables).length === 0) return {};
  return { theme: 'base', themeVariables };
}

/**
 * `:root { ... }` 블록의 본문만 추려낸다. 폰트 base64 처럼 중괄호가 들어간 다른 규칙을
 * 건드리지 않도록 선언 블록을 중첩 없이 첫 닫는 중괄호까지로 끊는다
 * (CSS 선언 블록 안에는 중괄호가 나오지 않는다).
 */
function* rootBlocks(css: string): Generator<string> {
  const re = /:root\s*\{/g;
  for (const m of css.matchAll(re)) {
    const start = m.index + m[0].length;
    const end = css.indexOf('}', start);
    if (end === -1) continue;
    yield css.slice(start, end);
  }
}
