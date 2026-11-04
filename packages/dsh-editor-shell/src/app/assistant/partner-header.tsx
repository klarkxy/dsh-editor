import type { ReactNode } from 'react'
import './assistant.styles.ts'

/* 搭档页头本体渲染在辅助栏页签行右端的动作位（chat.tsx 经 portal 挂载）；
   会话列表与「新对话」已并入单段对话模型，页头只剩 trailing 槽。 */

export function PartnerHeader(props: { trailing?: ReactNode }) {
  return (
    <div className="dsh-partner__head" data-testid="dsh-partner-head">
      {props.trailing}
    </div>
  )
}
