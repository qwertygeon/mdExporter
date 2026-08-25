import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const moduleDir = dirname(fileURLToPath(import.meta.url));

// 빌드 후 dist/diagrams.js 기준 → ../vendor/mermaid/mermaid.min.js (vendor 는 dist 옆에 함께 배포)
const BUNDLE_PATH = join(moduleDir, '..', 'vendor', 'mermaid', 'mermaid.min.js');

/** 다이어그램으로 렌더할 코드펜스의 언어 태그. */
export const MERMAID_FENCE_INFO = 'mermaid';

/** 테마가 mermaid 테마 변수(색·글자 등)를 실어 보내는 접두사. */
const THEME_VAR_PREFIX = '--mermaid-';
/** 테마가 mermaid 설정 트리(다이어그램 종류별 레이아웃 등)를 실어 보내는 접두사. */
const CONFIG_PREFIX = '--mermaid-config-';

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
 * 테마 CSS 의 `:root` 선언을 mermaid 설정으로 옮긴다.
 *
 * 디자인·크기 값을 변환기 코드가 아니라 테마 한 곳에 두기 위한 통로다(constitution P-004).
 * 두 갈래를 받는다:
 *
 * - `--mermaid-<키>` → `themeVariables.<키>` (색·글자 등 mermaid 테마 변수)
 * - `--mermaid-config-<경로>` → 설정 트리의 중첩 키 (`--mermaid-config-flowchart-nodeSpacing`
 *   → `{ flowchart: { nodeSpacing: 30 } }`). 다이어그램 종류마다 크기 설정 키가 달라
 *   (flowchart 는 nodeSpacing, sequence 는 width·actorMargin) 몇 개를 골라 뚫지 않고
 *   설정 트리를 그대로 표현할 수 있게 한다.
 *
 * `theme` 을 임의로 지정하지 않는다 — mermaid 내장 테마의 색을 그대로 두기 위함이다.
 * 색 변수(`primaryColor` 등)는 mermaid 의 `base` 테마에서만 반영되므로, 색을 바꾸려는
 * 테마가 `--mermaid-config-theme: base` 를 함께 선언한다. 크기 변수(`fontSize`)는
 * 내장 테마에서도 그대로 반영된다.
 */
export function mermaidConfigFromTheme(themeCss: string): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  const themeVariables: Record<string, unknown> = {};

  for (const block of rootBlocks(stripComments(themeCss))) {
    for (const [name, raw] of declarations(block)) {
      // config 접두사를 테마 변수보다 먼저 본다 — 접두사가 서로 포함 관계라 순서가 의미를 가른다.
      if (name.startsWith(CONFIG_PREFIX)) {
        assignPath(config, name.slice(CONFIG_PREFIX.length).split('-'), coerce(raw));
      } else if (name.startsWith(THEME_VAR_PREFIX)) {
        themeVariables[name.slice(THEME_VAR_PREFIX.length)] = coerce(raw);
      }
    }
  }

  if (Object.keys(themeVariables).length > 0) {
    // 두 표기가 같은 자리를 가리킬 수 있다(`--mermaid-config-themeVariables-*`) — 덮어쓰지 않고 합친다.
    const viaConfig = config.themeVariables;
    config.themeVariables =
      typeof viaConfig === 'object' && viaConfig !== null
        ? { ...(viaConfig as Record<string, unknown>), ...themeVariables }
        : themeVariables;
  }
  return config;
}

/**
 * CSS 주석을 걷어낸다. 주석 안의 예시 선언이 실제 선언으로 읽히지 않게 하기 위함이다
 * (테마는 변수 사용법을 주석으로 설명한다). base64 폰트 데이터에는 `*` 가 없어 안전하다.
 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** `--이름: 값;` 선언을 훑는다. 값은 세미콜론까지(선언 블록 안에는 중괄호가 없다). */
function* declarations(block: string): Generator<[string, string]> {
  const re = /(--[A-Za-z0-9_-]+)\s*:\s*([^;]+);/g;
  for (const m of block.matchAll(re)) yield [m[1], m[2].trim()];
}

/**
 * `:root { ... }` 블록의 본문만 추려낸다. 폰트 base64 처럼 중괄호를 품은 다른 규칙을
 * 건드리지 않도록 선언 블록을 중첩 없이 첫 닫는 중괄호까지로 끊는다.
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

/** 경로를 따라 중첩 객체를 만들며 말단에 값을 넣는다. */
function assignPath(target: Record<string, unknown>, path: string[], value: unknown): void {
  let node = target;
  for (const key of path.slice(0, -1)) {
    const next = node[key];
    if (typeof next !== 'object' || next === null) node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  node[path[path.length - 1]] = value;
}

/**
 * CSS 값은 언제나 문자열이지만 mermaid 설정에는 불리언·수치 키가 있다.
 * `"false"` 는 참으로 취급되므로(문자열) 타입을 되살려 넘긴다.
 * 단위가 붙은 값(`13px`)·색·글꼴 목록은 문자열 그대로 둔다.
 */
function coerce(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}
