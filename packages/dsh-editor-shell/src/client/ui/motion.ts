import { m, useReducedMotion } from 'motion/react'

export { m }

/** Entrance for home cards, search chrome, settings pages, sidebar panels, and new chat messages. Reduced motion drops translation/scale/spring. */
export function useChromeMotion(kind: 'card' | 'panel' | 'page' | 'message', delay = 0) {
  const reduce = useReducedMotion()
  if (reduce) {
    return {
      initial: false as const,
      animate: { opacity: 1, y: 0, scale: 1 },
      transition: { duration: 0 },
      whileHover: undefined,
      whileTap: undefined,
    }
  }
  if (kind === 'card') {
    return {
      initial: { opacity: 0, y: 8, scale: 0.98 },
      animate: { opacity: 1, y: 0, scale: 1 },
      whileHover: { y: -2 },
      whileTap: { y: -1 },
      transition: { type: 'spring' as const, stiffness: 420, damping: 28, mass: 0.75, delay },
    }
  }
  if (kind === 'message') {
    return {
      initial: { opacity: 0, y: 8 },
      animate: { opacity: 1, y: 0 },
      whileHover: undefined,
      whileTap: undefined,
      transition: { type: 'spring' as const, stiffness: 420, damping: 32, mass: 0.7, delay },
    }
  }
  return {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    whileHover: undefined,
    whileTap: undefined,
    transition: { type: 'spring' as const, stiffness: 360, damping: 32, mass: 0.85, delay },
  }
}
