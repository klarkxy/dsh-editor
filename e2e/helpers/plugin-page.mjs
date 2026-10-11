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
  const overview = plugins.getByTestId('plugins-nav-overview')
  if (await overview.isVisible()) await overview.click()
  await plugins.getByTestId('plugins-catalog').waitFor()
}

/** The preinstalled web search bundle is a distribution built-in, listed under the builtin catalog. */
export function webSearchRow(plugins) {
  return plugins.getByTestId('plugins-catalog-builtin')
    .locator('[data-testid^="plugins-catalog-row-"]')
    .filter({ hasText: '网页搜索' })
}

export async function openWebSearchSettings(plugins) {
  await showPluginList(plugins)
  const row = webSearchRow(plugins)
  // A row carries one action: the configuration button, or the detail button
  // when the bundle has no configuration of its own.
  const configure = row.locator('[data-testid^="plugins-catalog-config-"]')
  const detail = row.locator('[data-testid^="plugins-catalog-detail-"]')
  await (await configure.count() ? configure : detail).click()
  const settings = plugins.getByTestId('web-search-settings')
  await settings.waitFor()
  return settings
}

export async function openWritingPresets(plugins) {
  await showPluginList(plugins)
  const builtin = plugins.getByTestId('plugins-catalog-builtin')
  const presets = await writingPresetGroup(builtin)
  await presets.scrollIntoViewIfNeeded()
  if (await presets.evaluate(element => element instanceof HTMLDetailsElement && !element.open))
    await presets.locator(':scope > summary').click()
  await builtin.getByText('小说创作', { exact: true }).waitFor()
  return presets
}

/** The preset sub-group is a collapsible group in the old layout and a plain subsection now. */
async function writingPresetGroup(builtin) {
  const group = builtin.locator('[data-testid="plugins-writing-presets"]')
  if (await group.count()) return group.first()
  const collapsible = builtin.locator('details').filter({ hasText: '写作模式' })
  if (await collapsible.count()) return collapsible.first()
  return builtin
}

export async function openPluginDiscovery(plugins) {
  const nav = plugins.getByTestId('plugins-nav-discovery')
  if (await nav.isVisible()) await nav.click()
  const discovery = plugins.getByTestId('plugins-discovery')
  await discovery.waitFor()
  if (await discovery.evaluate(element => element instanceof HTMLDetailsElement && !element.open))
    await discovery.locator(':scope > summary').click()
  // The seat contribution keeps its own collapsed disclosure inside the page.
  const inner = discovery.locator('[data-testid="plugins-settings"]')
  if (await inner.count() && await inner.first().evaluate(element => element instanceof HTMLDetailsElement && !element.open))
    await inner.first().locator(':scope > summary').click()
  return discovery
}

/** The official manager keeps its install, uninstall and script-approval UI on this page. */
/** The official manager keeps its install, uninstall and script-approval UI on this page. */
export async function openPluginManager(plugins) {
  const nav = plugins.getByTestId('plugins-nav-manager')
  if (await nav.isVisible()) await nav.click()
  const seat = plugins.getByTestId('plugins-manager-seat')
  await seat.waitFor()
  // A previous detail view (openBundle) sticks inside the manager; return to its list.
  const backToList = seat.getByText('插件列表', { exact: true }).first()
  if (await backToList.count()) await backToList.click()
  return seat
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

/**
 * Every nav link must sit inside the nav's own visible box.
 *
 * The nav used to clip instead of overflow: its inner <ul> was the horizontal
 * scroller, so the nav itself reported scrollWidth === clientWidth while
 * 子智能体 and 知乎 sat outside its rect at 390px. Measuring the links, not the
 * nav's scroll metrics, is the only way to see that failure.
 */
export async function assertConfigNavLinksReachable(plugins) {
  const nav = plugins.getByTestId('plugins-page-nav')
  const measured = await nav.evaluate(element => {
    const box = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    const edges = {
      top: box.top + parseFloat(style.borderTopWidth || '0'),
      bottom: box.bottom - parseFloat(style.borderBottomWidth || '0'),
      left: box.left + parseFloat(style.borderLeftWidth || '0'),
      right: box.right - parseFloat(style.borderRightWidth || '0'),
    }
    const links = [...element.querySelectorAll('.plugins-page-link')].map(link => {
      const rect = link.getBoundingClientRect()
      return {
        label: link.textContent.trim(),
        width: rect.width,
        height: rect.height,
        reachable: rect.width > 0 && rect.height > 0
          && rect.top >= edges.top - 1 && rect.bottom <= edges.bottom + 1
          && rect.left >= edges.left - 1 && rect.right <= edges.right + 1,
      }
    })
    return { links, nav: { client: element.clientWidth, scroll: element.scrollWidth } }
  })
  assert.ok(measured.links.length > 0, 'the plugins nav renders its links')
  const unreachable = measured.links.filter(link => !link.reachable)
  assert.equal(unreachable.length, 0,
    'every configuration entry stays inside the nav box: ' + JSON.stringify(unreachable))
  return measured
}

/** A catalog row shows the author's brand art or its monogram; a blank tile is a defect. */
export async function assertCatalogIconsRendered(plugins) {
  const tiles = await plugins.getByTestId('plugins-catalog')
    .locator('.plugins-catalog-icon')
    .evaluateAll(nodes => nodes.map(node => {
      const image = node.querySelector('img')
      return {
        image: Boolean(image),
        loaded: image ? image.complete && image.naturalWidth > 0 : false,
        text: node.textContent.trim(),
      }
    }))
  assert.ok(tiles.length > 0, 'the catalog renders at least one icon tile')
  for (const tile of tiles) {
    assert.ok(tile.image ? tile.loaded : tile.text.length > 0,
      'an icon tile renders brand art or a monogram, never a blank: ' + JSON.stringify(tile))
  }
  return tiles
}

export async function assertDefaultPluginPage(page, plugins) {
  await showPluginList(plugins)
  const official = plugins.getByTestId('plugins-catalog-official')
  const builtin = plugins.getByTestId('plugins-catalog-builtin')
  const user = plugins.getByTestId('plugins-catalog-user')
  for (const section of [official, builtin, user]) await section.waitFor()
  // Rows populate after the sections mount; sample after the row exists.
  await webSearchRow(plugins).first().waitFor()
  assert.ok(await webSearchRow(plugins).count() > 0, 'web search is a preinstalled built-in, not an official or user card')
  const userText = await user.innerText()
  assert.ok(userText.includes('还没有安装用户插件'), 'a default profile has no author-installed bundles: ' + userText)
  assert.ok(userText.includes('在「发现插件」里找找看'), 'the empty user catalog points at the discovery page: ' + userText)
  const bundles = await nativePluginRpc(page, 'listBundles')
  assert.ok(Array.isArray(bundles), 'native manager must return its installed bundle list')
  assert.deepEqual(bundles.filter(bundle => bundle.name.startsWith('@klarkxy/')).map(bundle => bundle.name).sort(),
    ['@klarkxy/dsh-web-search-manager'], 'only web search is preinstalled from the public plugin repository')
  assert.equal(bundles.find(bundle => bundle.name === '@klarkxy/dsh-web-search-manager')?.enabled, true)
  assert.equal(await plugins.getByTestId('plugins-page-nav').getByRole('button', { name: /^(知乎资料|知乎)$/ }).count(), 0,
    'Zhihu configuration is available after an explicit installation, not in the default distribution')
  return bundles
}
