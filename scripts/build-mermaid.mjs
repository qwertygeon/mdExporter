#!/usr/bin/env node
/**
 * mermaid 번들 자산 빌드 스크립트.
 *
 * npm 레지스트리에서 버전 고정 mermaid tarball 을 받아, 브라우저에 그대로 주입할 수 있는
 * 자기완결 UMD 번들 `dist/mermaid.min.js` 와 라이선스만 골라 vendor/mermaid/ 에 저장한다.
 * mermaid 패키지 전체는 설치 시 84MB·1183 파일인데 변환기가 쓰는 것은 이 번들 하나뿐이라,
 * npm 런타임 의존성으로 넣지 않고 이 자산만 저장소에 담는다(폰트 임베딩과 같은 방식).
 *
 * 실행 (Node 내장 기능 + tar 만 사용 — package.json 의존성 미등재):
 *
 *     node scripts/build-mermaid.mjs
 *
 * 네트워크로 원본을 받을 수 없으면 내려받아 둔 tarball 경로를 지정한다:
 *
 *     node scripts/build-mermaid.mjs --input /path/to/mermaid-11.17.1.tgz
 *
 * 버전을 올리려면 아래 MERMAID_VERSION 을 바꾸고 재실행한다. 같은 버전으로 재실행하면
 * 같은 바이트가 나온다(번들을 가공하지 않고 그대로 꺼내므로).
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR_DIR = join(REPO_ROOT, 'vendor', 'mermaid');

const MERMAID_VERSION = '11.17.1';
const TARBALL_URL = `https://registry.npmjs.org/mermaid/-/mermaid-${MERMAID_VERSION}.tgz`;

/** tarball 안에서 꺼낼 항목 → vendor 파일명 */
const PICK = [
  ['package/dist/mermaid.min.js', 'mermaid.min.js'],
  ['package/LICENSE', 'LICENSE'],
];

function parseArgs(argv) {
  const args = { input: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--input') {
      args.input = argv[i + 1];
      i += 1;
      if (!args.input) throw new Error('--input 에 tarball 경로가 필요합니다.');
    } else {
      throw new Error(`알 수 없는 인자: ${argv[i]}`);
    }
  }
  return args;
}

async function download(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`tarball 을 받지 못했습니다 (${res.status} ${res.statusText}): ${url}`);
  writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  const { input } = parseArgs(process.argv.slice(2));
  const work = mkdtempSync(join(tmpdir(), 'mdx-mermaid-'));
  const tarball = input ? resolve(input) : join(work, 'mermaid.tgz');

  if (input) {
    statSync(tarball); // 없으면 여기서 실패시킨다 — 조용히 네트워크로 되돌아가지 않는다.
    console.log(`로컬 tarball 사용: ${tarball}`);
  } else {
    console.log(`내려받는 중: ${TARBALL_URL}`);
    await download(TARBALL_URL, tarball);
  }

  execFileSync('tar', ['-xzf', tarball, '-C', work, ...PICK.map(([entry]) => entry)], { stdio: 'inherit' });

  mkdirSync(VENDOR_DIR, { recursive: true });
  for (const [entry, name] of PICK) {
    copyFileSync(join(work, entry), join(VENDOR_DIR, name));
  }

  // provenance — 어느 버전을 어디서 받았는지 남겨 재빌드 기준을 확보한다.
  writeFileSync(
    join(VENDOR_DIR, 'VERSION'),
    `mermaid ${MERMAID_VERSION}\n${TARBALL_URL}\n`,
    'utf8',
  );

  const bytes = readFileSync(join(VENDOR_DIR, 'mermaid.min.js')).length;
  console.log(`vendor/mermaid/mermaid.min.js 갱신 (${(bytes / 1024 / 1024).toFixed(2)} MB, mermaid ${MERMAID_VERSION})`);
}

await main();
