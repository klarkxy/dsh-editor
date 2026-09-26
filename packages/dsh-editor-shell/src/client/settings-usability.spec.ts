import { describe, expect, it } from 'vitest'
import { completeAuthorDraftSave, reconcileAuthorDraft, type AuthorDraft } from './settings-assistant.tsx'
import { composeSettingsNavGroups } from './settings.tsx'

const clean = (saved: string): AuthorDraft => ({ value: saved, saved, conflicted: false })

describe('author preference draft lifecycle', () => {
  it('follows Host updates while the editor is clean', () => {
    expect(reconcileAuthorDraft(clean('old'), 'new')).toEqual(clean('new'))
  })

  it('retains an unsaved draft across a same-value Host notification and settings close', () => {
    const draft: AuthorDraft = { value: 'careful prose', saved: 'old', conflicted: false }
    expect(reconcileAuthorDraft(draft, 'old')).toBe(draft)
  })

  it('preserves a dirty draft and flags a newer Host value before it can be saved', () => {
    const draft: AuthorDraft = { value: 'careful prose', saved: 'old', conflicted: false }
    expect(reconcileAuthorDraft(draft, 'new')).toEqual({ value: 'careful prose', saved: 'new', conflicted: true })
  })

  it('clears the dirty state when the Host commits the edited value', () => {
    const draft: AuthorDraft = { value: 'careful prose', saved: 'old', conflicted: false }
    expect(reconcileAuthorDraft(draft, 'careful prose')).toEqual(clean('careful prose'))
  })

  it('keeps text entered after reopening when an earlier save finishes late', () => {
    const reopened: AuthorDraft = { value: 'newer draft', saved: 'old', conflicted: false }
    expect(completeAuthorDraftSave(reopened, 'first draft', 'first draft')).toEqual({
      value: 'newer draft', saved: 'first draft', conflicted: false,
    })
  })

  it('cleans the submitted draft with the normalized Host value on completion', () => {
    const pending: AuthorDraft = { value: '  first draft  ', saved: 'old', conflicted: false }
    expect(completeAuthorDraftSave(pending, '  first draft  ', 'first draft')).toEqual(clean('first draft'))
  })
})

describe('settings task groups', () => {
  it('keeps application preferences grouped exactly once without plugin entries', () => {
    const features = ['general', 'models', 'assistant', 'writing', 'shortcuts', 'usage'] as const
    const groups = composeSettingsNavGroups(features)
    expect(groups.map(group => group.label)).toEqual([
      'settings.groupWriting', 'settings.groupAssistant', 'settings.groupApp',
    ])
    expect(groups.flatMap(group => group.tabs)).toEqual([
      'writing', 'shortcuts', 'assistant', 'models', 'usage',
      'general', 'about',
    ])
  })

  it('removes gated assistant pages while keeping writing and app preferences', () => {
    const groups = composeSettingsNavGroups(['general', 'writing', 'shortcuts', 'usage'])
    expect(groups.flatMap(group => group.tabs)).toEqual([
      'writing', 'shortcuts', 'usage', 'general', 'about',
    ])
  })
})
