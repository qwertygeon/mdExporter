#!/usr/bin/env node
// npm prepare 훅 — 저장소·git 의존성 설치와 발행 직전에 dist 를 새로 만든다.
import { rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// --omit=dev 설치에서는 typescript 가 없다. prepare 는 omit 을 보지 않고 무조건 실행되므로
// 여기서 직접 판별해 건너뛴다 — 빌드 없이도 설치 자체는 성공해야 한다.
try {
  require.resolve('typescript/package.json');
} catch {
  console.log('prepare: typescript 미설치 — 빌드를 건너뜁니다.');
  process.exit(0);
}

// tsc 는 삭제된 소스의 산출물을 지우지 않는다 → 매번 비우고 컴파일해야 stale 파일이 발행되지 않는다.
rmSync('dist', { recursive: true, force: true });

const tsc = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc')], {
  stdio: 'inherit',
});
process.exit(tsc.status ?? 1);
