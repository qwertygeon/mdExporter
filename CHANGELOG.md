# Changelog

이 프로젝트의 주요 변경 사항을 기록한다. 형식은 [Keep a Changelog](https://keepachangelog.com/), 버전은 [Semantic Versioning](https://semver.org/) 을 따른다.

## [0.1.0] - 2026-07-24

### Added

- Markdown → HTML/PDF 변환 CLI (`mdexport`).
- HTML/PDF 동일 디자인 산출 (브라우저 인쇄 기반, 단일 CSS 테마).
- 한글 시인성 우선 내장 기본 테마.
- 교체 가능한 테마 주입 옵션 (`--theme`).
- CLI 옵션: 출력 포맷(`--format`), 제목(`--title`), 출력 디렉터리(`--out-dir`).
- 원본 문구를 보존하는 내용 불변 변환.
