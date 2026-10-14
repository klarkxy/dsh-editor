/**
 * DSH Editor Panel Base
 *
 * Common infrastructure for panel packages:
 * - RPC communication patterns
 * - Request management (pub-sub)
 * - i18n message system
 * - 中文/阿拉伯数字自然序比较器
 * - 共享面板外观组件见 `./chrome`（依赖 React，单独导出避免拖累纯逻辑使用者）
 *
 * @packageDocumentation
 */

// Re-export all modules
export * from './rpc/index.js'
export * from './requests/index.js'
export * from './messages/index.js'
export * from './natural-order.js'
