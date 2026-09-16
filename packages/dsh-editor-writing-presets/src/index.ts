/*
 * This package is never loaded as a Cordis plugin: its empty bundle patch
 * keeps it a profile layer so `presets/` ships inside the desktop profile,
 * and the desktop template channel deploys the declared presets.
 */
export const WRITING_PRESET_IDS = ['dsh-editor-article', 'dsh-editor-technical'] as const
