#!/usr/bin/env python3
"""Remove source-string-assertion tests from client.spec.ts.

Two passes:
1. Drop whole `it(...)` blocks by exact title (pure source greps).
2. Trim source-grep line ranges inside kept behavioral tests.
"""
import io, re, sys

PATH = 'packages/dsh-editor-shell/src/client.spec.ts'
src = io.open(PATH, encoding='utf-8').read()

REMOVE_TITLES = [
    'keeps browser-native prompt and confirm out of the workbench UI',
    'creates 新建 in 文档/dsh-editor via an in-app name dialog, and only uses the directory picker for 打开作品',
    'opens an existing work even when import or restore status cannot be verified',
    'triggers the index run from the init guide card via the shared init-guide module',
    'auto-triggers the index after the interview when a proposal landed and the session goes idle',
    'keeps open and create as explicit flows without requiring the browse-only directory API',
    'creates files and folders from any directory through the generic tree actions',
    'exposes copy/cut/paste/delete/rename through the tree right-click menu',
    'shows about/update as a settings tab backed by the desktop bridge',
    'surfaces the startup update check as a dismissible toast',
    'restores search, export, and archive affordances without snapshot-library, import start, or shortcut dialogs',
    'lets the home recent list remove an entry after confirmation',
    'leaves novel_memory_update rows to the message-card registry',
    'reveals search hits through EditorCoreHandle.revealRange and drops the __cmView escape hatch',
    'cancels not-yet-fired draft sync before reload/conflict-copy delete and does not remount on a failed cleanup',
    'styles rewrite proposals and chat proposal chrome',
    'owns the settings dialog itself and drops the upstream DSH settings delegation',
    'keeps Zhihu in settings, drops desktop proofread chrome, and hides auxiliary files',
    'uses a workspace dropdown instead of overlapping 作品/切换 controls, and keeps the cover on the empty chapter',
    'keeps manuscript state on a workspace-scoped file session while chat follows the current conversation',
    'builds the workspace grid from pinnedLayoutColumns so a fourth pin track can sit beside the manuscript',
    'removes daily goal settings while preserving writing statistics and sidebar search',
    'exposes paper typography settings, EditorCore props, and recoverable conversation archive',
]

lines = src.split('\n')

# Pass 1: remove whole it blocks. Blocks are `  it('...'` .. matching `  })`.
out = []
i = 0
removed = []
while i < len(lines):
    line = lines[i]
    m = re.match(r"^  it\('(.+?)', ", line)
    if m and any(m.group(1) == t for t in REMOVE_TITLES):
        removed.append(m.group(1)[:50])
        # block ends at the next line that is exactly `  })` (body is 4+ spaces)
        i += 1
        while i < len(lines) and lines[i] != '  })':
            i += 1
        i += 1  # consume the closing line
        # skip a single trailing blank line
        if i < len(lines) and lines[i].strip() == '':
            i += 1
        continue
    out.append(line)
    i += 1

missing = [t for t in REMOVE_TITLES if not any(t[:50] == r for r in removed)]
if missing:
    print('NOT FOUND:', *missing, sep='\n  ')
    sys.exit(1)

src = '\n'.join(out)

# Pass 2: trim source-grep ranges inside kept tests.
TRIMS = [
    # accepts relocation only when...
    """    const relocated = rootSource().slice(
      rootSource().indexOf('async function verifyRelocatedWorkspaceSession'),
      rootSource().indexOf('function BoundProposalCard'),
    )
    expect(relocated).toContain('firstOpenDocumentPath')
    expect(relocated).toContain('supportedWorkspaceTextPaths(files)')
    expect(relocated).toContain("if (!initialPath) throw new Error('relocated workspace has no readable manuscript')")
    expect(relocated).not.toContain('sortChapterPaths')
""",
    # does not treat a dead session...
    """    const source = rootSource()
    expect(source).toContain('await ctx.workspaces.archiveSession(first)')
    expect(source).toContain('let second = await ctx.uiWorkspace.connectWorkspace(workspaceId)')
    expect(source).toContain('if (second === first) second = await ctx.uiWorkspace.createSession(workspaceId)')
    expect(source).not.toContain('ctx.sessions.create({ workspaceId })')
    const uiWorkspaceSource = readFileSync(new URL('./client/ui-workspace.ts', import.meta.url), 'utf8')
    expect(uiWorkspaceSource).toContain('if (!isSessionMissing(ping)) throw new Error(errorMessage(ping))')
    expect(uiWorkspaceSource).toContain('await ctx.workspaces.archiveSession(summary.id)')
""",
    # resumes the most recently updated...
    """    const finish = rootSource().slice(rootSource().indexOf('const finishWorkspaceOpen = async'))
    expect(finish).toContain('ctx.sessions.open(resumableConversationId(')
""",
    # renders every real directory...
    """    const sidebarSource = readFileSync(new URL('./client/sidebar.tsx', import.meta.url), 'utf8')
    expect(sidebarSource).not.toContain('STATIC_GROUPS')
    expect(sidebarSource).not.toContain('isManagedGroupName')
""",
    # recomputes registry palette enablement...
    """    const memo = rootSource().slice(
      rootSource().indexOf('const registryCommands = useMemo'),
      rootSource().indexOf('const refreshWrittenPath'),
    )
    expect(memo).toContain('registryPaletteItems(commands.list(), locale, seatRegistryContext, hasFileSession)')
    expect(memo).toContain('[commandTick, commands, hasFileSession, locale, seatContext, seatRegistryContext]')

""",
    # routes create and chapter metadata...
    """
    /* 源码断言:workbench 新端点必须真的被 chat.ts 路由,避免被某次重构回退到 /manuscript。 */
    const chatSource = readFileSync(new URL('./client/chat.tsx', import.meta.url), 'utf8')
    expect(chatSource).toMatch(/WORKBENCH_RPC_CHANNEL[\\s\\S]{0,400}proposal\\.prepare/)
    expect(chatSource).toMatch(/WORKBENCH_RPC_CHANNEL[\\s\\S]{0,400}proposal\\.apply/)
    expect(chatSource).toContain("expectedVersions")
    expect(chatSource).toMatch(/proposal\\.kind === 'split'/)
    expect(chatSource).toMatch(/proposal\\.kind === 'merge'/)
    expect(chatSource).toMatch(/proposal\\.kind === 'renames'/)
""",
]

for block in TRIMS:
    if block not in src:
        print('TRIM NOT FOUND:', block.split(chr(10))[1][:60] if '\n' in block else block[:60])
        sys.exit(1)
    src = src.replace(block, '')

io.open(PATH, 'w', encoding='utf-8').write(src)
print(f'removed {len(removed)} tests, applied {len(TRIMS)} trims')
