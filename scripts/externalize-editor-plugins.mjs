/** One-time repository-only migration. Does not alter installed applications or user profiles. */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(join(root, path), 'utf8');
const json = path => JSON.parse(read(path));
const write = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value); };
const writeJson = (path, value) => write(path, JSON.stringify(value, null, 2) + '\n');
const names = ['dsh-ai-services', 'dsh-current-title', 'dsh-mood', 'dsh-recap', 'dsh-memory', 'dsh-self-improvement', 'dsh-model-center', 'dsh-fusion', 'dsh-web-search-manager'];
const manifestPath = 'apps/desktop/resources/external-plugins.json';
if (existsSync(join(root, manifestPath))) throw new Error('Migration already applied; refusing to overwrite pins');
const pins = Object.fromEntries(names.map(name => { const pkg = json(`packages/${name}/package.json`); if (pkg.name !== '@klarkxy/' + name || pkg.private) throw new Error(`Unexpected public package ${name}`); return [pkg.name, pkg.version]; }));
writeJson(manifestPath, { schema: 1, packages: pins });
const isMigrated = key => Object.keys(pins).some(name => key === name || key.startsWith(name + '/'));
for (const path of ['package.json', ...readdirSync(join(root, 'packages')).map(name => `packages/${name}/package.json`).filter(path => existsSync(join(root, path))), 'apps/desktop/package.json']) {
  if (names.some(name => path === `packages/${name}/package.json`)) continue;
  const pkg = json(path);
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const name of Object.keys(pkg[field] ?? {})) if (pins[name]) pkg[field][name] = pins[name];
  }
  if (path === 'package.json') { Object.assign(pkg.devDependencies, pins); pkg.scripts['test:external-plugins'] = 'node --test scripts/external-plugins.test.mjs'; }
  writeJson(path, pkg);
}
let loader = read('scripts/plugin-manifest.mjs');
loader = loader.replace("import { existsSync", "import { externalPluginDirectories } from './external-plugins.mjs'\nimport { existsSync");
loader = loader.replace("  for (const entry of entries.filter((item) => item.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {\n    const dir = join(packagesDir, entry.name)", "  const directories = [\n    ...entries.filter(item => item.isDirectory()).map(entry => ({ name: entry.name, dir: join(packagesDir, entry.name) })),\n    ...externalPluginDirectories(root),\n  ].sort((left, right) => left.name.localeCompare(right.name))\n  for (const entry of directories) {\n    const dir = entry.dir");
if (!loader.includes('const directories = [')) throw new Error('Manifest loader patch failed');
write('scripts/plugin-manifest.mjs', loader);
const ts = json('tsconfig.base.json'); ts.compilerOptions.paths = Object.fromEntries(Object.entries(ts.compilerOptions.paths).filter(([key]) => !isMigrated(key))); writeJson('tsconfig.base.json', ts);
write('vitest.config.ts', read('vitest.config.ts').split('\n').filter(line => !names.some(name => line.includes(`@klarkxy/${name}`))).join('\n'));
write('scripts/desktop-compositions.mjs', read('scripts/desktop-compositions.mjs').replace('/** Package names can be scoped while source directories stay flat. */', '/** Resolve local workspace or explicitly pinned external package directories. */').replace('unknown workspace package:', 'unknown composition package:'));
write('scripts/dev-web.mjs', read('scripts/dev-web.mjs').replace("import { workspacePackageDir }", "import { externalPluginPins } from './external-plugins.mjs'\nimport { workspacePackageDir }").replace("for (const name of publicPlugins) {\n  kids.push", "for (const name of publicPlugins.filter(name => !(name in externalPluginPins(root)))) {\n  kids.push"));
write('scripts/pack-plugins.mjs', read('scripts/pack-plugins.mjs').replace("import { PUBLIC_PLUGIN_PACKAGES }", "import { PUBLIC_PLUGIN_PACKAGES, workspacePackageDir }").replace("import { PUBLIC_PLUGIN_PACKAGES, workspacePackageDir }", "import { externalPluginPins } from './external-plugins.mjs'\nimport { PUBLIC_PLUGIN_PACKAGES, workspacePackageDir }").replace("for (const name of PUBLIC_PLUGIN_PACKAGES) run(pnpm, ['--filter', name, 'pack', '--pack-destination', '.pack'])", "const external = externalPluginPins(root)\nfor (const name of PUBLIC_PLUGIN_PACKAGES) {\n  if (name in external) {\n    // Repack installed, already-built npm artifacts; never execute their lifecycle scripts.\n    run(pnpm, ['--dir', workspacePackageDir(name), 'exec', 'npm', 'pack', '--ignore-scripts', '--pack-destination', resolve(root, '.pack')])\n  } else run(pnpm, ['--filter', name, 'pack', '--pack-destination', '.pack'])\n}"));
write('packages/dsh-editor-shell/src/writing-ai-migration.spec.ts', read('packages/dsh-editor-shell/src/writing-ai-migration.spec.ts').replace("'../../dsh-ai-services/src/service.ts'", "'@klarkxy/dsh-ai-services'"));
let patch = read('packages/dsh-manuscript/src/rpc/patch.spec.ts');
patch = patch.replace("import { AiServicesRuntime } from '@klarkxy/dsh-ai-services'\nimport { sessionModelsFromHost } from '../../../dsh-ai-services/src/routing.ts'", "import { apply as applyAiServices, type AiServicesRuntime } from '@klarkxy/dsh-ai-services'");
const begin = patch.indexOf('  const ai = new AiServicesRuntime('), end = patch.indexOf('  const host = {', begin);
if (begin < 0 || end < 0) throw new Error('Cannot locate AI integration test fixture');
patch = patch.slice(0, begin) + `  const rows = new Map<string, unknown>()
  // Exercise the published plugin entry point, not its private routing source.
  await applyAiServices({
    llm: { resolveCallConfig: async (config: any) => config, prepareCall: async (config: any) => ({ config, stream }) },
    storageDomain: { async open() { return { table: (name: string) => ({ get: (key: string) => rows.get(name + ':' + key), async put(key: string, value: unknown) { rows.set(name + ':' + key, value) } }), close() {} } } },
    get(name: string) {
      if (name === 'agentDefaultModel') return { currentSelection: () => config.provider && config.model ? { provider: config.provider, model: config.model } : undefined }
      // Tests that explicitly configure tiers are exercising an installed model center.
      if (name === 'modelCenter') return {}
      return services.get(name)
    },
    get agents() { return (services.get('sessionModelsHost') as any)?.agents },
    get sessionProjections() { return (services.get('sessionModelsHost') as any)?.sessionProjections },
    get agentDefaultModel() { return (services.get('sessionModelsHost') as any)?.agentDefaultModel },
    provide(name: string, value: unknown) { services.set(name, value) },
    on() { return () => {} },
    effect(setup: () => unknown) { return setup() },
    webServer: { register() { return () => {} } },
    connection: {},
  } as unknown as Context)
  const ai = services.get('aiServices') as AiServicesRuntime
` + patch.slice(end);
write('packages/dsh-manuscript/src/rpc/patch.spec.ts', patch);
write('scripts/client-style-ownership.spec.mjs', read('scripts/client-style-ownership.spec.mjs').replace("import { apply as search } from '../packages/dsh-web-search-manager/src/client.tsx'\n", '').replace(", ['@klarkxy/dsh-web-search-manager', search]", ''));
write('scripts/check-fusion-foundation.mjs', `/** Public Fusion Node suites moved with the package to dsh-plugins.\n * Editor retains its host integration contract suite against the published package. */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pnpm = process.env.npm_execpath
if (!pnpm || !existsSync(pnpm)) throw new Error('Run through pnpm test:fusion')
const result = spawnSync(process.execPath, [pnpm, 'exec', 'vitest', 'run', '--maxWorkers=2', 'packages/dsh-editor-workbench/src/fusion-host.spec.ts'], { cwd: root, stdio: 'inherit' })
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
`);
write('.github/workflows/ci.yml', read('.github/workflows/ci.yml').replace('pnpm typecheck && pnpm test --maxWorkers=2 && pnpm test:fusion', 'pnpm typecheck && pnpm test --maxWorkers=2 && pnpm test:fusion && pnpm test:external-plugins'));
for (const name of names) rmSync(join(root, 'packages', name), { recursive: true });
rmSync(join(root, 'e2e/web-search-settings.mjs'));
// Repoint Markdown links only; preserve historical descriptions and test evidence.
function docs(directory) {
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    const path = directory ? directory + '/' + entry.name : entry.name;
    if (entry.isDirectory()) { if (!['node_modules', '.git'].includes(entry.name)) docs(path); continue; }
    if (!entry.name.endsWith('.md')) continue;
    let text = read(path);
    for (const name of names) {
      text = text.replace(new RegExp('\\]\\(((?:\\.\\.?/)*(?:packages/)?' + name + ')(/[^)\\s]*|)(?:)\\)', 'g'), (_all, _prefix, rest) => `](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/${name}${rest})`);
    }
    write(path, text);
  }
}
docs('');
write('docs/public-plugin-migration.md', `# 公共插件仓库拆分\n\n本次仅迁移源码所有权和构建依赖，不改变桌面预装、离线启动、插件 ID、数据位置或默认开关；不增加启动时网络安装。\n\n## 唯一源码所有者\n\n以下包的源码、独立测试与后续 npm 发布交由 [dsh-plugins](https://github.com/klarkxy/dsh-plugins) 维护：\n\n${Object.entries(pins).map(([name, version]) => '- ' + name + '@' + version).join('\n')}\n\n知乎仍有 Editor 私有界面合同的构建依赖；稿纸和校对仍按本地 tarball 交付。这三项与所有 dsh-editor-* 包暂留本仓库。\n\n## 构建和交付\n\napps/desktop/resources/external-plugins.json 明确批准包名与精确版本，必须与根 package.json 一致；pnpm-lock.yaml 固定完整解析结果。构建从本地 workspace 和已安装 npm 包读取相同的 dshEditor / dsh.bundle 元数据，继续复制到离线 profile。构建不下载缺失包，失败时要求执行冻结安装；正常应用启动部署逻辑未修改。pnpm pack:plugins 仍生成完整公共插件 tarball 集合，外部包使用已构建制品重新打包且禁止生命周期脚本。开发 watcher 只构建本地源码，不尝试重建 node_modules。\n\n公共插件测试随源码迁移；Editor 保留宿主集成测试，并通过公开入口测试已发布包，不再跨仓库引用 src。运行 pnpm test:external-plugins 检查版本、归属和制品解析边界。pnpm test:fusion 运行 Editor 侧 Fusion 宿主合同测试；公共 Fusion 的独立 Node 测试在新仓库运行。\n\n## 合并及发布交接\n\n先合并 dsh-plugins 的迁入 PR（迁入包保持 holdPublish），再合并本 PR。Editor 使用已有同名同版本 npm 包，不依赖先发布新版本。删除源码目录后，本仓库的发现式发布器不再发布这9个包。确认旧发布任务结束、每个包的 npm Trusted Publisher 切换到新仓库，并验证完整发布制品，再单独解除新仓库发布闸门。此 PR 不改凭据、不发布、不合并其他 PR。\n\n## 后续方向\n\n保留通过蓝图复现 Editor 写作环境的方向，本次不让蓝图接管桌面壳、升级、进程或用户数据，不要求 Editor 完全蓝图化。\n`);
write('docs/architecture.md', read('docs/architecture.md') + '\n## 公共插件源码归属\n\n9 个可移植公共插件由 dsh-plugins 维护，Editor 使用精确版本的外部 npm 制品参与原有离线组合。仓库归属与随包交付独立；详见[迁移与发布交接](public-plugin-migration.md)。\n');
write('packages/README.md', read('packages/README.md') + '\n公共插件已迁到 dsh-plugins；本仓库只保留需要本地维护的插件与桌面包。版本、构建和发布归属见[迁移说明](../docs/public-plugin-migration.md)。\n');
console.log('Externalized ' + Object.keys(pins).length + ' public plugin packages; runtime startup unchanged');
