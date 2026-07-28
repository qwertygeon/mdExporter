# 테마 가이드

mdExporter 의 디자인은 **테마(CSS 한 벌)** 가 결정한다. 내장 기본 테마를 그대로 쓰거나, `--theme` 로 원하는 CSS 를 주입할 수 있다.

## 목차

- [테마 지정](#테마-지정)
- [색 커스터마이즈](#색-커스터마이즈)
- [폰트 교체](#폰트-교체)
- [내장 오프라인 폰트 (Pretendard 임베딩)](#내장-오프라인-폰트-pretendard-임베딩)
  - [세 테마 변형](#세-테마-변형)
  - [라이선스](#라이선스)
  - [폰트 자산 재생성](#폰트-자산-재생성)
- [테마가 다루는 요소](#테마가-다루는-요소)
- [인쇄(PDF) 규칙](#인쇄pdf-규칙)
- [커스텀 테마 만들기](#커스텀-테마-만들기)

## 테마 지정

```bash
mdexport 문서.md --theme my-theme.css
```

지정하지 않으면 내장 기본 테마(`themes/default.css`)를 쓴다. 가장 간단한 커스터마이즈는 이 기본 테마를 복사해 값만 바꾸는 것이다.

## 색 커스터마이즈

기본 테마의 색은 상단 `:root` 블록에 CSS 변수로 모여 있다. 브랜드 적용 시 이 블록만 바꾸면 된다.

| 변수 | 역할 |
|---|---|
| `--ink` | 본문 텍스트 색 |
| `--muted` | 보조 텍스트 색 |
| `--accent` | 액센트(헤딩 라인·바·링크) |
| `--accent-dark` | 액센트 진한 변형(소제목·인쇄 링크) |
| `--line` | 테두리·구분선 |
| `--bg-soft` | 표 짝수 행 배경 |
| `--bg-code` | 코드 블록 배경 |

예) 액센트를 초록 계열로:

```css
:root {
  --accent: #059669;
  --accent-dark: #047857;
}
```

## 폰트 교체

폰트는 `body` 의 `font-family` 로 지정한다. 기본 테마는 한글 시인성을 위해 Pretendard 를 1순위로 두고, 서브셋 범위 밖 글자나 폰트 자체가 없는 경우 시스템 한글 폰트로 폴백한다(다음 절 참조). 원격 웹폰트로 교체하려면 상단에 `@import` 를 추가하고 `font-family` 를 함께 바꾼다.

```css
@import url('...웹폰트 CSS URL...');
body { font-family: 'MyFont', -apple-system, sans-serif; }
```

## 내장 오프라인 폰트 (Pretendard 임베딩)

기본 테마는 Pretendard 를 base64 데이터 URI `@font-face` 로 CSS 안에 직접 담는다 — 네트워크 유무와 무관하게 항상 동일하게 렌더된다(오프라인 결정성). 임베딩은 가변축(variable font)을 유지한 채 `font-weight: 400 800` 범위로 클립되어, 테마가 실제 쓰는 굵기(본문 400·`h2`/`h3`/`strong` 700·`h1` 800)를 모두 커버한다. 서브셋 범위 밖 글자(희귀 한자·이모지 등)는 기존 폴백 체인(`Apple SD Gothic Neo` → `Noto Sans KR` → `-apple-system` → `sans-serif`)으로 자연히 넘어간다.

### 세 테마 변형

임베딩 커버리지·크기는 새 CLI 옵션이 아니라 **테마 파일 교체**(`--theme`)로 선택한다:

| 테마 | 서브셋 범위 | 특징 |
|---|---|---|
| `themes/default.css` (기본) | KS X 1001 상용 한글 2350자 + 영문 | 오프라인 결정성을 기본으로 제공, 크기 균형 |
| `themes/default-full.css` | 현대 한글 전체(U+AC00–D7A3, 11172자) + 영문 | 상용 범위를 넘는 한글까지 완전 커버(크기 더 큼) |
| `themes/default-cdn.css` | 없음(CDN `@import` 원격 로드) | 임베딩 없이 기존 웹폰트 방식 — 온라인·크기 최소 |

세 파일은 폰트 선언(`@font-face`/`@import`)만 다르고 나머지 색·레이아웃 규칙은 동일하다. 자세한 크기·선택 안내는 [사용자 매뉴얼의 오프라인 폰트와 테마 변형](USAGE.md#오프라인-폰트와-테마-변형) 참조.

### 라이선스

임베딩·동봉된 Pretendard 는 SIL Open Font License 1.1 을 따른다. 라이선스 전문은 `themes/fonts/OFL.txt` 로 동봉되어 배포(`package.json` `files`)에 포함된다.

### 폰트 자산 재생성

`themes/fonts/PretendardVariable.subset.woff2`(2350 서브셋)·`themes/fonts/PretendardVariable.full.woff2`(11172 전체)와 두 테마의 base64 임베딩은 `scripts/build-fonts.py` 로 재현 가능하다. 이 스크립트는 Python `fonttools`(빌드타임 도구)를 사용하며, 프로젝트의 npm 런타임 의존성에는 포함되지 않는다.

```bash
uv run --with 'fonttools[woff]' --with brotli python scripts/build-fonts.py
```

원본 Pretendard 가변 폰트를 원격(jsdelivr)에서 내려받아 가변축을 400~800 으로 클립한 뒤 두 코드포인트 집합으로 서브셋을 만들고, 각 결과를 `themes/default.css`·`themes/default-full.css` 의 `@font-face` 블록에 base64 로 주입한다. 재실행해도 동일한 결과를 낸다(멱등).

## 테마가 다루는 요소

테마는 도구 기본 스타일에 의존하지 않고 문서 요소를 자체 정의한다:

- 본문 타이포그래피(크기·줄간격·줄폭·한글 줄바꿈)
- 헤딩 위계(h1 하단 라인, h2 좌측 바, h3 색 강조)
- 표(헤더 배경·짝수 행 zebra)
- 코드(인라인 코드, 코드 블록)
- 인용 블록 → **콜아웃 카드**(주목 박스) 렌더링
- 링크·강조·구분선·목록
- 문서 레이아웃 요소(opt-in): 표지(`.cover`·`.cover-title`·`.cover-date`), 목차(`.toc`·`.toc-l3`) — 페이지 나눔(`break-after`)도 여기서 정의. 커스텀 테마에서 이 클래스를 재정의해 모양을 바꿀 수 있다.

## 인쇄(PDF) 규칙

화면 기준 스타일을 정의하고, 인쇄 차이만 `@media print` 로 오버라이드하는 구조다. 기본 테마의 인쇄 규칙:

- 본문 크기를 인쇄에 맞게 축소
- 헤딩이 페이지 끝에 홀로 남지 않도록 처리
- 표·코드 블록·콜아웃이 페이지 경계에서 잘리지 않게 처리(한 페이지 초과 요소는 예외)

배경색(표 헤더·콜아웃·코드 박스)이 PDF 에 나오려면 배경 인쇄가 켜져 있어야 하며, 이는 도구가 기본으로 처리한다.

## 커스텀 테마 만들기

1. 기본 테마 `themes/default.css` 를 복사한다.
2. `:root` 색 변수와 `body` 폰트를 원하는 값으로 바꾼다.
3. 필요하면 요소별 규칙을 조정한다.
4. `--theme` 로 지정해 변환한다.

```bash
cp themes/default.css my-theme.css
# my-theme.css 편집 후
mdexport 문서.md --theme my-theme.css
```

테마는 문서에 종속되지 않으므로, 한 번 만든 테마를 여러 문서에 재사용할 수 있다.
