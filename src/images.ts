import { readFile, realpath } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import type { ImageAssets } from './types.js';

/** 로컬 이미지 자산 해석 — 참조를 읽어 data URI 로 만든다. 파서는 이 결과 Map 만 조회한다. */

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
};

export interface ImageLoadFailure {
  ref: string;
  /** fs 오류 코드(ENOENT·EISDIR·EACCES·ELOOP 등). 원인을 경고에 실어야 오진하지 않는다. */
  code?: string;
}

export interface ImageLoadResult {
  assets: ImageAssets;
  /** 로컬 경로로 판정됐으나 읽지 못한 참조 */
  missing: ImageLoadFailure[];
  /** 확장자로 이미지 MIME 을 결정할 수 없어 건너뛴 참조 */
  unsupported: string[];
  /** 내용이 비어 있어(0바이트) 실제로는 보이지 않을 참조 */
  empty: string[];
  /** 실제 파일명과 대소문자만 다른 참조 — 대소문자를 구분하는 환경에서는 찾지 못한다 */
  caseMismatch: string[];
}

/** 확장자로 이미지 MIME 을 판정한다. 이미지가 아니면 undefined. */
export function mimeForImage(path: string): string | undefined {
  return MIME_BY_EXT[extname(path).toLowerCase()];
}

/**
 * 로컬 파일로 해석해 임베딩할 참조인지 판정한다.
 * 원격(스킴 보유·프로토콜 상대)·이미 인라인된 data URI 는 대상이 아니다.
 * Windows 드라이브 문자(`C:\...`)를 스킴으로 오인하지 않도록 스킴은 2자 이상만 인정한다.
 */
export function isEmbeddableRef(ref: string): boolean {
  if (!ref) return false;
  if (ref.startsWith('//')) return false; // 프로토콜 상대 — 원격
  if (/^[a-z][a-z0-9+.-]+:/i.test(ref)) return false; // http:·https:·data:·file: 등
  return true;
}

/**
 * markdown-it 은 링크를 percent-encode 하므로(`my image.png` → `my%20image.png`)
 * 파일시스템 조회 전에 되돌린다. 디코딩 불가한 형태는 원문을 그대로 쓴다.
 */
function decodeRef(ref: string): string {
  try {
    return decodeURIComponent(ref);
  } catch {
    return ref;
  }
}

/**
 * 조회할 파일시스템 경로 후보를 우선순위대로 만든다.
 * 원문 우선 — 이름에 `?`·`#` 이 실제로 들어간 파일을 먼저 인정하고,
 * 실패했을 때만 URL 수식자(`a.png?v=2`·`a.png#x`)로 보고 잘라낸 경로를 시도한다.
 */
function fsPathCandidates(ref: string): string[] {
  const decoded = decodeRef(ref);
  const cut = decoded.search(/[?#]/);
  if (cut <= 0) return [decoded];
  return [decoded, decoded.slice(0, cut)];
}

/** 후보 경로 중 이미지 MIME 을 판정할 수 있는 첫 경로를 고른다. */
function pickCandidate(candidates: readonly string[]): { path: string; mime: string } | undefined {
  for (const path of candidates) {
    const mime = mimeForImage(path);
    if (mime) return { path, mime };
  }
  return undefined;
}

/** 참조의 대소문자가 디스크의 실제 파일명과 다른지 확인한다(대소문자 무시 FS 에서만 성립). */
async function differsInCaseOnly(absPath: string): Promise<boolean> {
  try {
    const actual = await realpath(absPath);
    const wanted = basename(absPath);
    const found = basename(actual);
    return wanted !== found && wanted.toLowerCase() === found.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * 참조 목록을 baseDir 기준으로 해석해 data URI Map 을 만든다.
 * 읽기 실패·미지원 확장자·빈 파일·대소문자 불일치는 흡수하지 않고 분류해 반환한다 — 보고는 호출자 책임.
 * 같은 파일을 다른 표기로 여러 번 참조하면 읽기는 1회로 합친다(산출물에는 참조마다 실린다).
 */
export async function loadImageAssets(
  refs: readonly string[],
  baseDir: string,
): Promise<ImageLoadResult> {
  const assets = new Map<string, string>();
  const missing: ImageLoadFailure[] = [];
  const unsupported: string[] = [];
  const empty: string[] = [];
  const caseMismatch: string[] = [];
  /** 해석된 절대경로 → data URI. 같은 파일의 중복 읽기를 막는다. */
  const byAbsPath = new Map<string, string>();

  for (const ref of new Set(refs)) {
    if (!isEmbeddableRef(ref)) continue;
    const picked = pickCandidate(fsPathCandidates(ref));
    if (!picked) {
      unsupported.push(ref);
      continue;
    }
    const absPath = resolve(baseDir, picked.path);

    const cached = byAbsPath.get(absPath);
    if (cached !== undefined) {
      assets.set(ref, cached);
      continue;
    }

    try {
      const bytes = await readFile(absPath);
      if (bytes.length === 0) {
        // 빈 파일을 빈 data URI 로 바꿔봐야 어차피 빈칸이다 — 다른 실패 분류와 같이 원본 src 를 남긴다.
        empty.push(ref);
        continue;
      }
      const dataUri = `data:${picked.mime};base64,${bytes.toString('base64')}`;
      byAbsPath.set(absPath, dataUri);
      assets.set(ref, dataUri);
      if (await differsInCaseOnly(absPath)) caseMismatch.push(ref);
    } catch (err) {
      missing.push({ ref, code: (err as { code?: string }).code });
    }
  }

  return { assets, missing, unsupported, empty, caseMismatch };
}
