#!/usr/bin/env python3
"""오프라인 폰트 자산 빌드 스크립트 (v0.3.0 003-offline-fonts).

Pretendard 가변 폰트(v1.3.9)를 취득해 wght 400:800 로 축 클립한 뒤, 두
코드포인트 집합으로 서브셋하여 themes/fonts/ 에 woff2 로 저장하고, 각
base64 를 themes/default.css(KS X 1001 2350)·themes/default-full.css
(전체 현대 한글 11172)의 @font-face src 로 생성/치환한다.

실행 (fonttools 는 uv 로 격리 실행 — package.json 런타임/개발 의존성에
등재하지 않는다):

    uv run --with 'fonttools[woff]' --with brotli python scripts/build-fonts.py

네트워크로 원본 폰트를 받을 수 없으면 로컬 경로를 지정한다:

    uv run --with 'fonttools[woff]' --with brotli python scripts/build-fonts.py \\
        --input /path/to/PretendardVariable.woff2

멱등: 재실행해도 동일 코드포인트 집합·축 범위로 동일한 산출을 만든다.
default.css 는 기존 @font-face(Pretendard Variable) 블록만 치환하고 그 외
규칙은 그대로 둔다. default-full.css 는 매 실행 시 (치환된) default.css
전문을 소스로 재생성한다 — 두 테마의 "폰트 외 규칙 동일" 보장 방식.
"""

from __future__ import annotations

import argparse
import base64
import re
import subprocess
import tempfile
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
THEMES_DIR = REPO_ROOT / "themes"
FONTS_DIR = THEMES_DIR / "fonts"
DEFAULT_CSS = THEMES_DIR / "default.css"
DEFAULT_FULL_CSS = THEMES_DIR / "default-full.css"
SUBSET_WOFF2 = FONTS_DIR / "PretendardVariable.subset.woff2"
FULL_WOFF2 = FONTS_DIR / "PretendardVariable.full.woff2"

FONT_URL = (
    "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/"
    "packages/pretendard/dist/web/variable/woff2/PretendardVariable.woff2"
)

# 본문 400 / h2·h3·strong·th 700 / h1·.cover-title 800 을 정확히 포괄하는
# 최소 축 범위로 클립한다 (전체 45:930 유지 대비 28~31% 절감).
AXIS_CLIP = "wght=400:800"

CP_LATIN: list[int] = list(range(0x0020, 0x007F)) + list(range(0x00A0, 0x0100))

# 문서/테마에서 실제 사용되는 기호(repo 내 docs/themes/src 실측 + design.md
# 예시 집합의 합집합). 신규 기호가 필요하면 이 리스트에 추가한다.
CP_SYMBOLS: list[int] = [
    ord(c)
    for c in (
        "§·×"
        "–—…"  # – — …
        "‘’“”"  # ' ' " "
        "←→↔∥≥"
        "①②③④⑤ⓒ"
        "─│└├┬"
        "■▶⚠✅✓"
        "「」"
    )
]


def ks_x_1001_2350() -> list[int]:
    """KS X 1001 wansung 2350 상용 한글 음절.

    EUC-KR lead byte 0xB0–0xC8 · trail byte 0xA1–0xFE 조합을 디코드해
    한글 음절(U+AC00–D7A3) 범위에 속하는 결과만 취한다 — 정확히 2350자.
    """
    codepoints: set[int] = set()
    for lead in range(0xB0, 0xC9):
        for trail in range(0xA1, 0xFF):
            try:
                ch = bytes([lead, trail]).decode("euc-kr")
            except UnicodeDecodeError:
                continue
            if len(ch) == 1 and 0xAC00 <= ord(ch) <= 0xD7A3:
                codepoints.add(ord(ch))
    return sorted(codepoints)


CP_2350 = ks_x_1001_2350()
CP_FULL_HANGUL = list(range(0xAC00, 0xD7A4))  # 전체 현대 한글 11172자


def _write_cp_file(codepoints: list[int], tmp_dir: Path, name: str) -> Path:
    path = tmp_dir / name
    path.write_text("".join(chr(cp) for cp in codepoints), encoding="utf-8")
    return path


def fetch_font(input_path: str | None, tmp_dir: Path) -> Path:
    if input_path:
        src = Path(input_path).resolve()
        print(f"[build-fonts] 로컬 입력 사용: {src}")
        return src
    dest = tmp_dir / "PretendardVariable.woff2"
    print(f"[build-fonts] 다운로드: {FONT_URL}")
    urllib.request.urlretrieve(FONT_URL, dest)  # noqa: S310 (고정 HTTPS URL, 빌드타임 1회)
    return dest


def clip_axis(src: Path, tmp_dir: Path) -> Path:
    dest = tmp_dir / "clipped.woff2"
    print(f"[build-fonts] 축 클립: {AXIS_CLIP}")
    subprocess.run(
        ["fonttools", "varLib.instancer", str(src), AXIS_CLIP, "-o", str(dest)],
        check=True,
    )
    return dest


def subset(src: Path, codepoints_file: Path, dest: Path) -> None:
    print(f"[build-fonts] 서브셋: {dest.name}")
    subprocess.run(
        [
            "pyftsubset",
            str(src),
            f"--text-file={codepoints_file}",
            "--flavor=woff2",
            "--layout-features=*",
            "--no-hinting",
            "--desubroutinize",
            f"--output-file={dest}",
        ],
        check=True,
    )


def _font_face_block(b64: str) -> str:
    return (
        "@font-face {\n"
        "  font-family: 'Pretendard Variable';\n"
        "  font-style: normal;\n"
        "  font-display: swap;\n"
        "  font-weight: 400 800;\n"
        f"  src: url(data:font/woff2;base64,{b64}) format('woff2');\n"
        "}\n"
    )


_FONT_FACE_RE = re.compile(r"@font-face\s*\{[^}]*Pretendard Variable[^}]*\}\n?", re.DOTALL)
_CDN_IMPORT_RE = re.compile(r"^@import[^\n]*\n\n?", re.MULTILINE)


def update_default_css(woff2_path: Path) -> str:
    """default.css 의 CDN @import 를 제거하고 @font-face(2350 base64) 를 생성/치환한다.

    폰트 관련 부분(첫 @import 행 또는 기존 @font-face 블록) 외의 모든 규칙은
    바이트 단위로 보존한다. 반환값은 치환 후 전체 CSS 텍스트.
    """
    css = DEFAULT_CSS.read_text(encoding="utf-8")
    b64 = base64.b64encode(woff2_path.read_bytes()).decode("ascii")
    font_face = _font_face_block(b64)

    if _FONT_FACE_RE.search(css):
        css = _FONT_FACE_RE.sub(font_face, css, count=1)
    else:
        css = _CDN_IMPORT_RE.sub("", css, count=1)
        css = font_face + "\n" + css

    DEFAULT_CSS.write_text(css, encoding="utf-8")
    print(f"[build-fonts] 주입 완료: {DEFAULT_CSS.relative_to(REPO_ROOT)} (base64 {len(b64):,} chars)")
    return css


def write_default_full_css(default_css_text: str, woff2_path: Path) -> None:
    """default-full.css = default.css(치환 후) 의 @font-face src 만 11172 서브셋으로 교체."""
    b64 = base64.b64encode(woff2_path.read_bytes()).decode("ascii")
    css = _FONT_FACE_RE.sub(_font_face_block(b64), default_css_text, count=1)
    DEFAULT_FULL_CSS.write_text(css, encoding="utf-8")
    print(f"[build-fonts] 생성 완료: {DEFAULT_FULL_CSS.relative_to(REPO_ROOT)} (base64 {len(b64):,} chars)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", help="로컬 가변 woff2 경로 (미지정 시 jsdelivr 다운로드)")
    args = parser.parse_args()

    FONTS_DIR.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        source = fetch_font(args.input, tmp_dir)
        clipped = clip_axis(source, tmp_dir)

        cp_2350_file = _write_cp_file(CP_2350 + CP_LATIN + CP_SYMBOLS, tmp_dir, "cp_2350.txt")
        cp_full_file = _write_cp_file(CP_FULL_HANGUL + CP_LATIN + CP_SYMBOLS, tmp_dir, "cp_full.txt")

        subset(clipped, cp_2350_file, SUBSET_WOFF2)
        subset(clipped, cp_full_file, FULL_WOFF2)

    default_css_text = update_default_css(SUBSET_WOFF2)
    write_default_full_css(default_css_text, FULL_WOFF2)

    print("[build-fonts] 완료.")


if __name__ == "__main__":
    main()
