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
  /** 디렉터리 입력을 하위 트리까지 순회. convertMany 만 소비(convert 는 무시). 기본 undefined(=비재귀) */
  recursive?: boolean;
  /**
   * 로컬 이미지를 data URI 로 본문에 인라인. 기본 true.
   * false 면 원본 src 를 유지한다 — 산출물이 작아지는 대신 PDF·다른 폴더 출력에서 이미지가 보이지 않는다.
   */
  embedImages?: boolean;
  /**
   * ```mermaid 펜스를 다이어그램(SVG)으로 렌더해 본문에 인라인. 기본 true.
   * false 면 종전처럼 코드블록으로 남으며 브라우저를 띄우지 않는다.
   */
  mermaid?: boolean;
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

/** 이미지 참조 → data URI. 임베딩된 것만 담긴다(원격·미지원·미발견은 부재). */
export type ImageAssets = ReadonlyMap<string, string>;

/** 본문 이미지 참조 조사 결과 */
export interface ImageScan {
  /** 이미지 문법으로 등장한 src 값 (원격 포함 — 임베딩 대상 선별은 자산 해석 단계가 한다) */
  refs: string[];
  /** 원시 HTML `<img>` 개수. 파서 렌더 규칙이 닿지 않아 임베딩 대상 밖이다 */
  rawHtmlImages: number;
}

/**
 * 등장 순서대로의 다이어그램 SVG. 렌더하지 못한 자리는 `undefined` 이며 원본 코드블록이 남는다.
 * 이미지 자산과 달리 소스가 아니라 **등장 순서**로 키잉한다 — 같은 소스가 두 번 나와도 각각
 * 고유한 SVG 를 받아 문서 안에서 element id 가 겹치지 않는다.
 */
export type DiagramAssets = readonly (string | undefined)[];

/** 본문 mermaid 펜스 조사 결과 */
export interface DiagramScan {
  /** 등장 순서의 mermaid 소스 */
  sources: string[];
}

/** 다이어그램 렌더 요청 */
export interface DiagramRenderRequest {
  sources: readonly string[];
  /** 브라우저에 주입할 mermaid 번들 파일 경로 */
  bundlePath: string;
  /**
   * 렌더 페이지에 적용할 테마 CSS. mermaid 는 라벨의 실측 폭으로 도형 크기를 정하므로
   * 최종 문서와 같은 폰트를 써야 한글 라벨이 상자를 넘치지 않는다.
   */
  themeCss: string;
  /** mermaid.initialize 설정 (테마 CSS 의 --mermaid-* 변수에서 도출) */
  config: Record<string, unknown>;
}

/** 다이어그램 렌더 결과. 개별 실패는 흡수하지 않고 분류해 돌려준다. */
export interface DiagramRenderResult {
  /** 요청 순서와 같은 길이. 실패한 자리는 undefined */
  svgs: DiagramAssets;
  /** 개별 다이어그램 실패 (요청 인덱스 + 사유) */
  failures: Array<{ index: number; message: string }>;
  /** 전량을 렌더하지 못한 사유 (브라우저 기동 불가 등). 있으면 svgs 는 모두 undefined */
  unavailable?: string;
}

/** markdown → 본문 HTML */
export interface Parser {
  /**
   * assets 가 주어지면 해당 이미지 참조를 data URI 로 치환하고,
   * diagrams 가 주어지면 mermaid 펜스를 등장 순서대로 SVG 로 치환해 렌더한다.
   */
  render(markdown: string, assets?: ImageAssets, diagrams?: DiagramAssets): string;
  /** 본문 이미지 참조 조사. 미구현 시 convert 는 이미지 임베딩을 건너뛴다. */
  scanImages?(markdown: string): ImageScan;
  /** 본문 mermaid 펜스 조사. 미구현 시 convert 는 다이어그램 렌더를 건너뛴다. */
  scanDiagrams?(markdown: string): DiagramScan;
}

/**
 * 조립된 HTML 문서 → 산출물. 브라우저를 소유하는 주체이기도 하여,
 * 브라우저가 필요한 다이어그램 렌더도 같은 인스턴스를 재사용해 수행한다.
 */
export interface Renderer {
  html(doc: string, outPath: string): Promise<void>;
  pdf(doc: string, outPath: string, pdf: PdfOptions): Promise<void>;
  /** mermaid 소스 → SVG. 미구현 시 convert 는 다이어그램 렌더를 건너뛴다. */
  renderDiagrams?(request: DiagramRenderRequest): Promise<DiagramRenderResult>;
  /** 재사용 리소스(브라우저 등) 정리 — 렌더러 소유자가 작업 종료 시 1회 호출. */
  dispose?(): Promise<void>;
}

/** convert() 에 주입 가능한 구현들. 미지정 시 기본 구현 사용. */
export interface ConvertDeps {
  parser?: Parser;
  renderer?: Renderer;
  transforms?: TransformStage[];
  /**
   * 소유 렌더러 팩토리. renderer 미공급 시 이 팩토리로 렌더러를 생성하며,
   * 생성된 렌더러는 여전히 convert/convertMany 소유(종료 시 dispose). 기본: createRenderer.
   */
  createRenderer?: () => Renderer;
}
