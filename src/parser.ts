import MarkdownIt from 'markdown-it';
import type { Parser } from './types.js';

/**
 * 기본 파서 — markdown-it.
 * typographer/linkify 비활성: 원본 문구를 바꾸는 치환(스마트 인용부호·자동 링크화)을
 * 막아 내용 불변 원칙(constitution P-001)을 지킨다.
 */
export function createParser(): Parser {
  const md = new MarkdownIt({ html: true, linkify: false, typographer: false });
  return { render: (markdown: string) => md.render(markdown) };
}
