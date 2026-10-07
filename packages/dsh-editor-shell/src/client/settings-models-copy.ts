/** Localized labels and RPC failure text shared by model settings surfaces. */
import type { RpcResult } from '../dsh-compat.ts'
import type { ProviderRow } from './settings-models-store.ts'
import { providerIdOf } from './settings-models-store.ts'
import { t } from '../i18n/index.ts'

/* Read the message of a rejected wire call without unwrapping to a host
   stack — the page shows the same text the user would see in the DevTools
   "response" panel. */
export function failureMessage(result: RpcResult<unknown>): string {
  const error = (result as { error?: { message?: string } }).error
  return error?.message ?? t('common.requestFailed')
}

/* Chinese text: copy keys are the only surface where we deviate from the
   upstream English wire text. Kept in one block so review stays focused. */
export function text() {
  return {
  intro: t('models.intro'),
  readOnly: t('models.readOnly'),
  credentialErrorPrefix: t('models.credentialErrorPrefix'),
  loading: t('zhihu.reading'),
  loadFailed: t('models.loadFailed'),
  retry: t('common.retry'),
  saved: t('common.saved'),
  edit: t('common.edit'),
  delete: t('common.delete'),
  add: t('models.add'),
  addCustom: t('models.addCustom'),
  custom: t('common.custom'),
  confirmDeleteTitle: t('models.confirmDeleteTitle'),
  confirmDeleteManage: t('models.confirmDeleteManage'),
  confirmDeleteKeep: t('models.confirmDeleteKeep'),
  cancel: t('common.cancel'),
  apiKey: t('models.apiKey'),
  apiKeyPlaceholderStored: t('models.apiKeyStored'),
  apiKeyPlaceholderLocked: t('models.apiKeyLocked'),
  apiKeyPlaceholder: t('models.apiKeyPlaceholder'),
  keyBlank: t('models.keyBlank'),
  keyIllegal: t('models.keyIllegal'),
  customized: t('models.customized'),
  displayName: t('models.displayName'),
  baseUrl: t('models.baseUrl'),
  baseUrlDeepseekPlaceholder: 'https://api.deepseek.com',
  baseUrlPlaceholder: t('models.baseUrlDefault'),
  protocol: t('models.protocol'),
  protocolUnset: t('select.unselected'),
  models: t('models.catalog'),
  addModel: t('models.addModel'),
  fetchModels: t('models.fetchModels'),
  fetching: t('models.fetching'),
  fetchUnsupported: t('models.fetchUnsupported'),
  noListed: t('models.noListed'),
  noneAdded: t('models.noneAdded'),
  modelId: t('models.modelId'),
  modelName: t('models.displayName'),
  modelContext: t('models.context'),
  modelMax: t('models.maxOut'),
  modelReasoning: t('chat.reasoning'),
  modelReasoningOff: t('models.reasoningOff'),
  modelReasoningStandard: t('models.reasoningStandard'),
  modelReasoningCustom: t('models.reasoningCustom'),
  modelAdvanced: t('models.params'),
  removeModel: t('models.removeModel'),
  deleteProvider: t('common.delete'),
  customRoute: 'Provider ID',
  customRouteHint: t('models.routeHint'),
  customRouteInvalid: t('models.routeHint'),
  customRouteTaken: t('models.routeTaken'),
  customNeedsBaseUrl: t('models.needsBaseUrl'),
  customNeedsModels: t('models.needsModels'),
  createCustom: t('models.createProvider'),
  saving: t('common.saving'),
  creating: t('common.creating'),
  deleteTitle: t('models.deleteTitle'),
  deleteProviderAria: t('models.deleteAria'),
  editProviderAria: t('models.editAria'),
  candidateTitle: t('models.candidateTitle'),
  candidateDescription: t('models.candidateDesc'),
  candidateSelectAll: t('models.selectAll'),
  candidateDeselectAll: t('models.selectNone'),
  candidateAdopt: t('models.addSelected'),
  candidateClose: t('common.close'),
  conflict: t('models.conflict'),
  modelFailure: (index: number, message: string) => t('models.modelFailure', { n: index + 1, text: message }),
  modelIdRequired: t('models.idRequired'),
  modelIdDuplicate: t('models.idDuplicate'),
  modelNameInvalid: t('models.nameInvalid'),
  modelContextInvalid: t('models.contextInvalid'),
  modelMaxTokensInvalid: t('models.maxInvalid'),
  }
}

export function modelFailureLabel(key: 'modelIdRequired' | 'modelIdDuplicate' | 'modelNameInvalid' | 'modelContextInvalid' | 'modelMaxTokensInvalid'): string {
  return text()[key]
}

export function targetLabel(row: ProviderRow): string {
  const displayName = row.entry.displayName
  if (typeof displayName === 'string' && displayName) return displayName
  return row.entry.name ?? providerIdOf(row.entry)
}

export function formatTemplate(template: string, target: string): string {
  return template.replace('{provider}', target)
}
