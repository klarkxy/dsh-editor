import assert from 'node:assert/strict'

export function getPluginsPage(page) {
  return page.locator('section.plugins-page[aria-label="插件管理"]')
}

export async function openPluginsPage(page) {
  const plugins = getPluginsPage(page)
  if (!await plugins.isVisible()) await page.getByRole('button', { name: '插件', exact: true }).click()
  await plugins.waitFor({ state: 'visible' })
  await showPluginList(plugins)
  return plugins
}

export async function closePluginsPage(page) {
  const plugins = getPluginsPage(page)
  await plugins.getByRole('button', { name: /^返回首页$|^返回写作$/ }).click()
  // The overlay is retained to preserve the manuscript and plugin state.
  await plugins.waitFor({ state: 'hidden' })
}

export async function showPluginList(plugins) {
  const manage = plugins.locator('.plugins-page-nav').getByRole('button', { name: '已安装与市场', exact: true })
  if (await manage.isVisible()) await manage.click()
  const back = plugins.getByRole('button', { name: '返回插件列表', exact: true })
  if (await back.isVisible()) await back.click()
  await plugins.locator('[data-plugin-panel]').getByRole('button', { name: '添加插件', exact: true }).waitFor()
}

export async function openWebSearchSettings(plugins) {
  await showPluginList(plugins)
  await plugins.locator('[data-plugin-panel]').getByRole('button', { name: '查看 网页搜索', exact: true }).click()
  const settings = plugins.getByTestId('web-search-settings')
  await settings.waitFor()
  return settings
}

export async function openWritingPresets(plugins) {
  await showPluginList(plugins)
  const presets = plugins.getByTestId('plugins-writing-presets')
  await presets.waitFor()
  if (!await presets.evaluate(element => element.open)) await presets.locator(':scope > summary').click()
  await presets.getByText('小说创作', { exact: true }).waitFor()
  return presets
}

export async function nativePluginRpc(page, method, args = {}) {
  const response = await page.request.post(new URL(`/api/pluginManager/${method}`, page.url()).href, {
    data: { type: 'client-request', rpcId: `e2e-${method}-${Date.now()}`, method: `pluginManager/${method}`, payload: { args } },
  })
  assert.ok(response.ok(), `${method}: HTTP ${response.status()}`)
  const body = await response.json()
  const result = body.result ?? body
  if (result && typeof result === 'object' && 'ok' in result) {
    assert.ok(result.ok, `${method}: ${JSON.stringify(result)}`)
    return result.value
  }
  return result
}

export async function assertDefaultPluginPage(page, plugins) {
  await showPluginList(plugins)
  await plugins.locator('[data-plugin-panel]').getByRole('button', { name: '查看 网页搜索', exact: true }).waitFor()
  const bundles = await nativePluginRpc(page, 'listBundles')
  assert.ok(Array.isArray(bundles), 'native manager must return its installed bundle list')
  assert.deepEqual(bundles.filter(bundle => bundle.name.startsWith('@klarkxy/')).map(bundle => bundle.name).sort(),
    ['@klarkxy/dsh-web-search-manager'], 'only web search is preinstalled from the public plugin repository')
  assert.equal(bundles.find(bundle => bundle.name === '@klarkxy/dsh-web-search-manager')?.enabled, true)
  assert.equal(await plugins.locator('.plugins-page-nav').getByRole('button', { name: /^(知乎资料|知乎)$/ }).count(), 0,
    'Zhihu configuration is available after an explicit installation, not in the default distribution')
  return bundles
}
