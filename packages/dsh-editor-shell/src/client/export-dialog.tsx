import { Fragment, useRef, useState, type RefObject } from 'react';
import { Callout, Card, Flex, Heading, ScrollArea, Text } from '@radix-ui/themes'
import { ActivityDots, ActivityRing, ActivitySkeleton, ActivityText, Button, Dialog } from './ui/index.ts'
import { Checkbox } from '../ui/checkbox.tsx'
import { SegmentedControl } from '../ui/segmented-control.tsx'
import { errorMessage, safeRpcCall, type RpcResult, type ShellContext } from './shared.ts'
import { sanitizeExportTitle, type ChapterExport, type ExportFormat } from '../export.ts'
import { displayTreeFileName, isAuthorFacingDocumentPath, isHiddenProjectPath, normalizeProjectDirectory, sortDocumentPaths } from '../project-files.ts'
import { buildBook } from '../export-book.ts'
import { buildDocxBlob } from '../export-docx.ts'
import { buildEpubBlob } from '../export-epub.ts'
import { t } from '../i18n/index.ts'
import { downloadBlob, downloadExport, previewExport } from '../model/export-dialog.ts'
import {
  defaultExportSelection,
  dirSelectionState,
  groupExportDocuments,
  setDirSelection,
  setDocSelection,
} from '../model/export-selection.ts'

export async function collectDocuments(ctx: ShellContext, sessionId: string, directory: string): Promise<ChapterExport[]> {
  const root = normalizeProjectDirectory(directory)
  if (root && isHiddenProjectPath(root)) return []
  const queue = [root]
  const files: string[] = []
  while (queue.length) {
    const current = queue.shift()!
    const listed = await safeRpcCall<{ entries?: { name: string; type: 'file' | 'directory' | 'other' }[] }>(() => ctx.connection.rpc.call('/manuscript', 'tree.list', {
      sessionId,
      path: current || '.',
    }))
    if (!listed.ok) throw new Error(errorMessage(listed))
    for (const entry of listed.value.entries ?? []) {
      if (entry.name.startsWith('.')) continue
      const child = current ? `${current}/${entry.name}` : entry.name
      if (isHiddenProjectPath(child)) continue
      if (entry.type === 'directory') queue.push(child)
      else if (entry.type === 'file' && isAuthorFacingDocumentPath(child)) files.push(child)
    }
  }
  return await Promise.all(sortDocumentPaths(files).map(async (path) => {
    const read = await ctx.connection.rpc.call('/manuscript', 'file.read', { sessionId, path }) as RpcResult<{ text: string }>
    if (!read.ok) throw new Error(errorMessage(read))
    return { path, text: read.value.text }
  }))
}


type PackFormat = 'docx' | 'epub'
type PrecheckFormat = ExportFormat | PackFormat

const FORMAT_OPTIONS: { value: PrecheckFormat; label: string }[] = [
  { value: 'markdown', label: 'Markdown' },
  { value: 'text', label: 'TXT' },
  { value: 'docx', label: 'DOCX' },
  { value: 'epub', label: 'EPUB' },
]

function ExportPreviewDialog(props: {
  open?: boolean
  chapters: readonly ChapterExport[]
  title: string
  busy: boolean
  note?: string
  onCancel(): void
  onExport(format: ExportFormat, paths: readonly string[]): void
  returnFocusRef?: RefObject<HTMLElement | null>
}) {
  const open = props.open ?? true
  const cancel = useRef<HTMLButtonElement | null>(null)
  const shown = useRef({ chapters: props.chapters, title: props.title })
  if (open) shown.current = { chapters: props.chapters, title: props.title }
  const [packing, setPacking] = useState<PackFormat | null>(null)
  const [packNote, setPackNote] = useState<string>()
  const [format, setFormat] = useState<PrecheckFormat>('markdown')
  /* §8 预检：文档按目录分组,目录行是三态复选(部分选中 → indeterminate),
     默认只勾「正文」组、没有正文组时全勾。 */
  const groups = groupExportDocuments(shown.current.chapters.map((chapter) => chapter.path))
  const groupsKey = groups.map((group) => `${group.dir}=${group.paths.join(',')}`).join('|')
  const [selection, setSelection] = useState<{ key: string; paths: Set<string> }>({ key: '', paths: new Set() })
  const selected = selection.key === groupsKey ? selection.paths : defaultExportSelection(groups)
  const selectedChapters = shown.current.chapters.filter((chapter) => selected.has(chapter.path))
  const preview = selectedChapters.length ? previewExport(selectedChapters, shown.current.title) : { chapters: [], totalChars: 0 }
  const empty = preview.chapters.filter((item) => item.empty)
  const busy = props.busy || packing !== null
  /* 章节收集是既有的不可取消异步操作:此时还没有章节,展示紧凑加载块,
     不渲染 0 摘要或可点的格式按钮;busy 结束后回到原预览/错误态。
     收集期间只用本次的 props.note:packNote 属于上一轮打包的完成/失败留言,
     弹窗常驻重用,不能盖住新一轮收集的 exportPreparing。 */
  const collecting = props.busy && shown.current.chapters.length === 0
  /* 打包一开始就清空 packNote,此刻 props.note 往往还是上一轮的"已生成/已就绪"
     完成留言:在途期间用它顶替,圆点也只配给这条真正的在途文案。 */
  const packingNote = packing ? t('workspace.exporting') : undefined
  const note = collecting ? props.note : packingNote ?? packNote ?? props.note
  const exportPacked = async (kind: PackFormat) => {
    if (busy || !selectedChapters.length) return
    setPacking(kind)
    setPackNote(undefined)
    try {
      const book = buildBook(selectedChapters, props.title)
      const blob = kind === 'docx' ? await buildDocxBlob(book) : await buildEpubBlob(book)
      const filename = `${sanitizeExportTitle(props.title)}.${kind}`
      downloadBlob(filename, blob)
      setPackNote(t('note.exportGenerated', { filename }))
    } catch (error) {
      setPackNote(error instanceof Error ? error.message : t('note.exportFailed'))
    } finally {
      setPacking(null)
    }
  }
  const submit = () => {
    if (!selectedChapters.length) return
    if (format === 'docx' || format === 'epub') void exportPacked(format)
    else props.onExport(format, selectedChapters.map((chapter) => chapter.path))
  }
  const noteFailed = Boolean(note && /无法|失败|为空|empty|failed|cannot/i.test(note))
  const noneSelected = !selectedChapters.length
  return (
    <Dialog
      open={open}
      onOpenChange={(next: boolean) => { if (!next && !busy) props.onCancel() }}
      title={t('export.fullText')}
      className="file-dialog export-preview-dialog file-dialog-overlay"
      overlayClassName="file-dialog-overlay"
      testid="dsh-export-precheck"
      dismissible={!busy}
      initialFocusRef={cancel}
      returnFocusRef={props.returnFocusRef}>
      <Flex direction="column" gap="3">
        <Flex direction="column" gap="1">
          <Text size="1" color="gray">
            {t('export.title')}
          </Text>
          <Heading as="h2" size="4" id="export-preview-title">
            {t('export.fullText')}
          </Heading>
        </Flex>
        {collecting ? <Flex className="export-loading" direction="column" align="center" gap="3">
          <ActivityRing size={24} />
          <ActivityText cue="none">
            {note || t('note.exportPreparing')}
          </ActivityText>
          <ActivitySkeleton lines={3} />
        </Flex> : null}
        {collecting ? null : <Flex className="export-summary" gap="3">
          <Flex direction="column" gap="1">
            <Text size="1" color="gray">
              {t('export.chapters')}
            </Text>
            <Text size="3" weight="medium">
              {preview.chapters.length}
            </Text>
          </Flex>
          <Flex direction="column" gap="1">
            <Text size="1" color="gray">
              {t('export.totalChars')}
            </Text>
            <Text size="3" weight="medium">
              {preview.totalChars}
            </Text>
          </Flex>
        </Flex>}
        {empty.length ? <Callout.Root className="warning" color="amber" role="alert" size="1">
          <Callout.Text>
            {t('export.emptyWarning', { count: empty.length })}
          </Callout.Text>
        </Callout.Root> : null}
        {note && !collecting ? <Callout.Root
          className={noteFailed ? 'warning' : undefined}
          color={noteFailed ? 'red' : 'gray'}
          role={noteFailed ? 'alert' : 'status'}
          size="1">
          <Callout.Text>
            {packingNote ? <ActivityDots /> : null}
            {note}
          </Callout.Text>
        </Callout.Root> : null}
        {collecting ? null : <Card>
          <ScrollArea className="export-chapters" type="auto" scrollbars="vertical">
            <Flex direction="column" gap="2">
              {groups.map((group) => (
                <div key={group.dir || '.'} className="export-group" data-testid="dsh-export-group" data-dir={group.dir}>
                  <Checkbox
                    className="export-group__dir"
                    checked={dirSelectionState(group, selected)}
                    disabled={busy}
                    label={group.dir || t('export.rootGroup')}
                    onCheckedChange={(checked) => setSelection({ key: groupsKey, paths: setDirSelection(group, selected, checked === true) })} />
                  <div className="export-group__docs" data-testid="dsh-export-docs">
                    {group.paths.map((path) => {
                      const chapter = shown.current.chapters.find((item) => item.path === path)
                      return <Checkbox
                        key={path}
                        className="export-doc"
                        checked={selected.has(path)}
                        disabled={busy}
                        /* §3 文件名规则：显示名去扩展名，完整路径留在 title。 */
                        label={<span title={path}>{displayTreeFileName(group.dir ? path.slice(group.dir.length + 1) : path)}</span>}
                        description={chapter ? `${t('export.chapterMeta', { chars: chapter.text.length })}${chapter.text.trim() ? '' : t('export.chapterEmpty')}` : undefined}
                        onCheckedChange={(checked) => setSelection({ key: groupsKey, paths: setDocSelection(selected, path, checked === true) })} />
                    })}
                  </div>
                </div>
              ))}
            </Flex>
          </ScrollArea>
        </Card>}
        {collecting ? null : <Flex direction="column" gap="3">
          <SegmentedControl
            aria-label={t('export.format')}
            value={format}
            disabled={busy}
            onValueChange={(next) => setFormat(next as PrecheckFormat)}
            options={FORMAT_OPTIONS} />
          <Flex justify="end" gap="2" wrap="wrap">
            <Button ref={cancel} disabled={busy} onClick={props.onCancel}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              className="primary-action"
              disabled={busy || noneSelected}
              title={noneSelected ? t('export.noSelection') : undefined}
              onClick={submit}>
              {packing ? <Fragment>
                <ActivityDots />
                {t('workspace.exporting')}
              </Fragment> : t('export.submit')}
            </Button>
          </Flex>
        </Flex>}
      </Flex>
    </Dialog>
  );
}

export { ExportPreviewDialog }
