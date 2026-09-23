import { describe, expect, it } from 'vitest'
import Schema from '@deepseek-ai/schemastery'
import { Config } from './writing-config.ts'

describe('native writing configuration form', () => {
  it('validates in the browser after a JSON roundtrip without host closures', () => {
    const wire = JSON.parse(JSON.stringify(Config.toJSON()))
    const plain = (node: any) => {
      if (node.meta) delete node.meta.volatile
      Object.values(node.dict ?? {}).forEach(plain)
      if (node.inner) plain(node.inner)
      for (const child of node.list ?? []) plain(child)
    }
    plain(wire)
    const validate = new Schema(wire)
    expect(() => validate({ authorPreferences: '保留人物动机', authorMemory: '作者已确认' })).not.toThrow()
  })
})
