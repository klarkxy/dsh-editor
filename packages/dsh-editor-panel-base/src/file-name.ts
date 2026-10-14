/** .md/.txt 只在显示层去掉扩展名（与 shell 文件栏同一规则），路径与 title 保持原名。 */
export function displayTreeFileName(name: string): string {
  return name.replace(/\.(?:md|txt)$/i, '')
}
