# Changelog

이 프로젝트의 주요 변경 사항을 기록한다. 형식은 [Keep a Changelog](https://keepachangelog.com/), 버전은 [Semantic Versioning](https://semver.org/) 을 따른다.

## [Unreleased]

### Added

- 다중 문서 일괄 변환 — 여러 `.md` 파일이나 디렉터리를 한 번에 변환(`mdexport <입력...>`). glob 은 shell 확장, 디렉터리는 그 안 `.md`(비재귀).
- 일괄 PDF 변환 시 Chromium 인스턴스 재사용 — 문서마다 재실행하지 않고 한 번 띄워 처리 후 정리.

### Changed

- `.gitignore` 의 `*.html`/`*.pdf` 전역 무시를 루트 스크래치(`/*.html`·`/*.pdf`) 한정으로 좁힘 — 저장소 자산으로 두려는 html/pdf 는 다른 경로에서 추적 가능.
- 입력이 여러 개면 `--title` 은 무시되고 각 파일명이 제목으로 쓰인다(단일 입력은 종전대로).

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
