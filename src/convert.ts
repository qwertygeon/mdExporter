import { readFile, mkdir, readdir, stat, realpath, writeFile, rm } from 'node:fs/promises';
import { basename, extname, join, resolve, dirname, relative } from 'node:path';
import type {
  ConvertContext,
  ConvertDeps,
  ConvertOptions,
  DiagramAssets,
  ImageAssets,
  Parser,
  PdfOptions,
  Renderer,
  TransformStage,
} from './types.js';
import { createParser } from './parser.js';
import { createRenderer } from './renderer.js';
import { resolveTheme } from './theme.js';
import { assembleDocument } from './template.js';
import { tocStage, coverStage, pdfHeaderTemplate, pdfFooterTemplate } from './layout.js';
import { loadImageAssets } from './images.js';
import { mermaidConfigFromTheme, resolveMermaidBundle } from './diagrams.js';

const HF_MARGIN = { top: '22mm', bottom: '22mm', left: '15mm', right: '15mm' };

/** header/footer 옵션을 PdfOptions 로 구성한다 (PDF 전용, 여백 자동 확보). */
function buildPdfOptions(options: ConvertOptions, title: string): PdfOptions {
  const pdf: PdfOptions = { ...(options.pdf ?? {}) };
  if (options.header || options.footer) {
    pdf.displayHeaderFooter = true;
    pdf.headerTemplate = options.header ? pdfHeaderTemplate(title) : '<span></span>';
    pdf.footerTemplate = options.footer ? pdfFooterTemplate() : '<span></span>';
    pdf.margin = pdf.margin ?? HF_MARGIN;
  }
  return pdf;
}

/**
 * 본문의 로컬 이미지를 data URI 로 인라인할 자산 Map 을 만든다.
 * 임베딩하지 않으면 PDF 는 base URL 이 없어(setContent) 상대경로 이미지를 전부 잃고,
 * HTML 도 `--out-dir` 로 다른 폴더에 쓰면 경로가 어긋난다.
 *
 * 읽지 못한 참조·지원하지 않는 확장자는 경고만 하고 원본 src 를 남긴다 — 개별 이미지는
 * 문서 산출의 필수 입력이 아니므로 문서 전체 변환을 실패시키지 않는다(침묵은 하지 않는다).
 */
async function resolveImageAssets(
  parser: Parser,
  markdown: string,
  inputPath: string,
  embed: boolean,
): Promise<ImageAssets | undefined> {
  if (!embed || !parser.scanImages) return undefined;
  const warn = (message: string) => console.warn(`경고: ${inputPath} — ${message}`);

  const scan = parser.scanImages(markdown);
  if (scan.rawHtmlImages > 0) {
    warn(
      `원시 HTML <img> ${scan.rawHtmlImages}개는 임베딩 대상이 아닙니다(markdown 이미지 문법 ![](경로) 로 쓰면 임베딩됩니다).`,
    );
  }
  if (scan.refs.length === 0) return undefined;

  const result = await loadImageAssets(scan.refs, dirname(inputPath));
  for (const { ref, code } of result.missing) {
    warn(
      code && code !== 'ENOENT'
        ? `이미지를 읽을 수 없습니다(${code}): ${ref}`
        : `이미지를 찾을 수 없습니다: ${ref}`,
    );
  }
  for (const ref of result.unsupported) {
    warn(`이미지 확장자가 아니라 임베딩하지 않았습니다: ${ref}`);
  }
  for (const ref of result.empty) {
    warn(`이미지 파일이 비어 있습니다(0바이트): ${ref}`);
  }
  for (const ref of result.caseMismatch) {
    warn(
      `참조의 대소문자가 실제 파일명과 다릅니다: ${ref} — 대소문자를 구분하는 환경(리눅스 등)에서는 찾지 못합니다.`,
    );
  }
  return result.assets.size > 0 ? result.assets : undefined;
}

/** 여러 줄로 오는 파서 오류 메시지를 경고 한 줄로 접는다. */
function oneLine(message: string): string {
  return message.replace(/\s+/g, ' ').trim();
}

/**
 * 본문의 mermaid 펜스를 SVG 로 렌더한 자산 배열을 만든다(등장 순서).
 *
 * 렌더하지 못한 자리는 undefined 로 남아 원본 코드블록이 그대로 출력된다 — 개별 다이어그램은
 * 문서 산출의 필수 입력이 아니므로 문서 전체 변환을 실패시키지 않는다(침묵은 하지 않는다).
 * 브라우저가 필요하므로 mermaid 펜스가 하나도 없으면 렌더러를 건드리지 않는다.
 */
async function resolveDiagramAssets(
  parser: Parser,
  renderer: Renderer,
  markdown: string,
  inputPath: string,
  themeCss: string,
  enabled: boolean,
): Promise<DiagramAssets | undefined> {
  if (!enabled || !parser.scanDiagrams || !renderer.renderDiagrams) return undefined;
  const warn = (message: string) => console.warn(`경고: ${inputPath} — ${message}`);

  const { sources } = parser.scanDiagrams(markdown);
  if (sources.length === 0) return undefined;

  const bundlePath = await resolveMermaidBundle();
  if (!bundlePath) {
    warn(
      `mermaid 번들이 없어 다이어그램 ${sources.length}개를 코드블록으로 남깁니다(vendor/mermaid/mermaid.min.js 부재 — 개발 저장소라면 node scripts/build-mermaid.mjs 로 생성합니다).`,
    );
    return undefined;
  }

  const result = await renderer.renderDiagrams({
    sources,
    bundlePath,
    themeCss,
    config: mermaidConfigFromTheme(themeCss),
  });
  if (result.unavailable) {
    warn(
      `브라우저를 띄울 수 없어 다이어그램 ${sources.length}개를 코드블록으로 남깁니다(${oneLine(result.unavailable)}). PDF 와 마찬가지로 npx playwright install chromium 이 필요합니다.`,
    );
    return undefined;
  }
  for (const { index, message } of result.failures) {
    warn(`${index + 1}번째 다이어그램을 렌더하지 못해 코드블록으로 남깁니다: ${oneLine(message)}`);
  }
  return result.svgs.some((svg) => svg !== undefined) ? result.svgs : undefined;
}

/**
 * markdown 파일을 HTML·PDF 로 변환한다.
 * 파이프라인: parse → transform → template → render. 각 단계는 deps 로 교체 가능하며,
 * 미지정 시 기본 구현을 사용한다. 반환값은 생성된 산출물 경로 목록.
 */
export async function convert(options: ConvertOptions, deps: ConvertDeps = {}): Promise<string[]> {
  const parser = deps.parser ?? createParser();
  // deps.renderer 미공급 시 convert 가 렌더러를 소유하고 종료 시 정리한다(단일 변환 자기완결).
  const ownRenderer = !deps.renderer;
  const renderer = deps.renderer ?? (deps.createRenderer ?? createRenderer)();
  const transforms = deps.transforms ?? [];

  try {
    const inputPath = resolve(options.input);
    const markdown = await readFile(inputPath, 'utf8');
    const stem = basename(inputPath, extname(inputPath));
    const title = options.title ?? stem;
    const theme = await resolveTheme(options.theme);
    const outDir = options.outDir ? resolve(options.outDir) : dirname(inputPath);
    await mkdir(outDir, { recursive: true });

    const ctx: ConvertContext = { title, theme, sourcePath: inputPath };

    // 내장 레이아웃 transform(opt-in) 을 사용자 transform 앞에 배치.
    // 적용 순서: 목차 → 표지 (표지가 최상단에 오도록 마지막 prepend).
    const builtin: TransformStage[] = [];
    if (options.toc) {
      const depth = typeof options.toc === 'object' ? options.toc.depth ?? 3 : 3;
      builtin.push(tocStage(depth));
    }
    if (options.cover) {
      const date = typeof options.cover === 'object' ? options.cover.date : undefined;
      builtin.push(coverStage(title, date));
    }

    const assets = await resolveImageAssets(parser, markdown, inputPath, options.embedImages ?? true);
    const diagrams = await resolveDiagramAssets(
      parser,
      renderer,
      markdown,
      inputPath,
      theme,
      options.mermaid ?? true,
    );
    let bodyHtml = parser.render(markdown, assets, diagrams);
    for (const transform of [...builtin, ...transforms]) bodyHtml = transform(bodyHtml, ctx);

    const doc = assembleDocument(bodyHtml, ctx);
    const formats = options.formats ?? ['html', 'pdf'];
    const outputs: string[] = [];

    if (formats.includes('html')) {
      const out = join(outDir, `${stem}.html`);
      await renderer.html(doc, out);
      outputs.push(out);
    }
    if (formats.includes('pdf')) {
      const out = join(outDir, `${stem}.pdf`);
      await renderer.pdf(doc, out, buildPdfOptions(options, title));
      outputs.push(out);
    }
    return outputs;
  } finally {
    if (ownRenderer) await renderer.dispose?.();
  }
}

/** found 맵에 절대 파일경로가 아직 없을 때만 root 를 등록한다(dedup, first-wins root). */
function setIfAbsent(found: Map<string, string>, file: string, root: string): void {
  if (!found.has(file)) found.set(file, root);
}

/**
 * 디렉터리 하위 트리를 재귀 순회해 `.md` 파일을 found 에 수집한다.
 * `Dirent.isDirectory()` 는 심링크를 따르지 않아 디렉터리 심링크는 하강 대상에서 자연 제외되고,
 * realpath 기반 visited 세트가 이를 이중으로 방어해 순환을 종료한다.
 */
async function walk(dir: string, root: string, visited: Set<string>, found: Map<string, string>): Promise<void> {
  const real = await realpath(dir);
  if (visited.has(real)) return;
  visited.add(real);
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue;
      if (entry.name === 'node_modules') continue;
      await walk(join(dir, entry.name), root, visited, found);
    } else if (entry.name.toLowerCase().endsWith('.md')) {
      setIfAbsent(found, join(dir, entry.name), root);
    }
  }
}

/**
 * 입력 인자를 실제 파일 목록으로 확장: 디렉터리 → 그 안 `*.md`(recursive=false 시 비재귀,
 * recursive=true 시 하위 트리 전부), 파일 → 그대로. 중복 제거(절대 파일경로, first-wins root)·정렬.
 * 반환 원소의 `root` 는 미러 출력 기준 discovery-root(파일 인자는 그 파일의 부모 디렉터리).
 */
async function expandInputs(inputs: string[], recursive: boolean): Promise<Array<{ file: string; root: string }>> {
  const found = new Map<string, string>();
  for (const input of inputs) {
    const p = resolve(input);
    let st;
    try {
      st = await stat(p);
    } catch (err) {
      // 존재하지 않는 경로는 저수준 ENOENT 대신 친절한 메시지로 전파한다(흡수 아님 — 필수 입력 실패).
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`입력 경로를 찾을 수 없습니다: ${input}`, { cause: err });
      }
      throw err;
    }
    if (st.isDirectory()) {
      if (recursive) {
        await walk(p, p, new Set<string>(), found);
      } else {
        for (const entry of await readdir(p, { withFileTypes: true })) {
          // 이름이 .md 로 끝나는 하위 디렉터리를 파일로 오인하지 않는다(이후 readFile EISDIR 방지).
          if (entry.isDirectory()) continue;
          if (entry.name.toLowerCase().endsWith('.md')) setIfAbsent(found, join(p, entry.name), p);
        }
      }
    } else {
      setIfAbsent(found, p, dirname(p));
    }
  }
  return [...found].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([file, root]) => ({ file, root }));
}

/** dir 의 조상 중 실재하는 가장 가까운 디렉터리를 찾는다(아직 생성되지 않은 출력 하위 경로 대비). */
async function nearestExistingDir(dir: string): Promise<string> {
  let d = resolve(dir);
  for (;;) {
    try {
      await stat(d);
      return d;
    } catch {
      const parent = dirname(d);
      if (parent === d) return d; // 루트 도달
      d = parent;
    }
  }
}

let caseProbeCounter = 0;

/**
 * dir 이 속한 파일시스템이 대소문자를 구분하지 않는지 실측한다(mount 속성이라 device 단위 캐시).
 * 임시 프로브 파일을 만들어 대소문자를 뒤집은 이름이 같은 inode 로 보이는지 확인하고 즉시 제거한다.
 * 프로브 불가 시(권한 등) 플랫폼 기본값(macOS·Windows = 대소문자 무시)으로 안전하게 폴백한다.
 */
async function isCaseInsensitiveFs(dir: string, cache: Map<number, boolean>): Promise<boolean> {
  const platformDefault = process.platform === 'darwin' || process.platform === 'win32';
  const base = await nearestExistingDir(dir);
  let dev: number;
  try {
    dev = (await stat(base)).dev;
  } catch {
    return platformDefault;
  }
  const cached = cache.get(dev);
  if (cached !== undefined) return cached;

  const name = `.mdexport-Case-Probe-${process.pid}-${caseProbeCounter++}`;
  const upper = join(base, name);
  const lower = join(base, name.toLowerCase());
  let result: boolean;
  try {
    await writeFile(upper, '');
    try {
      const a = await stat(upper);
      const b = await stat(lower);
      result = a.ino === b.ino; // 뒤집은 이름이 같은 파일 → 대소문자 무시
    } catch {
      result = false; // 뒤집은 이름이 없음 → 대소문자 구분
    }
  } catch {
    result = platformDefault; // 프로브 파일 생성 실패 → 플랫폼 기본값
  } finally {
    await rm(upper, { force: true });
  }
  cache.set(dev, result);
  return result;
}

/**
 * 여러 markdown 입력을 일괄 변환한다. 디렉터리 입력은 `options.recursive` 에 따라
 * 비재귀(그 안 `*.md`만) 또는 하위 트리 전부로 확장된다. 재귀 시 `--out-dir` 아래에
 * 스캔 루트 기준 상대경로를 그대로 미러링해 하위 구조를 보존한다(비재귀·`--out-dir` 미지정 시 기존 동작 불변).
 * PDF 렌더러(브라우저)를 전 입력에 재사용하고 종료 시 1회 정리한다(deps.renderer 미공급 시).
 * 반환값은 생성된 산출물 경로 전체 목록.
 */
export async function convertMany(
  inputs: string[],
  options: Omit<ConvertOptions, 'input'> = {},
  deps: ConvertDeps = {},
): Promise<string[]> {
  const expanded = await expandInputs(inputs, options.recursive ?? false);
  // 매칭 0건을 성공(무동작)으로 흡수하지 않는다 — 변환 대상 부재는 필수 입력 실패로 전파한다.
  if (expanded.length === 0) {
    throw new Error(
      `변환할 markdown(.md) 파일이 없습니다 (입력: ${inputs.join(', ')}). 디렉터리에 .md 파일이 있는지 확인하세요.`,
    );
  }
  // per-file 미러 출력 디렉터리를 한 번만 계산해 충돌검사·convert 호출 양쪽에 동일 값으로 재사용한다.
  const entries = expanded.map(({ file, root }) => ({
    file,
    effectiveOutDir: options.outDir ? join(resolve(options.outDir), relative(root, dirname(file))) : undefined,
  }));
  // 산출 경로 충돌 사전 감지(2-pass): 서로 다른 입력이 같은 출력 경로로 써지면 앞선 산출물이 조용히
  // 유실되므로 차단한다(예: 서로 다른 폴더의 동명 파일을 하나의 --out-dir 로 모으는 경우. 미러 경로
  // 기준이라 서로 다른 하위 폴더의 동명 파일은 오탐하지 않는다).
  // Pass 1(I/O 0): 원본 대소문자 그대로의 정확 충돌을 전 플랫폼에서 잡고, 대소문자만 다른 후보만 그룹핑.
  // Pass 2(프로브는 여기서만): 그런 후보가 실제로 있을 때만 파일시스템 대소문자 구분 여부를 실측한다
  // — 대소문자 무시 FS(macOS·Windows)는 같은 파일로 덮어써지므로 충돌, 구분 FS 는 정당한 별개 파일.
  // 단일 파일·대소문자 충돌 없는 일반 변환에서는 프로브가 발생하지 않는다.
  const exactSeen = new Map<string, string>();
  const foldedGroups = new Map<string, Array<{ file: string; keyDir: string; rawKey: string }>>();
  for (const { file, effectiveOutDir } of entries) {
    const keyDir = effectiveOutDir ?? dirname(file);
    const rawKey = join(keyDir, basename(file, extname(file)));
    const prev = exactSeen.get(rawKey);
    if (prev) {
      throw new Error(
        `출력 경로 충돌: "${prev}" 와 "${file}" 가 모두 "${rawKey}.{html,pdf}" 로 써집니다. ` +
          `--out-dir 를 나누거나 입력 파일명을 구분하세요.`,
      );
    }
    exactSeen.set(rawKey, file);
    const folded = rawKey.toLowerCase();
    const group = foldedGroups.get(folded);
    if (group) group.push({ file, keyDir, rawKey });
    else foldedGroups.set(folded, [{ file, keyDir, rawKey }]);
  }
  const caseInsensitiveByDev = new Map<number, boolean>();
  for (const group of foldedGroups.values()) {
    // 정확 충돌은 Pass 1 에서 이미 throw 됐으므로, 원소가 2개 이상이면 대소문자만 다른 후보다.
    if (group.length < 2) continue;
    if (await isCaseInsensitiveFs(group[0].keyDir, caseInsensitiveByDev)) {
      throw new Error(
        `출력 경로 충돌: "${group[0].file}" 와 "${group[1].file}" 가 대소문자 무시 파일시스템에서 모두 ` +
          `"${group[1].rawKey}.{html,pdf}" 로 써집니다. --out-dir 를 나누거나 입력 파일명을 구분하세요.`,
      );
    }
  }
  // --title 무시 판정은 CLI 원시 인자 수가 아니라 확장 후 파일 개수 기준 —
  // 단일 디렉터리 입력도 여러 파일로 펼쳐지면 문서마다 같은 제목을 강제하게 되므로.
  let title = options.title;
  if (entries.length > 1 && title !== undefined) {
    console.warn(`⚠ 입력이 ${entries.length}개라 --title "${title}" 을 무시하고 각 파일명을 제목으로 사용합니다.`);
    title = undefined;
  }
  const ownRenderer = !deps.renderer;
  const renderer = deps.renderer ?? (deps.createRenderer ?? createRenderer)();
  const outputs: string[] = [];
  try {
    for (const { file, effectiveOutDir } of entries) {
      // renderer 를 deps 로 넘겨 convert 가 dispose 하지 않게 한다(convertMany 가 소유·정리).
      const outs = await convert({ ...options, title, input: file, outDir: effectiveOutDir }, { ...deps, renderer });
      outputs.push(...outs);
    }
    return outputs;
  } finally {
    if (ownRenderer) await renderer.dispose?.();
  }
}
