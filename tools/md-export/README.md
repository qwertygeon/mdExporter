# md-export — Markdown → HTML/PDF 변환 도구

Markdown 문서의 **문구를 변경하지 않으면서**, 시인성 좋고 세련된 디자인의 HTML/PDF 파일로 변환한다.

## 목차

- [핵심 원칙](#핵심-원칙)
- [빠른 시작](#빠른-시작)
- [폴더 구조](#폴더-구조)
- [문서 안내](#문서-안내)

## 핵심 원칙

- **내용 불변**: 변환은 스타일만 입힌다. 원본 markdown 의 문구·구조를 수정하지 않는다.
- **변환기는 기존 도구, 디자인은 자체 테마**: markdown 파싱·렌더링은 `md-to-pdf`(Chromium 인쇄 기반)에 맡기고, 디자인 품질은 `theme.css` 한 벌로 통제한다. 파서를 직접 구현하지 않는다.
- **HTML/PDF 동일 소스**: 하나의 CSS 로 HTML 과 PDF 를 함께 뽑는다. Chromium 인쇄 방식이므로 "웹에서 보이는 디자인 = PDF 디자인"이 성립한다.

## 빠른 시작

전제: Node.js(`npx`) 사용 가능. 최초 실행 시 md-to-pdf 와 Chromium 이 자동 다운로드된다.

```bash
# PDF 생성 (A4, 여백, 배경색 인쇄 포함)
npx --yes md-to-pdf \
  --stylesheet theme.css \
  --pdf-options '{"format":"A4","margin":{"top":"18mm","bottom":"18mm","left":"15mm","right":"15mm"},"printBackground":true}' \
  대상문서.md

# HTML 생성
npx --yes md-to-pdf --as-html --stylesheet theme.css 대상문서.md

# HTML <title> 채우기 (md-to-pdf 5.2.5 는 <title> 을 비워 둠)
perl -pi -e 's{<title></title>}{<title>문서 제목</title>}' 대상문서.html
```

출력 파일은 입력 파일과 같은 폴더에 같은 이름(`.pdf`/`.html`)으로 생성된다.

## 폴더 구조

```
tools/md-export/
  README.md                  ← 본 문서 (개요·빠른 시작)
  theme.css                  ← 변환용 테마 (디자인 SSOT)
  docs/
    design.md                ← 설계 문서 (요구사항·도구 선정·아키텍처·로드맵)
    conversion-guide.md      ← 변환 작업 절차서 (명령·후처리·검증·트러블슈팅)
    theme-spec.md            ← theme.css 디자인 명세 (각 스타일 결정과 이유)
```

## 문서 안내

| 알고 싶은 것 | 문서 |
|---|---|
| 왜 md-to-pdf 인가, 다른 도구와의 비교, 향후 자체 도구 승격 계획 | `docs/design.md` |
| 실제 변환을 재현하는 정확한 절차·명령·검증 방법 | `docs/conversion-guide.md` |
| 테마의 각 스타일이 왜 그렇게 설계되었는지, 커스터마이즈 포인트 | `docs/theme-spec.md` |
