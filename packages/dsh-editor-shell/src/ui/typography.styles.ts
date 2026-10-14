import { defineStyles } from '../design-system/layers.ts'

const SPACES: Record<string, string> = {
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

const marginRules = (): string => {
  const rules: string[] = []
  const props: [string, string][] = [
    ['m', 'margin'],
    ['mt', 'margin-top'],
    ['mb', 'margin-bottom'],
    ['mx', 'margin-inline'],
    ['my', 'margin-block'],
    ['ml', 'margin-left'],
    ['mr', 'margin-right'],
  ]
  for (const [attr, cssProp] of props) {
    for (const [step, value] of Object.entries(SPACES)) {
      rules.push(`:is(.dsh-text, .dsh-heading)[data-${attr}='${step}'] { ${cssProp}: ${value}; }`)
    }
  }
  return rules.join('\n')
}

defineStyles('dsh.components', 'dsh-typography', `
:is(.dsh-text, .dsh-heading)[data-size='xs'] { font-size: var(--dsh-ui-text-xs); }
:is(.dsh-text, .dsh-heading)[data-size='base'] { font-size: var(--dsh-ui-text-base); }
:is(.dsh-text, .dsh-heading)[data-size='md'] { font-size: var(--dsh-ui-text-md); }
:is(.dsh-text, .dsh-heading)[data-size='lg'] { font-size: var(--dsh-ui-text-lg); }
:is(.dsh-text, .dsh-heading)[data-size='xl'] { font-size: var(--dsh-ui-text-xl); }
:is(.dsh-text, .dsh-heading)[data-size='2xl'] { font-size: var(--dsh-ui-text-2xl); }
:is(.dsh-text, .dsh-heading)[data-tone='muted'] { color: var(--dsh-ui-muted); }
:is(.dsh-text, .dsh-heading)[data-tone='danger'] { color: var(--dsh-ui-danger); }
:is(.dsh-text, .dsh-heading)[data-tone='accent'] { color: var(--dsh-ui-accent); }
:is(.dsh-text, .dsh-heading)[data-tone='success'] { color: var(--dsh-ui-success); }
:is(.dsh-text, .dsh-heading)[data-tone='warning'] { color: var(--dsh-ui-warning); }
:is(.dsh-text, .dsh-heading)[data-tone='link'] { color: var(--dsh-ui-link); }
:is(.dsh-text, .dsh-heading)[data-tone='faint'] { color: var(--dsh-ui-faint); }
:is(.dsh-text, .dsh-heading)[data-weight='regular'] { font-weight: var(--dsh-ui-weight-regular); }
:is(.dsh-text, .dsh-heading)[data-weight='medium'] { font-weight: var(--dsh-ui-weight-medium); }
:is(.dsh-text, .dsh-heading)[data-weight='bold'], :is(.dsh-text, .dsh-heading)[data-weight='strong'] { font-weight: var(--dsh-ui-weight-strong); }
:is(.dsh-text, .dsh-heading)[data-align='center'] { text-align: center; }
:is(.dsh-text, .dsh-heading)[data-align='right'] { text-align: right; }
:is(.dsh-text, .dsh-heading)[data-align='left'] { text-align: left; }
:is(.dsh-text, .dsh-heading)[data-truncate] { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
:is(.dsh-text, .dsh-heading)[data-wrap='balance'] { text-wrap: balance; }
:is(.dsh-text, .dsh-heading)[data-wrap='nowrap'] { white-space: nowrap; }
:is(.dsh-text, .dsh-heading)[data-wrap='pretty'] { text-wrap: pretty; }
.dsh-heading { margin: 0; font-weight: var(--dsh-ui-weight-strong); line-height: var(--dsh-ui-leading-tight); text-wrap: balance; }
.dsh-text { margin: 0; }
${marginRules()}
`)
