import type { TransformStage } from './types.js';

/** 문서 레이아웃 확장 — 목차·표지(본문 HTML transform), PDF 헤더/푸터 템플릿. 모두 opt-in. */

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function slugify(text: string): string {
  const s = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'section';
}

/**
 * 헤딩(h2~h{depth})에 id 를 부여하고 목차 목록을 본문 앞에 삽입한다.
 * markdown-it 기본 헤딩 출력(`<h2>텍스트</h2>`)을 전제로 한다. 헤딩 텍스트는 보존(id 속성만 추가).
 */
export function tocStage(depth = 3): TransformStage {
  const maxLevel = Math.max(2, depth);
  return (bodyHtml) => {
    const seen = new Map<string, number>();
    const items: { level: number; id: string; text: string }[] = [];
    const withIds = bodyHtml.replace(
      /<h([1-6])>([\s\S]*?)<\/h\1>/g,
      (match, lvlStr: string, inner: string) => {
        const level = Number(lvlStr);
        if (level < 2 || level > maxLevel) return match;
        const text = stripTags(inner).trim();
        let id = slugify(text);
        const count = seen.get(id) ?? 0;
        seen.set(id, count + 1);
        if (count > 0) id = `${id}-${count + 1}`;
        items.push({ level, id, text });
        return `<h${level} id="${id}">${inner}</h${level}>`;
      },
    );
    if (items.length === 0) return withIds;
    const list = items
      .map((it) => `<li class="toc-l${it.level}"><a href="#${it.id}">${escapeText(it.text)}</a></li>`)
      .join('\n');
    return `<nav class="toc"><ul>\n${list}\n</ul></nav>\n${withIds}`;
  };
}

/** 표지 섹션(제목 + 선택 날짜)을 본문 최상단에 삽입한다. */
export function coverStage(title: string, date?: string): TransformStage {
  return (bodyHtml) => {
    const dateHtml = date ? `<p class="cover-date">${escapeText(date)}</p>` : '';
    const cover = `<section class="cover"><h1 class="cover-title">${escapeText(title)}</h1>${dateHtml}</section>\n`;
    return cover + bodyHtml;
  };
}

const HF_STYLE = 'font-size:9px; width:100%; text-align:center; color:#666; padding:0 15mm;';

/** PDF 헤더 템플릿 — 문서 제목. (Playwright: 템플릿 기본 font-size 가 0 이라 명시 필요) */
export function pdfHeaderTemplate(title: string): string {
  return `<div style="${HF_STYLE}">${escapeText(title)}</div>`;
}

/** PDF 푸터 템플릿 — 페이지 번호(현재 / 전체). */
export function pdfFooterTemplate(): string {
  return `<div style="${HF_STYLE}"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`;
}
