# 변환 작업 절차서

Markdown 문서 1건을 HTML·PDF 로 변환하는 전체 절차. 이 절차는 `apps/ai_worker/docs/EXE-배포-작업절차서.md` 변환으로 실증되었다.

## 목차

- [0. 전제 조건](#0-전제-조건)
- [1. 작업 폴더 준비](#1-작업-폴더-준비)
- [2. PDF 생성](#2-pdf-생성)
- [3. HTML 생성](#3-html-생성)
- [4. HTML 후처리 — title 주입](#4-html-후처리--title-주입)
- [5. 검증 체크리스트](#5-검증-체크리스트)
- [6. 트러블슈팅](#6-트러블슈팅)

## 0. 전제 조건

| 항목 | 내용 |
|---|---|
| Node.js | `npx` 실행 가능 버전 |
| 네트워크 | 최초 실행 시 md-to-pdf·Chromium 다운로드, 변환 시 Pretendard 웹폰트 로드 |
| 테마 | `tools/md-export/theme.css` |
| 도구 버전 | md-to-pdf 5.2.5 에서 검증됨 (`npx --yes md-to-pdf --version` 으로 확인) |

## 1. 작업 폴더 준비

원본을 오염시키지 않도록 작업 폴더에 대상 문서와 테마를 모은다. (md-to-pdf 는 출력 파일을 입력 파일과 같은 폴더에 생성한다.)

```bash
mkdir -p /tmp/md-export
cp tools/md-export/theme.css /tmp/md-export/
cp <대상문서>.md /tmp/md-export/
cd /tmp/md-export
```

> 대상 문서 폴더에서 직접 변환해도 동작한다. 이 경우 `--stylesheet` 에 theme.css 의 상대/절대 경로를 지정한다.

## 2. PDF 생성

```bash
npx --yes md-to-pdf \
  --stylesheet theme.css \
  --pdf-options '{"format":"A4","margin":{"top":"18mm","bottom":"18mm","left":"15mm","right":"15mm"},"printBackground":true}' \
  <대상문서>.md
```

- `--pdf-options` 는 **JSON 문자열**이다. 홑따옴표로 감싸고 내부는 유효한 JSON 을 유지한다.
- `printBackground: true` 필수 — 없으면 표 헤더 배경·콜아웃 배경·코드 박스 배경이 인쇄에서 빠진다.
- 산출물: `<대상문서>.pdf` (같은 폴더).

## 3. HTML 생성

```bash
npx --yes md-to-pdf --as-html --stylesheet theme.css <대상문서>.md
```

- 산출물: `<대상문서>.html`. 테마 CSS 가 문서에 인라인으로 포함된 단일 파일이라 그대로 전달 가능하다.

## 4. HTML 후처리 — title 주입

md-to-pdf 5.2.5 는 HTML 의 `<title>` 을 비워 두므로 문서 제목을 주입한다.

```bash
perl -pi -e 's{<title></title>}{<title>문서 제목</title>}' <대상문서>.html
```

## 5. 검증 체크리스트

| # | 항목 | 방법 |
|---|---|---|
| 1 | 두 산출물 생성 확인 | `ls -la` — `.pdf`(폰트 임베드로 수백 KB대)·`.html` 존재 |
| 2 | 내용 무결성 (문구 불변) | 원문 고유 문구를 HTML 에서 grep 하여 존재·등장 횟수 대조 |
| 3 | 테마 적용 확인 | HTML 에서 `Pretendard` 문자열 grep — 테마 인라인 포함 여부 |
| 4 | `<title>` 주입 확인 | `grep -o "<title>[^<]*</title>" <대상문서>.html` |
| 5 | 시각 검수 | PDF 를 열어 폰트·표·콜아웃·코드 박스·페이지 나눔 확인 (사람 눈) |

## 6. 트러블슈팅

| 증상 | 점검 |
|---|---|
| 최초 실행이 오래 걸림 | 정상 — npx 가 md-to-pdf·Chromium 다운로드 중. 이후 캐시로 빨라짐 |
| PDF 에서 배경색이 전부 흰색 | `--pdf-options` 에 `"printBackground": true` 누락 |
| `--pdf-options` 파싱 오류 | JSON 유효성 확인 (겹따옴표·중괄호). 셸 홑따옴표로 전체를 감쌌는지 확인 |
| 한글이 고딕 계열 기본 폰트로 나옴 | 네트워크 차단으로 Pretendard CDN 로드 실패 — 폴백 폰트로 렌더링된 것. 오프라인 대응은 설계 문서 [§5](design.md#5-알려진-제약) 참조 |
| 스타일이 전혀 적용 안 됨 | `--stylesheet` 경로가 실행 위치 기준으로 유효한지 확인 |
| 표·코드 박스가 페이지 경계에서 잘림 | theme.css 의 `break-inside: avoid` 가 적용되는지 확인 — 요소가 한 페이지보다 크면 잘림은 불가피 |
