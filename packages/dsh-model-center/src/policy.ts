import type {
  AiPolicy, ModelRole, ModelRoute, ModelTarget, PurposeSpec, RegisteredPurpose, ResolvedRoute, RoutePreview,
} from './contracts.ts'
import { isBoundRoute } from './contracts.ts'

export function roleRoute(policy: AiPolicy, role: ModelRole): { route: ModelRoute; inheritedRole?: ModelRole } | { error: string } {
  const bound = policy.roles[role]
  if (isBoundRoute(bound)) return { route: bound }
  if (role !== 'normal') {
    const normal = policy.roles.normal
    if (isBoundRoute(normal)) return { route: normal, inheritedRole: 'normal' }
  }
  if (role === 'normal') return { error: '对话档尚未设置模型。' }
  return { error: `${roleLabel(role)}档尚未设置模型，且对话档不可用。` }
}

export function roleLabel(role: ModelRole, locale: 'zh' | 'en' = 'zh'): string {
  if (locale === 'en') return { normal: 'Chat', weak: 'Quick', strong: 'Thinking', fantasy: 'Fantasy' }[role]
  return { normal: '对话', weak: '快速', strong: '思考', fantasy: '幻想' }[role]
}

export function sourceLabel(source: ResolvedRoute['source'], locale: 'zh' | 'en' = 'zh'): string {
  if (locale === 'en') return source === 'override' ? 'Request override' : source === 'purpose' ? 'Purpose' : 'Default'
  return source === 'override' ? '请求覆盖' : source === 'purpose' ? '用途配置' : '默认'
}

export function targetKindLabel(target: ModelTarget, locale: 'zh' | 'en' = 'zh'): string {
  if (target.kind === 'session') return locale === 'en' ? 'Follow current session' : '跟随当前会话'
  if (target.kind === 'model') return locale === 'en' ? 'Explicit model' : '指定模型'
  return roleLabel(target.role, locale)
}

function resolveTarget(
  target: ModelTarget,
  policy: AiPolicy,
  session?: ModelRoute,
): { route: ModelRoute; inheritedRole?: ModelRole } | { error: string } {
  if (target.kind === 'session') {
    if (!isBoundRoute(session)) return { error: '当前会话没有可用模型。' }
    return { route: session }
  }
  if (target.kind === 'model') {
    if (!isBoundRoute(target)) return { error: '指定模型不完整。' }
    return { route: { provider: target.provider, model: target.model, reasoningEffort: target.reasoningEffort } }
  }
  return roleRoute(policy, target.role)
}

export function purposeTarget(
  policy: AiPolicy,
  purpose: string,
  specs: readonly Pick<PurposeSpec, 'id' | 'defaultTarget'>[],
  override?: ModelTarget,
): { target: ModelTarget; source: ResolvedRoute['source'] } | { error: string } {
  if (override) return { target: override, source: 'override' }
  const configured = policy.purposes[purpose]
  if (configured) return { target: configured, source: 'purpose' }
  const spec = specs.find(item => item.id === purpose)
  if (spec) return { target: spec.defaultTarget, source: 'default' }
  return { error: '未配置该用途。' }
}

export function previewResolve(
  policy: AiPolicy,
  purpose: string,
  options: {
    specs?: readonly Pick<PurposeSpec, 'id' | 'defaultTarget'>[]
    session?: ModelRoute
    override?: ModelTarget
    knownProviders?: ReadonlySet<string>
    knownModels?: ReadonlySet<string>
  } = {},
): RoutePreview {
  const selected = purposeTarget(policy, purpose, options.specs ?? [], options.override)
  if ('error' in selected) return { ok: false, error: selected.error, policyRevision: policy.revision }
  const resolved = resolveTarget(selected.target, policy, options.session)
  if ('error' in resolved) {
    return { ok: false, error: resolved.error, target: selected.target, policyRevision: policy.revision }
  }
  let conflict: string | undefined
  if (options.knownProviders && !options.knownProviders.has(resolved.route.provider)) {
    conflict = '供应商当前不可用。'
  } else if (options.knownModels && !options.knownModels.has(`${resolved.route.provider}/${resolved.route.model}`)) {
    conflict = '模型当前不可用。'
  }
  return {
    ok: true,
    conflict,
    route: {
      ...resolved.route,
      source: selected.source,
      target: selected.target,
      policyRevision: policy.revision,
      inheritedRole: resolved.inheritedRole,
    },
  }
}

export function purposeRows(policy: AiPolicy, registered: readonly RegisteredPurpose[]): Array<RegisteredPurpose & { target: ModelTarget; source: 'purpose' | 'default' }> {
  return registered.map(spec => {
    const configured = policy.purposes[spec.id]
    return {
      ...spec,
      target: configured ?? spec.defaultTarget,
      source: configured ? 'purpose' as const : 'default' as const,
    }
  })
}

export function formatRoute(route: Pick<ModelRoute, 'provider' | 'model' | 'reasoningEffort'>): string {
  const effort = route.reasoningEffort ? ` · ${route.reasoningEffort}` : ''
  return `${route.provider} / ${route.model}${effort}`
}

export function inheritanceNote(inheritedRole: ModelRole | undefined, locale: 'zh' | 'en' = 'zh'): string {
  if (!inheritedRole) return ''
  return locale === 'en' ? `Inherited from ${roleLabel(inheritedRole, locale)}` : `继承自${roleLabel(inheritedRole, locale)}`
}
