import type { ConvertContext } from './types.js';

/** 본문 HTML·테마·제목을 단일 HTML 문서로 조립한다 (HTML/PDF 공용 소스). */
export function assembleDocument(bodyHtml: string, ctx: ConvertContext): string {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(ctx.title)}</title>
<style>
${ctx.theme}
</style>
</head>
<body>
${bodyHtml}
</body>
</html>
`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
