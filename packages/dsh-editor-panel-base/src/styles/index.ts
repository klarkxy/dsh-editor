/**
 * Common styling utilities for panels.
 * 
 * Provides:
 * - Design token integration (surfaceTokenAliases)
 * - Animation helpers (fade-in, slide-in)
 * - Accessibility patterns (focus-visible, reduced-motion)
 * 
 * @module dsh-editor-panel-base/styles
 */

import { surfaceTokenAliases } from 'dsh-editor-seats/tokens'

/**
 * Standard panel fade-in animation.
 */
export function panelFadeInAnimation(name: string): string {
  return `@keyframes ${name} { from { opacity: 0; transform: translateY(8px); } }`
}

/**
 * Common panel container styles with design tokens.
 * 
 * @param className - Panel root class name
 * @param animationName - Optional keyframe animation name
 * @param maxHeight - Optional max-height value (default: 'min(40vh, 320px)')
 * @returns CSS string with token aliases and base styles
 */
export function panelContainerStyles(
  className: string,
  animationName?: string,
  maxHeight = 'min(40vh, 320px)'
): string {
  const animation = animationName
    ? `animation: ${animationName} 250ms cubic-bezier(0.22, 1, 0.36, 1) both;`
    : ''
  
  return `
.radix-themes .${className} {
${surfaceTokenAliases}
  margin: 0 var(--space-2) var(--space-2);
  padding: var(--space-3);
  max-height: ${maxHeight};
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  border: 0;
  border-radius: var(--s-radius-panel);
  background: var(--s-raised);
  box-shadow: var(--s-elevate);
  font-family: var(--s-font);
  font-size: var(--font-size-2);
  color: var(--s-text);
  ${animation}
}`
}

/**
 * Common focus-visible styles for accessibility.
 * Supports keyboard navigation and forced-colors mode.
 * 
 * @param panelClass - Panel root class name
 * @returns CSS string with focus styles
 */
export function panelFocusStyles(panelClass: string): string {
  return `
.${panelClass} button:focus:not([class^="rt-"]):not([class*=" rt-"]),
.${panelClass} input:focus:not([class^="rt-"]):not([class*=" rt-"]),
.${panelClass} select:focus:not([class^="rt-"]):not([class*=" rt-"]),
.${panelClass} textarea:focus,
.${panelClass} a:focus:not([class^="rt-"]):not([class*=" rt-"]) {
  outline: none;
}

.${panelClass} button:focus-visible:not([class^="rt-"]):not([class*=" rt-"]),
.${panelClass} input:focus-visible:not([class^="rt-"]):not([class*=" rt-"]),
.${panelClass} select:focus-visible:not([class^="rt-"]):not([class*=" rt-"]),
.${panelClass} textarea:focus-visible,
.${panelClass} a:focus-visible:not([class^="rt-"]):not([class*=" rt-"]),
.${panelClass} [tabindex]:focus-visible:not([class^="rt-"]):not([class*=" rt-"]) {
  box-shadow: var(--s-focus-shadow);
}

@media (forced-colors: active) {
  .${panelClass} button:focus-visible:not([class^="rt-"]):not([class*=" rt-"]),
  .${panelClass} input:focus-visible:not([class^="rt-"]):not([class*=" rt-"]),
  .${panelClass} select:focus-visible:not([class^="rt-"]):not([class*=" rt-"]),
  .${panelClass} textarea:focus-visible,
  .${panelClass} a:focus-visible:not([class^="rt-"]):not([class*=" rt-"]) {
    outline: 2px solid CanvasText;
    outline-offset: 2px;
  }
}`
}

/**
 * Disable animations for reduced-motion preference.
 * 
 * @param panelClass - Panel root class name
 * @param additionalSelectors - Additional selectors to disable animations on
 * @returns CSS string with prefers-reduced-motion media query
 */
export function panelReducedMotion(panelClass: string, additionalSelectors: string[] = []): string {
  const selectors = [
    `.radix-themes .${panelClass}`,
    `.radix-themes .${panelClass} *`,
    ...additionalSelectors,
  ].join(', ')
  
  return `
@media (prefers-reduced-motion: reduce) {
  ${selectors} {
    animation: none !important;
    transition: none !important;
    transform: none !important;
  }
}`
}

/**
 * Build complete panel stylesheet with all common patterns.
 * 
 * @example
 * ```ts
 * export const memoryPanelStyles = buildPanelStyles({
 *   panelClass: 'memory-panel',
 *   animationName: 'memory-panel-in',
 *   customStyles: `
 *     .memory-panel .custom-element { color: red; }
 *   `,
 * })
 * ```
 */
export function buildPanelStyles(config: {
  panelClass: string
  animationName?: string
  maxHeight?: string
  customStyles?: string
  additionalReducedMotionSelectors?: string[]
}): string {
  const parts: string[] = []
  
  // Animation keyframe
  if (config.animationName) {
    parts.push(panelFadeInAnimation(config.animationName))
  }
  
  // Container
  parts.push(panelContainerStyles(config.panelClass, config.animationName, config.maxHeight))
  
  // Custom panel-specific styles
  if (config.customStyles) {
    parts.push(config.customStyles)
  }
  
  // Focus styles
  parts.push(panelFocusStyles(config.panelClass))
  
  // Reduced motion
  parts.push(panelReducedMotion(config.panelClass, config.additionalReducedMotionSelectors))
  
  return parts.join('\n')
}

/**
 * Re-export design tokens for convenience.
 */
export { surfaceTokenAliases }
