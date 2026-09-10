import { readProjectRules, ensureProjectRules, WorkspaceAuthorityError } from 'dsh-manuscript/host-api'
import {
  createDirectory,
  createManuscriptGroup,
  createProjectHome,
  defaultProjectsRoot,
  initializeProject,
  inspectProjectRoot,
  prepareNovelIndex,
} from '../project.ts'
import { str, type WorkbenchHandlers } from './types.ts'

export const projectHandlers = {
  'project.inspect': {
    sessionless: true,
    async run({ host, body, signal }) {
      const workspacePath = str(body, 'workspacePath')
      if (!workspacePath) throw new WorkspaceAuthorityError('workspace path is required', 'WORKSPACE_NOT_FOUND', { workspacePath })
      let workspace
      try {
        workspace = await host.workspaceRegistry.resolveByPath(workspacePath)
      } catch (error) {
        throw new WorkspaceAuthorityError('workspace is unavailable', 'WORKSPACE_UNAVAILABLE', { workspacePath }, { cause: error })
      }
      if (!workspace) throw new WorkspaceAuthorityError('workspace is not registered', 'WORKSPACE_NOT_FOUND', { workspacePath })
      return await inspectProjectRoot(workspace.path, signal)
    },
  },
  'project.createHome': {
    sessionless: true,
    async run({ body, signal }) {
      return await createProjectHome({ root: defaultProjectsRoot(), title: str(body, 'title'), signal })
    },
  },
  'project.init': {
    mutation: true,
    async run({ access, body, signal }) {
      return await initializeProject({
        root: access.workspace.path,
        mode: access.policy.mode,
        newProject: body.newProject === true,
        signal,
      })
    },
  },
  'project.prepareIndex': {
    mutation: true,
    async run({ access, signal }) {
      return await prepareNovelIndex({ root: access.workspace.path, mode: access.policy.mode, signal })
    },
  },
  'structure.groupCreate': {
    mutation: true,
    async run({ access, body, signal }) {
      return await createManuscriptGroup({
        root: access.workspace.path,
        mode: access.policy.mode,
        relative: str(body, 'path'),
        signal,
      })
    },
  },
  'directory.create': {
    mutation: true,
    async run({ access, body, signal }) {
      return await createDirectory({
        root: access.workspace.path,
        mode: access.policy.mode,
        relative: str(body, 'path'),
        signal,
      })
    },
  },
  'rules.get': {
    async run({ files }) {
      return await readProjectRules(files)
    },
  },
  'rules.open': {
    mutation: true,
    async run({ files }) {
      return await ensureProjectRules(files)
    },
  },
} satisfies WorkbenchHandlers
