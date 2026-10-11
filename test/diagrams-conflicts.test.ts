import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mermaidConfigFromTheme } from '../src/diagrams.js';
import { convert } from '../src/convert.js';
import type { DiagramRenderRequest, Renderer } from '../src/types.js';

afterEach(() => vi.restoreAllMocks());

function parse(css: string) {
  const warnings: string[] = [];
  const config = mermaidConfigFromTheme(css, (message: string) => warnings.push(message));
  return { config, warnings };
}

describe('Mermaid 테마 설정 충돌 경고', () => {
  it.each([
    ['--mermaid-config-flowchart: x; --mermaid-config-flowchart-nodeSpacing: 30;',
      { flowchart: { nodeSpacing: 30 } }, '--mermaid-config-flowchart', '--mermaid-config-flowchart-nodeSpacing'],
    ['--mermaid-config-flowchart-nodeSpacing: 30; --mermaid-config-flowchart: x;',
      { flowchart: 'x' }, '--mermaid-config-flowchart-nodeSpacing', '--mermaid-config-flowchart'],
    ['--mermaid-config-flowchart-layout: false; --mermaid-config-flowchart-layout-spacing: 12;',
      { flowchart: { layout: { spacing: 12 } } }, '--mermaid-config-flowchart-layout', '--mermaid-config-flowchart-layout-spacing'],
  ])('부모·자식 경로 교체를 알리고 기존 설정을 유지한다: %s', (declarations, expected, previous, winner) => {
    const { config, warnings } = parse(`:root { ${declarations} }`);
    expect(config).toEqual(expected);
    expect(warnings).toEqual([`mermaid 테마 설정 충돌: ${previous} → ${winner} (기존 설정을 대체합니다).`]);
  });

  it('여러 자식과 root 블록을 추적하고 이미 대체된 선언은 다시 경고하지 않는다', () => {
    const { config, warnings } = parse(`
      :root { --mermaid-config-flowchart-nodeSpacing: 30; --mermaid-config-flowchart-rankSpacing: 35; }
      :root { --mermaid-config-flowchart: x; --mermaid-config-flowchart-nodeSpacing: 20; }
    `);
    expect(config).toEqual({ flowchart: { nodeSpacing: 20 } });
    expect(warnings).toEqual([
      'mermaid 테마 설정 충돌: --mermaid-config-flowchart-nodeSpacing → --mermaid-config-flowchart (기존 설정을 대체합니다).',
      'mermaid 테마 설정 충돌: --mermaid-config-flowchart-rankSpacing → --mermaid-config-flowchart (기존 설정을 대체합니다).',
      'mermaid 테마 설정 충돌: --mermaid-config-flowchart → --mermaid-config-flowchart-nodeSpacing (기존 설정을 대체합니다).',
    ]);
  });

  it.each([false, true])('별칭은 선언 순서와 관계없이 짧은 표기가 우선한다: reverse=%s', (reverse) => {
    const declarations = ['--mermaid-fontSize: 13px;', '--mermaid-config-themeVariables-fontSize: 20px;'];
    if (reverse) declarations.reverse();
    const { config, warnings } = parse(`:root { ${declarations.join(' ')} }`);
    expect(config).toEqual({ themeVariables: { fontSize: '13px' } });
    expect(warnings).toEqual([
      'mermaid 테마 설정 충돌: --mermaid-config-themeVariables-fontSize → --mermaid-fontSize (기존 설정을 대체합니다).',
    ]);
  });

  it('테마 변수 병합이 스칼라 부모를 대체하는 경우에도 경고한다', () => {
    const { config, warnings } = parse(':root { --mermaid-config-themeVariables: false; --mermaid-fontSize: 13px; --mermaid-lineColor: red; }');
    expect(config).toEqual({ themeVariables: { fontSize: '13px', lineColor: 'red' } });
    expect(warnings).toEqual([
      'mermaid 테마 설정 충돌: --mermaid-config-themeVariables → --mermaid-fontSize (기존 설정을 대체합니다).',
    ]);
  });

  it('별칭의 자식 객체가 대체되는 경우 경고한다', () => {
    const { config, warnings } = parse(':root { --mermaid-config-themeVariables-fontSize-unit: px; --mermaid-fontSize: 13px; }');
    expect(config).toEqual({ themeVariables: { fontSize: '13px' } });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('--mermaid-config-themeVariables-fontSize-unit → --mermaid-fontSize');
  });

  it('독립 키·일반 재선언·같은 값의 별칭·주석은 충돌로 경고하지 않는다', () => {
    const { config, warnings } = parse(`
      :root {
        /* --mermaid-config-flowchart: x; */
        --mermaid-config-flowchart-nodeSpacing: 10;
        --mermaid-config-flowchart-nodeSpacing: 30;
        --mermaid-config-flowchart-rankSpacing: 35;
        --mermaid-config-themeVariables-fontSize: 13px;
        --mermaid-fontSize: 13px;
        --mermaid-lineColor: red;
      }
      body { --mermaid-config-flowchart: x; }
    `);
    expect(config).toEqual({ flowchart: { nodeSpacing: 30, rankSpacing: 35 }, themeVariables: { fontSize: '13px', lineColor: 'red' } });
    expect(warnings).toEqual([]);
  });

  it('콜백 없는 호출도 충돌을 경고한다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mermaidConfigFromTheme(':root { --mermaid-config-flowchart: x; --mermaid-config-flowchart-nodeSpacing: 30; }');
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain('--mermaid-config-flowchart → --mermaid-config-flowchart-nodeSpacing');
  });

  it.each(['enabled', 'disabled', 'no-fence'] as const)('convert 배선·입력 맥락·본문 불변: %s', async (mode) => {
    const dir = mkdtempSync(join(tmpdir(), 'mdx-conflicts-'));
    const input = join(dir, 'input.md');
    const theme = join(dir, 'theme.css');
    const body = '한글 본문은 그대로 유지됩니다.';
    writeFileSync(input, `${body}\n\n${mode === 'no-fence' ? '' : '```mermaid\nflowchart TD\n A-->B\n```\n'}`);
    writeFileSync(theme, ':root { --mermaid-config-flowchart: x; --mermaid-config-flowchart-nodeSpacing: 30; }');
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const requests: DiagramRenderRequest[] = [];
    const renderer: Renderer = {
      html: async (html, path) => { writeFileSync(path, html); },
      pdf: async () => {},
      renderDiagrams: async (request) => {
        requests.push(request);
        return { diagrams: [{ svg: '<svg><text>A</text><text>B</text></svg>', width: 100, height: 100 }], failures: [] };
      },
    };
    try {
      const outputs = await convert({ input, theme, format: 'html', mermaid: mode !== 'disabled' }, { renderer });
      const html = readFileSync(outputs[0], 'utf8');
      expect(html).toContain(`<p>${body}</p>`);
      if (mode === 'enabled') {
        expect(warnings).toHaveBeenCalledOnce();
        expect(warnings.mock.calls[0][0]).toContain(`경고: ${input} — mermaid 테마 설정 충돌:`);
        expect(requests).toHaveLength(1);
        expect(requests[0].config).toEqual({ flowchart: { nodeSpacing: 30 } });
        expect(html).toContain('<svg>');
      } else {
        expect(warnings).not.toHaveBeenCalled();
        expect(requests).toEqual([]);
        if (mode === 'disabled') expect(html).toContain('A--&gt;B');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
