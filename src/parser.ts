import MarkdownIt from 'markdown-it';
import { isEmbeddableRef } from './images.js';
import { MERMAID_FENCE_INFO } from './diagrams.js';
import type { DiagramAssets, DiagramScan, ImageAssets, ImageScan, Parser } from './types.js';

/** 토큰 순회에 필요한 최소 구조 — markdown-it 내부 경로 import 를 피해 구조 타입으로 둔다. */
interface ScanToken {
  type: string;
  info: string;
  content: string;
  children: ScanToken[] | null;
  attrGet(name: string): string | null;
}

/**
 * 원시 HTML 조각에서 mermaid 컨테이너(`class` 에 `mermaid` 를 단 요소) 수를 센다.
 * 주석 안의 태그는 렌더되지 않으므로 먼저 걷어낸다. 여기서 하는 일은 탐지뿐이다 —
 * 원시 HTML 은 fence 렌더 규칙이 닿지 않아 다이어그램으로 그려지지 않으며, 경고 없이
 * 원문 그대로 남으면 사용자가 이유를 알 수 없다.
 */
function countRawMermaidContainers(html: string): number {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, '');
  let count = 0;
  for (const tag of withoutComments.match(/<[a-zA-Z][^>]*>/g) ?? []) {
    const cls = /\sclass\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const value = cls?.[2] ?? cls?.[3] ?? cls?.[4] ?? '';
    if (value.split(/\s+/).includes('mermaid')) count += 1;
  }
  return count;
}

/** 코드펜스 info 문자열에서 언어 태그만 뽑는다 (```mermaid, ```mermaid extra 모두 대응). */
function fenceLang(info: string): string {
  return info.trim().split(/\s+/, 1)[0].toLowerCase();
}

/**
 * 원시 HTML 조각에서 **로컬 이미지를 가리키는** `<img>` 태그 수를 센다.
 * 주석 안의 태그는 렌더되지 않으므로 먼저 걷어내고, 원격·data 참조는 애초에 임베딩 대상이
 * 아니므로(markdown 문법으로 바꿔도 임베딩되지 않는다) 세지 않는다 — 경고 오탐 방지.
 * 여기서 하는 일은 탐지뿐이며 태그를 재작성하지 않는다.
 */
function countLocalImgTags(html: string): number {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, '');
  let count = 0;
  for (const tag of withoutComments.match(/<img\b[^>]*>/gi) ?? []) {
    const src = /\ssrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const value = src?.[2] ?? src?.[3] ?? src?.[4] ?? '';
    if (isEmbeddableRef(value)) count += 1;
  }
  return count;
}

function walkTokens(tokens: readonly ScanToken[], scan: ImageScan): void {
  for (const token of tokens) {
    if (token.type === 'image') {
      const src = token.attrGet('src');
      if (src) scan.refs.push(src);
    } else if (token.type === 'html_block' || token.type === 'html_inline') {
      scan.rawHtmlImages += countLocalImgTags(token.content);
    }
    if (token.children) walkTokens(token.children, scan);
  }
}

/**
 * 기본 파서 — markdown-it.
 * typographer/linkify 비활성: 원본 문구를 바꾸는 치환(스마트 인용부호·자동 링크화)을
 * 막아 내용 불변 원칙(constitution P-001)을 지킨다.
 *
 * 이미지 src 치환은 렌더 결과 HTML 정규식이 아니라 image 렌더 규칙에서 토큰 속성으로 수행한다 —
 * 속성 순서·인용부호·속성값 내부 `>` 에 영향받지 않는다.
 */
export function createParser(): Parser {
  const md = new MarkdownIt({ html: true, linkify: false, typographer: false });

  const defaultImage =
    md.renderer.rules.image ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const src = token.attrGet('src');
    const assets = (env as { assets?: ImageAssets } | undefined)?.assets;
    const embedded = src ? assets?.get(src) : undefined;
    if (embedded) token.attrSet('src', embedded);
    return defaultImage(tokens, idx, options, env, self);
  };

  const defaultFence =
    md.renderer.rules.fence ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

  // mermaid 펜스를 미리 렌더해 둔 SVG 로 바꾼다. 자산이 없거나(옵션 off·렌더 실패) 다른 언어면
  // 기본 코드블록 렌더를 그대로 쓴다 — 실패해도 원본이 남는다.
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    if (fenceLang(tokens[idx].info) !== MERMAID_FENCE_INFO) {
      return defaultFence(tokens, idx, options, env, self);
    }
    const scope = env as { diagrams?: DiagramAssets; diagramIndex?: number } | undefined;
    if (!scope?.diagrams) return defaultFence(tokens, idx, options, env, self);
    // 조사 순서와 같은 등장 순서로 소비한다(둘 다 같은 토큰 스트림을 앞에서부터 훑는다).
    const at = scope.diagramIndex ?? 0;
    scope.diagramIndex = at + 1;
    const diagram = scope.diagrams[at];
    if (!diagram) return defaultFence(tokens, idx, options, env, self);
    // 고유 치수를 CSS 변수로 실어 보낸다 — 테마가 "얼마까지 줄일지" 같은 크기 정책을
    // 직접 쓸 수 있게 하기 위함이다(변환기는 사실만 넘기고 정책은 테마가 가진다).
    const vars = `--mdx-diagram-w:${diagram.width}px;--mdx-diagram-h:${diagram.height}px`;
    return `<figure class="mermaid" style="${vars}">${diagram.svg}</figure>\n`;
  };

  return {
    render: (markdown: string, assets?: ImageAssets, diagrams?: DiagramAssets) =>
      md.render(markdown, { ...(assets ? { assets } : {}), ...(diagrams ? { diagrams } : {}) }),
    scanImages: (markdown: string): ImageScan => {
      const scan: ImageScan = { refs: [], rawHtmlImages: 0 };
      walkTokens(md.parse(markdown, {}) as unknown as ScanToken[], scan);
      return scan;
    },
    scanDiagrams: (markdown: string): DiagramScan => {
      const scan: DiagramScan = { sources: [], rawHtmlDiagrams: 0 };
      // 코드펜스는 블록 토큰이라 평탄한 스트림에만 나타난다(인라인 children 미포함).
      // 원시 HTML 은 html_block/html_inline 으로 통과하므로 같은 순회에서 세어 경고한다.
      for (const token of md.parse(markdown, {}) as unknown as ScanToken[]) {
        if (token.type === 'fence' && fenceLang(token.info) === MERMAID_FENCE_INFO) {
          scan.sources.push(token.content);
        } else if (token.type === 'html_block' || token.type === 'html_inline') {
          scan.rawHtmlDiagrams += countRawMermaidContainers(token.content);
        }
      }
      return scan;
    },
  };
}
