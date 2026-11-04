/*
 * 对话整理（搭档单段对话）的设置命名空间：客户端与宿主共用的纯数据侧。
 * 命名空间由宿主侧 cordis entry（cordis.patch.yml 的 ui-bot）注册；
 * 本文件不得引入宿主专属依赖（schemastery 等），客户端 bundle 直接引用。
 */

export const BOT_SETTINGS_NAMESPACE = 'ui-bot'

export type BotSettings = { idleRecapMinutes: number; cacheTtlMinutes: number }

export const BOT_SETTINGS_DEFAULTS: BotSettings = { idleRecapMinutes: 15, cacheTtlMinutes: 60 }

/** Decode a raw namespace value; invalid fields fall back to defaults one by one. */
export function decodeBotSettings(value: unknown): BotSettings {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const idle = raw.idleRecapMinutes
  const ttl = raw.cacheTtlMinutes
  return {
    idleRecapMinutes: typeof idle === 'number' && Number.isInteger(idle) && idle >= 1 && idle <= 240 ? idle : BOT_SETTINGS_DEFAULTS.idleRecapMinutes,
    cacheTtlMinutes: typeof ttl === 'number' && Number.isInteger(ttl) && ttl >= 0 && ttl <= 1440 && (ttl === 0 || ttl >= 5) ? ttl : BOT_SETTINGS_DEFAULTS.cacheTtlMinutes,
  }
}
