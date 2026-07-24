# mdExporter

Markdown 문서를 **문구 변경 없이** 시인성 좋은 HTML·PDF 로 변환하는 CLI 도구.

하나의 CSS 테마로 HTML 과 PDF 를 같은 디자인으로 뽑으며(브라우저 인쇄 기반), 한글 문서 가독성을 우선한 기본 테마를 내장한다.

## 목차

- [특징](#특징)
- [요구 사항](#요구-사항)
- [설치](#설치)
- [빠른 시작](#빠른-시작)
- [명령 요약](#명령-요약)
- [예시](#예시)
- [문서](#문서)
- [예정 기능](#예정-기능)
- [라이선스](#라이선스)

## 특징

- **내용 불변**: 원본 markdown 의 문구·구조를 바꾸지 않고 스타일만 입힌다.
- **HTML/PDF 동일 디자인**: 하나의 테마(CSS)로 두 포맷을 같은 모습으로 산출한다.
- **교체 가능한 테마**: 내장 기본 테마 대신 `--theme` 로 원하는 CSS 를 주입할 수 있다.
- **한글 시인성 우선**: 폰트·줄폭·줄간격·표 가독성을 한글 문서 기준으로 조율한 기본 테마.

## 요구 사항

- **Node.js 18 이상**
- **PDF 생성 시**: Playwright 용 Chromium 브라우저. 최초 1회 설치가 필요하다.
  ```bash
  npx playwright install chromium
  ```
  (HTML 만 생성할 때는 브라우저가 필요 없다.)

## 설치

현재 소스에서 빌드해 사용한다.

```bash
git clone https://github.com/qwertygeon/mdExporter.git
cd mdExporter
npm install
npm run build
```

전역 명령 `mdexport` 로 쓰려면 `npm link` 를, 아니면 `node dist/cli.js` 를 사용한다.

## 빠른 시작

```bash
# HTML + PDF 둘 다 생성 (입력 파일과 같은 폴더에)
node dist/cli.js 문서.md

# HTML 만
node dist/cli.js 문서.md --format html
```

산출물은 기본적으로 입력 파일과 같은 폴더에 같은 이름(`.html`/`.pdf`)으로 생성된다.

## 명령 요약

```
mdexport <input.md> [옵션]
```

| 옵션 | 설명 | 기본값 |
|---|---|---|
| `-f, --format <format>` | 출력 포맷: `html` \| `pdf` \| `both` | `both` |
| `-t, --theme <path>` | 사용할 테마 CSS 파일 경로 | 내장 기본 테마 |
| `--title <title>` | HTML `<title>` 값 | 입력 파일명(확장자 제외) |
| `-o, --out-dir <dir>` | 출력 디렉터리 | 입력 파일과 같은 폴더 |

## 예시

```bash
# 제목을 지정해 HTML+PDF 생성
node dist/cli.js report.md --title "월간 보고서"

# 커스텀 테마로 PDF 만, 다른 폴더에 출력
node dist/cli.js report.md -f pdf -t my-theme.css -o out/
```

## 문서

- [사용자 매뉴얼](docs/USAGE.md) — 전체 옵션·출력 규칙·트러블슈팅
- [테마 가이드](docs/THEMING.md) — 색·폰트 커스터마이즈, 커스텀 테마 작성
- [변경 이력](CHANGELOG.md)

## 예정 기능

아직 제공하지 않으며 향후 추가 예정: 자동 목차(TOC), 표지 페이지, 헤더/푸터(페이지 번호), 다중 문서 일괄 변환.

## 라이선스

[MIT](LICENSE)
