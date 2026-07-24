# Changelog

이 프로젝트의 주요 변경 사항을 기록한다. 형식은 [Keep a Changelog](https://keepachangelog.com/), 버전은 [Semantic Versioning](https://semver.org/) 을 따른다.

## [0.2.0] - 2026-07-24

### Added

- 자동 목차 생성 (`--toc`, 깊이 `--toc-depth`) — 헤딩 앵커 + 링크.
- 표지 페이지 (`--cover`, 날짜 `--date`).
- PDF 헤더/푸터 (`--header` 문서 제목, `--footer` 페이지 번호).

모든 레이아웃 기능은 opt-in 이며, 지정하지 않으면 산출물은 v0.1.0 과 동일하다(기본 동작 불변).

## [0.1.0] - 2026-07-24

### Added

- Markdown → HTML/PDF 변환 CLI (`mdexport`).
- HTML/PDF 동일 디자인 산출 (브라우저 인쇄 기반, 단일 CSS 테마).
- 한글 시인성 우선 내장 기본 테마.
- 교체 가능한 테마 주입 옵션 (`--theme`).
- CLI 옵션: 출력 포맷(`--format`), 제목(`--title`), 출력 디렉터리(`--out-dir`).
- 원본 문구를 보존하는 내용 불변 변환.
