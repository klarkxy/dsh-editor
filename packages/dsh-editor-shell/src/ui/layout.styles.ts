import { defineStyles } from '../design-system/layers.ts'

/* 原稿间距刻度：Radix 数字档位 → --dsh-ui-space-*。
   Radix 5/6 (24/32px) 对应本刻度 space-6/space-8；7+ 收敛到 space-8。 */
const SPACE: Record<string, string> = {
  '0': '0',
  '1': 'var(--dsh-ui-space-1)',
  '2': 'var(--dsh-ui-space-2)',
  '3': 'var(--dsh-ui-space-3)',
  '4': 'var(--dsh-ui-space-4)',
  '5': 'var(--dsh-ui-space-6)',
  '6': 'var(--dsh-ui-space-8)',
  '7': 'var(--dsh-ui-space-8)',
  '8': 'var(--dsh-ui-space-8)',
  '9': 'var(--dsh-ui-space-8)',
}

const spacingRules = (): string => {
  const rules: string[] = []
  const props: [string, string][] = [
    ['m', 'margin'],
    ['mt', 'margin-top'],
    ['mb', 'margin-bottom'],
    ['mx', 'margin-inline'],
    ['my', 'margin-block'],
    ['ml', 'margin-left'],
    ['mr', 'margin-right'],
    ['p', 'padding'],
    ['px', 'padding-inline'],
    ['py', 'padding-block'],
    ['pt', 'padding-top'],
    ['pb', 'padding-bottom'],
    ['gap', 'gap'],
  ]
  for (const [attr, cssProp] of props) {
    for (const [step, value] of Object.entries(SPACE)) {
      rules.push(`.dsh-flex[data-${attr}='${step}'], .dsh-box[data-${attr}='${step}'], .dsh-notice[data-${attr}='${step}'], .dsh-button[data-${attr}='${step}'] { ${cssProp}: ${value}; }`)
    }
  }
  return rules.join('\n')
}

defineStyles('dsh.components', 'dsh-layout', `
.dsh-flex { display: flex; }
.dsh-flex[data-direction='column'] { flex-direction: column; }
.dsh-flex[data-direction='row-reverse'] { flex-direction: row-reverse; }
.dsh-flex[data-direction='column-reverse'] { flex-direction: column-reverse; }
.dsh-flex[data-align='start'] { align-items: flex-start; }
.dsh-flex[data-align='center'] { align-items: center; }
.dsh-flex[data-align='end'] { align-items: flex-end; }
.dsh-flex[data-align='baseline'] { align-items: baseline; }
.dsh-flex[data-align='stretch'] { align-items: stretch; }
.dsh-flex[data-justify='start'] { justify-content: flex-start; }
.dsh-flex[data-justify='center'] { justify-content: center; }
.dsh-flex[data-justify='end'] { justify-content: flex-end; }
.dsh-flex[data-justify='between'] { justify-content: space-between; }
.dsh-flex[data-justify='around'] { justify-content: space-around; }
.dsh-flex[data-justify='evenly'] { justify-content: space-evenly; }
.dsh-flex[data-wrap='wrap'] { flex-wrap: wrap; }
.dsh-flex[data-wrap='nowrap'] { flex-wrap: nowrap; }
.dsh-flex[data-wrap='wrap-reverse'] { flex-wrap: wrap-reverse; }
.dsh-flex[data-min-width='0'], .dsh-box[data-min-width='0'] { min-width: 0; }
.dsh-flex[data-min-height='0'], .dsh-box[data-min-height='0'] { min-height: 0; }
.dsh-flex[data-flex-grow='1'], .dsh-box[data-flex-grow='1'] { flex-grow: 1; }
.dsh-flex[data-flex-shrink='0'], .dsh-box[data-flex-shrink='0'] { flex-shrink: 0; }
.dsh-flex[data-w='100%'], .dsh-box[data-w='100%'] { width: 100%; }
.dsh-flex[data-h='100%'], .dsh-box[data-h='100%'] { height: 100%; }
.dsh-flex[data-overflow='hidden'], .dsh-box[data-overflow='hidden'] { overflow: hidden; }
.dsh-flex[data-overflow='auto'], .dsh-box[data-overflow='auto'] { overflow: auto; }
.dsh-flex[data-overflow='scroll'], .dsh-box[data-overflow='scroll'] { overflow: scroll; }
.dsh-separator {
  background: var(--dsh-ui-line);
  border: 0;
  flex-shrink: 0;
}
.dsh-separator[data-orientation='horizontal'] { height: 0.5px; width: 100%; }
.dsh-separator[data-orientation='vertical'] { width: 0.5px; align-self: stretch; }
.dsh-separator[data-size='1'] { width: 25%; }
.dsh-separator[data-size='2'] { width: 50%; }
.dsh-separator[data-size='3'] { width: 75%; }
${spacingRules()}
`)
