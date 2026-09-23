"""Temporary, branch-only integration helper. Remove before merging the PR."""
from pathlib import Path
import hashlib
import json

expected = {
    'packages/dsh-manuscript/src/client/editor-core/editor.tsx': '10d6564882c6b645d7628945db031795c8eb4b54',
    'packages/dsh-editor-shell/src/client/editor.tsx': '41457398d156865e8ff5e07ebe801e075094cdbf',
    'packages/dsh-editor-shell/src/client/editor-menu.tsx': '27ed8690a540912794b06206e6f964eea735539b',
    'packages/dsh-editor-shell/src/client/root-columns.tsx': '9b7a19c6425e712d255f9d223b800d71bcd2fe1c',
    'packages/dsh-editor-shell/src/client/root.tsx': '8d060164df08f77657b340780b2ce86f7be7972f',
    'packages/dsh-editor-shell/src/i18n/messages.zh.ts': '3bbccd0a93f29f736000aa0fe9c6c9403b0812f4',
    'packages/dsh-editor-shell/src/i18n/messages.en.ts': 'c840de3933a48e52189ed4344077fbf22a7254c3',
    'docs/user-guide.md': '41412571ffc6744277939545af696c14b82211b4',
}
texts = {}
for filename, sha in expected.items():
    data = Path(filename).read_bytes()
    actual = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
    if actual != sha:
        raise RuntimeError(f'Refusing to patch changed source: {filename}: {actual} != {sha}')
    texts[filename] = data.decode('utf-8')

def replace(filename, old, new):
    text = texts[filename]
    if text.count(old) != 1:
        raise RuntimeError(f'Expected one exact anchor in {filename}: {old[:100]!r}')
    texts[filename] = text.replace(old, new, 1)

core = 'packages/dsh-manuscript/src/client/editor-core/editor.tsx'
replace(core, "import { focusParagraphExtension, typewriterExtension } from './typewriter.ts'\n", "import { focusParagraphExtension, typewriterExtension } from './typewriter.ts'\nimport { SelectionDiff } from './selection-diff.tsx'\nimport { selectParagraphInView } from './paragraph-selection.ts'\n")
replace(core, '  selectAll(): boolean\n', '  selectAll(): boolean\n  /** Select a visible paragraph without changing text; optional for older hosts. */\n  selectParagraph?(target?: EditorTargetSnapshot): boolean\n')
replace(core, '      replaceSelection,\n', '''      selectParagraph: (target) => {
        const view = viewRef.current
        if (!view || !isDocumentReady() || view.composing) return false
        if (target && !restoreTarget(target)) return false
        return selectParagraphInView(view)
      },
      replaceSelection,
''')
replace(core, '''{showProposalDiff ? <div className="selection-diff">
          <section className="selection-diff-original">
            <small>
              原文
            </small>
            <p>
              {proposal.ticket.selectedText}
            </p>
          </section>
          <section className="selection-diff-revised">
            <small>
              修改后
            </small>
            <p>
              {proposal.text}
            </p>
          </section>
        </div> : <p>''', '''{showProposalDiff ? <SelectionDiff original={proposal.ticket.selectedText} revised={proposal.text} /> : <p>''')

editor = 'packages/dsh-editor-shell/src/client/editor.tsx'
replace(editor, "import { t } from '../i18n/index.ts'\n", "import { t } from '../i18n/index.ts'\nimport type { SearchHit } from './search-panel.tsx'\nimport { normalizeReferenceQuery } from './reference-lookup.ts'\nimport { ReferenceLookupDialog } from './reference-lookup-dialog.tsx'\n")
replace(editor, '  files: string[]\n  create(): void\n', '''  files: string[]
  referenceFiles?: readonly string[]
  referenceRevision?: number
  onOpenReference?(path: string, hit?: SearchHit): void
  onPinReference?(path: string): void
  create(): void
''')
replace(editor, "  const [customTarget, setCustomTarget] = useState<EditorTargetSnapshot | null>(null)\n", "  const [customTarget, setCustomTarget] = useState<EditorTargetSnapshot | null>(null)\n  const [referenceQuery, setReferenceQuery] = useState<string | null>(null)\n")
replace(editor, "    if (action === 'selectAll') { if (live.canSelectAll) handle.selectAll(); return }\n", "    if (action === 'selectAll') { if (live.canSelectAll) handle.selectAll(); return }\n    if (action === 'selectParagraph') { if (live.canSelectAll) afterMenu(() => handleRef.current?.selectParagraph?.(target ?? undefined)); return }\n    if (action === 'lookupReferences') {\n      const query = normalizeReferenceQuery(target?.selectedText ?? '')\n      if (query && props.onOpenReference && props.onPinReference) afterMenu(() => setReferenceQuery(query))\n      return\n    }\n")
replace(editor, '  }, [menuTarget, path, closeMenus])\n', '  }, [menuTarget, path, closeMenus, props.onOpenReference, props.onPinReference])\n')
replace(editor, '    canRewritePath: canRewritePath(path) && completionEnabled,\n', '''    canRewritePath: canRewritePath(path) && completionEnabled,
    canSelectParagraph: menuState.canSelectAll && Boolean(handleRef.current?.selectParagraph),
    canLookupReferences: menuState.canCopy && Boolean(props.onOpenReference && props.onPinReference && normalizeReferenceQuery(menuTarget?.selectedText ?? '')),
''')
replace(editor, '    setCustomTarget(null)\n', '    setCustomTarget(null)\n    setReferenceQuery(null)\n')
replace(editor, '      {contextMenu ? <EditorContextMenu\n', '''      {referenceQuery && props.onOpenReference && props.onPinReference ? <ReferenceLookupDialog
        key={`${session.sessionId}:${path}:${referenceQuery}`}
        ctx={ctx}
        sessionId={session.sessionId}
        query={referenceQuery}
        files={props.referenceFiles ?? files}
        revision={props.referenceRevision ?? externalRevision}
        returnFocusRef={editorFocusTarget}
        onClose={() => setReferenceQuery(null)}
        onOpen={props.onOpenReference}
        onPin={props.onPinReference} /> : null}
      {contextMenu ? <EditorContextMenu
''')

menu = 'packages/dsh-editor-shell/src/client/editor-menu.tsx'
replace(menu, "  | 'selectAll'\n", "  | 'selectAll'\n  | 'selectParagraph'\n  | 'lookupReferences'\n")
replace(menu, '  canRewritePath: boolean\n', '  canRewritePath: boolean\n  canSelectParagraph?: boolean\n  canLookupReferences?: boolean\n')
replace(menu, '''      <MenuItem className={ITEM} disabled={!state.canSelectAll} data-testid="editor-menu-select-all" onSelect={() => props.onAction('selectAll')}>{t('editor.selectAll')}</MenuItem>
''', '''      <MenuItem className={ITEM} disabled={!state.canSelectAll} data-testid="editor-menu-select-all" onSelect={() => props.onAction('selectAll')}>{t('editor.selectAll')}</MenuItem>
      <MenuItem className={ITEM} disabled={!props.model.canSelectParagraph} data-testid="editor-menu-select-paragraph" onSelect={() => props.onAction('selectParagraph')}>{t('editor.selectParagraph')}</MenuItem>
''')
replace(menu, '''      <MenuItem className={ITEM} disabled={!state.canReplace} data-testid="editor-menu-replace" onSelect={() => props.onAction('replace')}>{t('editor.replace')}</MenuItem>
''', '''      <MenuItem className={ITEM} disabled={!state.canReplace} data-testid="editor-menu-replace" onSelect={() => props.onAction('replace')}>{t('editor.replace')}</MenuItem>
      <MenuItem className={ITEM} disabled={!props.model.canLookupReferences} data-testid="editor-menu-lookup-references" onSelect={() => props.onAction('lookupReferences')}>{t('reference.title')}</MenuItem>
''')

columns = 'packages/dsh-editor-shell/src/client/root-columns.tsx'
replace(columns, '  files: string[]\n  onCreate(): void\n', '''  files: string[]
  referenceFiles?: readonly string[]
  referenceRevision?: number
  onOpenReference?(path: string, hit?: SearchHit): void
  onPinReference?(path: string): void
  onCreate(): void
''')
replace(columns, '        files={files}\n        create={props.onCreate}\n', '''        files={files}
        referenceFiles={props.referenceFiles}
        referenceRevision={props.referenceRevision}
        onOpenReference={props.onOpenReference}
        onPinReference={props.onPinReference}
        create={props.onCreate}
''')
root = 'packages/dsh-editor-shell/src/client/root.tsx'
replace(root, '              files={isManuscriptChapterPath(path) ? chapterFiles : files}\n', '''              files={isManuscriptChapterPath(path) ? chapterFiles : files}
              referenceFiles={files}
              referenceRevision={treeRevision}
              onOpenReference={openDocument}
              onPinReference={setPinnedPath}
''')

messages = {
    'editor.selectParagraph': ('选中当前段落', 'Select current paragraph'),
    'reference.title': ('查相关资料', 'Find related references'),
    'reference.query': ('所选文字：{query}', 'Selected text: {query}'),
    'reference.description': ('按文件名和正文查找已有的人物卡、世界书。同名结果分别显示，不会自动整理或修改资料。', 'Search existing character and worldbook filenames and text. Same-named sources remain separate; nothing is created or changed.'),
    'reference.results': ('相关资料候选', 'Related reference candidates'),
    'reference.noMatch': ('当前资料文件中未找到匹配项。', 'No matches in the current reference files.'),
    'reference.partial': ('结果可能不完整：搜索或显示已达上限，或有 {skipped} 项被跳过。', 'Results may be incomplete: search/display limits were reached, or {skipped} items were skipped.'),
    'reference.failed': ('未能搜索 {directory}：{error}', 'Could not search {directory}: {error}'),
    'reference.open': ('打开资料', 'Open reference'),
    'reference.pin': ('钉在旁边', 'Pin beside manuscript'),
}
for locale, index, anchor in [('zh', 0, 'export const zh = {\n'), ('en', 1, 'export const en: { [K in keyof typeof zh]: string } = {\n')]:
    filename = f'packages/dsh-editor-shell/src/i18n/messages.{locale}.ts'
    addition = ''.join(f"  {json.dumps(key)}: {json.dumps(values[index], ensure_ascii=False)},\n" for key, values in messages.items())
    replace(filename, anchor, anchor + addition + '\n')
texts['docs/user-guide.md'] += '''

## 按词审稿与按需查资料

选段改写的预览会分别标出删除和新增的词语，中文按词比较，并保留原来的空白、标点和换行。超长或差异过多的文本会降级为较粗的对照，不影响稿纸输入。仍然整项「应用修改」或「放弃」，不支持逐词采纳；正文变化后，旧提案照常失效。差异结果仅用于展示，不参与拼接写入。

在稿纸选中一个名称，通过右键或顶栏更多菜单选择「查相关资料」，按需查询当前文件列表中的 `人物卡/` 与 `世界书/`。文件名和文件正文都可命中，同名但不同路径的资料分别显示。结果可「打开资料」或「钉在旁边」；打开时沿用既有的保存与版本检查，钉住时沿用只读资料栏。查询不需要开启人物卡面板，不自动建立索引、创建卡片、修改资料或注入模型上下文。搜索失败、跳过或截断会明确提示。

稿纸菜单中的「选中当前段落」复用聚焦段落的空行分隔规则，仅改变可见稿纸中的选区，不改变文件内容，也不会选中隐藏的文件头。选中后可继续使用现有的复制或改写操作。它不是 Markdown 语法树选块，也不会给段落生成持久化 ID。
'''
for filename, text in texts.items():
    Path(filename).write_text(text, encoding='utf-8')
    print(f'Integrated {filename}')
