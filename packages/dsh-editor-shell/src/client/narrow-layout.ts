/*
 * 窄窗让位规则：辅助栏在稿纸旁放不下时收起，窗口变宽后恢复作者原本的选择。
 *
 * 窗口变窄是一次性的尺寸事件，不是作者做出的布局选择。早期实现直接把收起
 * 写进 localStorage，作者把窗口缩小一次就会永久失去稿件目录，而且恢复不回来。
 * 这里把规则收敛成纯函数：yielded 记住的是「窗口时代替作者做的决定」。
 *
 * authored 是让「显式操作压过窗口规则」真正成立的另一半：作者在当前档位下
 * 自己开合过面板，窗口规则就交出控制权，直到档位再次变化。只有清空 yielded
 * 而没有 authored 时，作者在窄窗点开的面板会被紧随其后的宽度结算立刻关掉，
 * 窄窗下的展开按钮等于失效。
 *
 * crowded 记的是上一次结算时的档位，用来判断档位有没有变过：变了就说明作者
 * 当时的接管不再算数，规则重新接手，否则两个面板可能同时留在窄窗里叠在一起。
 */

export interface RailWidthState {
  /** 面板当前是否展开。 */
  open: boolean
  /** 窗口时代替作者收起时记下的选择；作者自己操作后为 null。 */
  yielded: boolean | null
  /** 上一次结算时的档位；与本次不同即视为窗口换了档位。 */
  crowded: boolean
  /** 作者在当前档位下自己开合过，窗口规则不再替他改动。 */
  authored: boolean
}

/** 只含窗口记账的字段；面板开关本身仍由组件 state 持有。 */
export type RailYieldState = Omit<RailWidthState, 'open'>

// 档位变了就说明作者的接管是针对另一段窗口做的，连同让位标记一起作废。
const settled = (input: RailWidthState, crowded: boolean): RailWidthState => (
  input.crowded === crowded ? input : { ...input, crowded, authored: false }
)

/**
 * 结算一条辅助栏在当前宽度下的状态。
 *
 * @param crowded 稿纸旁已经放不下这条辅助栏。
 * @param force 忽略作者接管强制让位；只用于窄窗下两条栏互相排斥的场景。
 */
export function railAtWidth(input: RailWidthState, crowded: boolean, force = false): RailWidthState {
  // 档位变了：作者上次的选择是针对另一段窗口做的，规则重新接手。
  const authored = !force && input.crowded === crowded ? input.authored : false
  if (authored) return settled(input, crowded)
  if (crowded) {
    // 已经让位过一次就不要反复记账，否则作者手动打开后会被立刻关掉。
    if (!input.open || input.yielded !== null) return settled(input, crowded)
    return { open: false, yielded: input.open, crowded, authored: false }
  }
  if (input.yielded === null) return settled(input, crowded)
  return { open: input.yielded, yielded: null, crowded, authored: false }
}

/** 作者显式开合面板：这条选择压过任何窗口让位，直到窗口换档。 */
export function railByAuthor(open: boolean, crowded: boolean): RailWidthState {
  return { open, yielded: null, crowded, authored: true }
}
