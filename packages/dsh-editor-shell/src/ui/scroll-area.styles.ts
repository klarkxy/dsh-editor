import { defineStyles } from '../design-system/layers.ts'

defineStyles('dsh.components', 'dsh-scroll-area', `
.dsh-scroll-area { overflow: auto; min-height: 0; }
.dsh-scroll-area[data-scrollbars='vertical'] { overflow-y: auto; overflow-x: hidden; }
.dsh-scroll-area[data-scrollbars='horizontal'] { overflow-x: auto; overflow-y: hidden; }
`)
