export type RewritePresetId = 'sensory' | 'tighten' | 'show' | 'dialogue'

export const REWRITE_PRESETS: ReadonlyArray<{ id: RewritePresetId; label: string; instruction: string }> = [
  { id: 'sensory', label: '感官展开', instruction: '在不增加新情节的前提下，补入视觉、听觉、触觉或气味等具体感官细节，让场景可感；长度可增加至原文的 1.5 倍以内。' },
  { id: 'tighten', label: '缩短', instruction: '删去冗余修饰、重复信息与解释性句子，保留全部情节要点与人物动作；长度压到原文的 60% 左右。' },
  { id: 'show', label: '去说明', instruction: '把直接陈述情绪或性格的句子改为动作、对话或环境暗示，不直接告诉读者人物在想什么。' },
  { id: 'dialogue', label: '对话节奏', instruction: '让对话更口语、更短促，删去多余的“他说/她说”，用动作和停顿替代部分提示语，保持每个人物的说话习惯。' },
]
