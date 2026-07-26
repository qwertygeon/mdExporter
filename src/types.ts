/** 변환 파이프라인 공개 타입 — 확장 지점(교체 가능한 단계)의 계약. */

export interface PdfOptions {
  format?: string;
  margin?: { top?: string; bottom?: string; left?: string; right?: string };
  printBackground?: boolean;
  /** 페이지 헤더/푸터 표시 (Playwright) */
  displayHeaderFooter?: boolean;
  headerTemplate?: string;
  footerTemplate?: string;
}

export interface ConvertOptions {
  /** 입력 markdown 파일 경로 */
  input: string;
  /** 산출 포맷. 기본 ['html', 'pdf'] */
  formats?: OutputFormat[];
  /** 테마 CSS 파일 경로. 미지정 시 내장 기본 테마 */
  theme?: string;
  /** HTML <title>. 미지정 시 입력 파일명(확장자 제외) */
  title?: string;
  /** 출력 디렉터리. 미지정 시 입력과 같은 폴더 */
  outDir?: string;
  /** PDF 페이지 옵션 */
  pdf?: PdfOptions;
  /** 자동 목차 생성. true 또는 { depth } (기본 depth 3 = h2~h3) */
  toc?: boolean | { depth?: number };
  /** 표지 페이지. true 또는 { date }(표시할 날짜, 미지정 시 날짜 없음) */
  cover?: boolean | { date?: string };
  /** PDF 헤더(문서 제목) — PDF 전용 */
  header?: boolean;
  /** PDF 푸터(페이지 번호) — PDF 전용 */
  footer?: boolean;
}

export type OutputFormat = 'html' | 'pdf';

/** transform 단계가 참조하는 문서 컨텍스트 */
export interface ConvertContext {
  title: string;
  /** 해석된 테마 CSS 텍스트 */
  theme: string;
  sourcePath: string;
}

/** 본문 HTML 을 가공하는 확장 훅 (예: 후속 spec 의 목차·표지 주입) */
export type TransformStage = (bodyHtml: string, ctx: ConvertContext) => string;

/** markdown → 본문 HTML */
export interface Parser {
  render(markdown: string): string;
}

/** 조립된 HTML 문서 → 산출물 */
export interface Renderer {
  html(doc: string, outPath: string): Promise<void>;
  pdf(doc: string, outPath: string, pdf: PdfOptions): Promise<void>;
  /** 재사용 리소스(브라우저 등) 정리 — 렌더러 소유자가 작업 종료 시 1회 호출. */
  dispose?(): Promise<void>;
}

/** convert() 에 주입 가능한 구현들. 미지정 시 기본 구현 사용. */
export interface ConvertDeps {
  parser?: Parser;
  renderer?: Renderer;
  transforms?: TransformStage[];
}
