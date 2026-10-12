import assert from 'node:assert/strict'
import { S } from './selectors.mjs'

export function getPluginsPage(page) {
  return page.locator(S.pluginsPageSection)
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
  const overview = plugins.locator(S.pluginsNavOverview)
  if (await overview.isVisible()) await overview.click()
  await plugins.locator(S.pluginsCatalog).waitFor()
}

/**
 * Open every closed <details> in the locator subtree, outermost first, via real
 * summary clicks. Setting `.open` directly is not enough — the groups are
 * React-controlled and re-collapse on the next render.
 */
export async function expandAllDetails(locator) {
  let previous = -1
  for (let attempt = 0; attempt < 20; attempt++) {
    const closed = locator.locator('details:not([open])')
    const count = await closed.count()
    if (!count || count === previous) return
    previous = count
    await closed.first().locator('summary').first().click()
    await locator.page().waitForTimeout(120)
  }
}

/** The preinstalled web search bundle is a distribution built-in, listed under the builtin catalog. */
export function webSearchRow(plugins) {
  return plugins.locator(S.pluginsCatalogBuiltin)
    .locator(S.pluginsCatalogRow)
    .filter({ hasText: '网页搜索' })
}

export async function openWebSearchSettings(plugins) {
  await showPluginList(plugins)
  const row = webSearchRow(plugins)
  // A row carries one action: the configuration button, or the detail button
  // when the bundle has no configuration of its own.
  const configure = row.locator(S.pluginsCatalogConfig)
  const detail = row.locator(S.pluginsCatalogDetail)
  await (await configure.count() ? configure : detail).click()
  const settings = plugins.locator(S.webSearchSettings)
  await settings.waitFor()
  return settings
}

export async function openWritingPresets(plugins) {
  await showPluginList(plugins)
  const builtin = plugins.locator(S.pluginsCatalogBuiltin)
  // The preset rows live in a 写作模式 subsection of the builtin catalog and
  // arrive once presets.list resolves. Older layouts wrapped them in a
  // collapsed <details>, so still expand any closed disclosures first.
  await expandAllDetails(builtin)
  const presets = await writingPresetGroup(builtin)
  await presets.scrollIntoViewIfNeeded()
  await builtin.getByText('小说创作', { exact: true }).waitFor({ state: 'visible' })
  return presets
}

/** The preset sub-group is a plain subsection now; a collapsible group in older layouts. */
async function writingPresetGroup(builtin) {
  const subsection = builtin.locator(S.pluginsCatalogPresets)
  if (await subsection.count()) return subsection.first()
  const group = builtin.locator(S.pluginsWritingPresets)
  if (await group.count()) return group.first()
  const collapsible = builtin.locator('details').filter({ hasText: '写作模式' })
  if (await collapsible.count()) return collapsible.first()
  return builtin
}

export async function openPluginDiscovery(plugins) {
  const nav = plugins.locator(S.pluginsNavDiscovery)
  if (await nav.isVisible()) await nav.click()
  const discovery = plugins.locator(S.pluginsDiscovery)
  await discovery.waitFor()
  // The install-spec form sits behind the 高级 disclosure, and the seat
  // contribution keeps its own collapsed disclosure inside the page.
  await expandAllDetails(discovery)
  return discovery
}

/**
 * The 复制规格 / install-spec block of a discovery listing card lives inside its
 * own 高级信息 <details>, which renders closed and arrives after the async
 * marketplace search resolves. Find the card by its spec text and open the
 * disclosure so its actions are clickable.
 */
export async function openListingSpec(discovery, specText) {
  const card = discovery.locator(S.pluginsCard)
    .filter({ has: discovery.page().locator(S.pluginsSpec).filter({ hasText: specText }) })
    .first()
  await card.waitFor({ state: 'visible' })
  const advanced = card.locator(S.pluginsComposition)
  if (!await advanced.evaluate(element => element.open)) {
    await advanced.locator(S.summaryScope).click()
  }
  return card
}

/** The official manager keeps its install, uninstall and script-approval UI on this page. */
export async function openPluginManager(plugins) {
  const nav = plugins.locator(S.pluginsNavManager)
  if (await nav.isVisible()) await nav.click()
  const seat = plugins.locator(S.pluginsManagerSeat)
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
  const nav = plugins.locator(S.pluginsPageNav)
  const measured = await nav.evaluate((element, linkSelector) => {
    const box = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    const edges = {
      top: box.top + parseFloat(style.borderTopWidth || '0'),
      bottom: box.bottom - parseFloat(style.borderBottomWidth || '0'),
      left: box.left + parseFloat(style.borderLeftWidth || '0'),
      right: box.right - parseFloat(style.borderRightWidth || '0'),
    }
    // Links inside the collapsed 高级组件 <details> are intentionally not
    // laid out until the author expands it; they are not "outside the box".
    const links = [...element.querySelectorAll(linkSelector)]
      .filter(link => !link.closest('details:not([open])'))
      .map(link => {
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
  }, S.pluginsPageLink)
  assert.ok(measured.links.length > 0, 'the plugins nav renders its links')
  const unreachable = measured.links.filter(link => !link.reachable)
  assert.equal(unreachable.length, 0,
    'every configuration entry stays inside the nav box: ' + JSON.stringify(unreachable))
  return measured
}

/** A catalog row shows the author's brand art or its monogram; a blank tile is a defect. */
export async function assertCatalogIconsRendered(plugins) {
  const tiles = await plugins.locator(S.pluginsCatalog)
    .locator(S.pluginsCatalogIcon)
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
  const official = plugins.locator(S.pluginsCatalogOfficial)
  const builtin = plugins.locator(S.pluginsCatalogBuiltin)
  const user = plugins.locator(S.pluginsCatalogUser)
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
  assert.equal(await plugins.locator(S.pluginsPageNav).getByRole('button', { name: /^(知乎资料|知乎)$/ }).count(), 0,
    'Zhihu configuration is available after an explicit installation, not in the default distribution')
  return bundles
}
