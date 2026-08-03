import MarkdownIt from 'markdown-it';
import { isEmbeddableRef } from './images.js';
import type { ImageAssets, ImageScan, Parser } from './types.js';

/** 토큰 순회에 필요한 최소 구조 — markdown-it 내부 경로 import 를 피해 구조 타입으로 둔다. */
interface ScanToken {
  type: string;
  content: string;
  children: ScanToken[] | null;
  attrGet(name: string): string | null;
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

  return {
    render: (markdown: string, assets?: ImageAssets) =>
      md.render(markdown, assets ? { assets } : {}),
    scanImages: (markdown: string): ImageScan => {
      const scan: ImageScan = { refs: [], rawHtmlImages: 0 };
      walkTokens(md.parse(markdown, {}) as unknown as ScanToken[], scan);
      return scan;
    },
  };
}
