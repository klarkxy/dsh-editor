/**
 * 旧版 dsh-editor 会话的迁移横幅：提示作者新建写作会话继续作品。
 * 只对 legacy preset 会话显示；关闭是按会话的内存态，不落盘、不删历史。
 */
export function shouldShowMigrationBanner(input: { legacy: boolean; dismissed: boolean }): boolean {
  return input.legacy && !input.dismissed
}
