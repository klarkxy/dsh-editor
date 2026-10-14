import { defineStyles } from '../design-system/layers.ts'

/* 宿主 Select 适配层（select.tsx）的外壳钩子：.select 包装 span 与
   .select-trigger 类名由该文件输出；触发器外观本体在 src/ui/select.styles.ts，
   设置页内的尺寸约束在 app/settings/settings.styles.ts。 */
defineStyles('dsh.components', 'dsh-host-select', `
.radix-themes .select { position: relative; display: inline-block; min-width: 0; }
`)
