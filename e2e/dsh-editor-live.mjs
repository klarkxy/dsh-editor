/**
 * Credentialed live e2e against a dedicated DSH profile (`dsh-editor-e2e`),
 * not the user's daily `web` profile. This profile intentionally persists so
 * it can reuse configured model credentials. For a truly fresh, credential-free
 * DSH_HOME and install/remove coverage, use plugin-matrix.mjs.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { resolveDshInstallation } from "../scripts/dsh-cli.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "e2e/out/live-xianxia");
const PROFILE = "dsh-editor-e2e";
if (PROFILE === "web") throw new Error("live e2e must not target the daily web profile");
const PORT = Number(process.env.E2E_PORT || 8788);
const BASE = `http://127.0.0.1:${PORT}`;
const BOOK = "灯下无山";
const SEND_TIMEOUT_MS = 720_000;
const dshInstallation = resolveDshInstallation();

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (key && process.env[key] == null) process.env[key] = value;
  }
}

loadEnvFile(path.join(root, ".env"));
if (process.env.API_KEY && !process.env.NEW_API_API_KEY) {
  process.env.NEW_API_API_KEY = process.env.API_KEY;
}

fs.mkdirSync(OUT, { recursive: true });

const NOTES = [];
let shotIndex = 0;
let dshChild = null;

function note(title, detail, severity = "observation") {
  NOTES.push({ type: "note", severity, title, detail, at: new Date().toISOString() });
}

async function shot(page, name) {
  shotIndex += 1;
  const file = path.join(OUT, `${String(shotIndex).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  NOTES.push({ type: "shot", name, file: path.relative(root, file) });
  return file;
}

async function dumpA11y(page, label) {
  const html = await page.content().catch(() => "");
  fs.writeFileSync(path.join(OUT, `page-${label}.html`), html, "utf8");
}

async function isReady() {
  try {
    const response = await fetch(BASE, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

function dshBinPath() {
  return dshInstallation.cliPath;
}

function installCurrentPlugins() {
  const staging = path.join(os.tmpdir(), "dsh-editor-e2e-pack");
  fs.mkdirSync(staging, { recursive: true });
  for (const name of ["dsh-manuscript", "dsh-grill"]) {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "packages", name, "package.json"), "utf8"));
    const tarball = path.join(root, ".pack", `${name}-${manifest.version}.tgz`);
    if (!fs.existsSync(tarball)) throw new Error(`missing current plugin tarball: ${tarball}`);
    const stagedTarball = path.join(staging, path.basename(tarball));
    fs.copyFileSync(tarball, stagedTarball);
    const result = spawnSync(
      process.execPath,
      [dshBinPath(), "plugin", "--profile", PROFILE, "add", `file:${stagedTarball.replaceAll("\\", "/")}`],
      { cwd: root, env: process.env, stdio: "inherit", windowsHide: true },
    );
    if (result.status !== 0) throw new Error(`failed to install ${name} into ${PROFILE}`);
  }
  note("插件安装", "dedicated credentialed profile 已安装本次构建的两个 tarball");
}

async function startDsh(workspace) {
  dshChild = spawn(
    process.execPath,
    [dshBinPath(), "--profile", PROFILE, "--no-open", "--host", "127.0.0.1", "--port", String(PORT)],
    {
      cwd: workspace,
      env: {
        ...process.env,
        // Force in-app directory browser so Playwright can type the path.
        // Native Windows folder dialogs are outside the page.
        SSH_CONNECTION: process.env.SSH_CONNECTION || "dsh-editor-e2e",
      },
      stdio: "pipe",
      windowsHide: true,
    },
  );
  dshChild.stdout?.on("data", (chunk) => {
    const text = String(chunk);
    if (/sk-[A-Za-z0-9]{8,}/.test(text)) return;
    process.stdout.write(text);
  });
  dshChild.stderr?.on("data", (chunk) => {
    const text = String(chunk);
    if (/sk-[A-Za-z0-9]{8,}/.test(text)) return;
    process.stderr.write(text);
  });
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await isReady()) {
      note("DSH 已就绪", `${PROFILE} @ ${BASE}`);
      return;
    }
    if (dshChild.exitCode != null) {
      throw new Error(`dsh exited ${dshChild.exitCode} before listen`);
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`dsh ${PROFILE} 未在时限内监听 ${BASE}`);
}

async function clickIfVisible(page, name, timeout = 4000) {
  const button = page.getByRole("button", { name });
  try {
    await button.first().waitFor({ state: "visible", timeout });
    await button.first().click();
    return true;
  } catch {
    return false;
  }
}

async function answerAskCards(page) {
  const group = page.getByRole("radiogroup");
  if (!(await group.first().isVisible().catch(() => false))) return false;
  const radio = group.getByRole("radio").first();
  if (await radio.isVisible().catch(() => false)) {
    const label = (await radio.getAttribute("aria-label")) || "option-1";
    await radio.click();
    note("已选题", label);
    await page.waitForTimeout(250);
  }
  const next = page.getByRole("button", { name: /^(下一题|提交|Next|Submit)$/ }).last();
  if (await next.isEnabled().catch(() => false)) {
    await next.click();
    note("已交题", (await next.textContent())?.trim() || "下一题");
    await page.waitForTimeout(400);
    return true;
  }
  if (await clickIfVisible(page, "跳过本题", 800)) {
    note("已跳过本题", "下一题不可用");
    return true;
  }
  return false;
}

async function approvePending(page) {
  if (await answerAskCards(page)) return true;
  const names = ["允许一次", "允许", "批准", "Allow once", "Approve"];
  for (const name of names) {
    if (await clickIfVisible(page, name, 400)) {
      note("已批准工具", name);
      return true;
    }
  }
  return false;
}

async function waitOverlay(page, { open = false } = {}) {
  const overlay = page.getByTestId("manuscript-overlay");
  try {
    await overlay.waitFor({ state: "visible", timeout: 15_000 });
    if (open && (await overlay.getAttribute("data-state")) === "closed") {
      await page.getByTestId("manuscript-open").click();
      await page.waitForFunction(() => document.querySelector('[data-testid="manuscript-overlay"]')?.getAttribute("data-state") === "open");
    }
    note("稿纸 overlay 可见", "shell.overlay / manuscript");
    return true;
  } catch {
    note("稿纸 overlay 未出现", "DSH 未挂上 dsh-manuscript", "issue");
    await dumpA11y(page, "no-overlay");
    return false;
  }
}

async function treeLabels(page) {
  const tree = page.getByTestId("manuscript-tree");
  const found = [];
  const missing = [];
  for (const label of ["正文", "大纲", "人物卡", "世界书"]) {
    const node = tree.getByRole("button", { name: new RegExp(label) }).or(tree.getByText(label));
    if (await node.first().isVisible().catch(() => false)) found.push(label);
    else missing.push(label);
  }
  return { tree, found, missing };
}

async function pickWorkspace(page, workspace) {
  const overlayOn = await page.getByTestId("manuscript-overlay").isVisible().catch(() => false);
  const chooserPromise = page.waitForEvent("filechooser", { timeout: 4_000 }).catch(() => null);
  if (overlayOn) {
    // Overlay covers the official sidebar add-workspace control.
    await page.getByRole("button", { name: /选择工作区/ }).first().click();
    await page.waitForTimeout(400);
    await shot(page, "ws-menu");
    await page.getByText(/添加工作区/).last().click();
  } else {
    await page.getByRole("button", { name: "添加工作区", exact: true }).click();
  }
  await shot(page, "after-add-workspace-click");
  const chooser = await chooserPromise;
  if (chooser) {
    await chooser.setFiles(workspace);
    note("原生目录选择", workspace);
    await page.waitForTimeout(800);
    return;
  }
  const dialog = page.getByRole("heading", { name: /选择工作区目录|Select Workspace Directory/ });
  if (!(await dialog.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: /选择工作区|workspace/i }).first().click();
    await page.getByText(/添加工作区/).last().click();
    await shot(page, "after-composer-add-workspace");
  }
  await dialog.waitFor({ state: "visible", timeout: 12_000 });
  await page.getByRole("button", { name: /编辑路径|Edit path/ }).click();
  const pathBox = page.locator("input").last();
  await pathBox.waitFor({ state: "visible", timeout: 8_000 });
  await pathBox.fill(workspace);
  await pathBox.press("Enter");
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: /打开|Open/, exact: true }).click();
  note("已添加工作区", workspace);
}

async function pickModel(page) {
  const already = page.getByRole("button", { name: /deepseek-v4-flash/ });
  if (await already.first().isVisible().catch(() => false)) {
    note("已选模型", "deepseek-v4-flash");
    return;
  }
  await page.getByRole("button", { name: /选择模型/ }).first().click();
  await page.waitForTimeout(400);
  const nested = page.getByText("选择模型", { exact: true }).nth(1);
  if (await nested.isVisible().catch(() => false)) {
    await nested.click();
    await page.waitForTimeout(600);
  }
  await shot(page, "model-menu");
  const flash = page.getByText("deepseek-v4-flash", { exact: true });
  const newApi = page.getByText(/New API|new-api/i);
  if (await flash.first().isVisible().catch(() => false)) {
    await flash.first().click();
    note("已选模型", "deepseek-v4-flash");
    return;
  }
  if (await newApi.first().isVisible().catch(() => false)) {
    await newApi.first().click();
    await page.waitForTimeout(400);
    if (await flash.first().isVisible().catch(() => false)) {
      await flash.first().click();
    }
    note("已选模型", "New API / deepseek-v4-flash");
    return;
  }
  note("模型列表未出现", "composer 仍可能不可用", "issue");
}

async function composer(page) {
  return page.getByPlaceholder(
    /给智能体发消息|描述你想要构建的内容|Message the agent|Ask/,
  );
}

async function sendChat(page, text) {
  const box = await composer(page);
  await box.waitFor({ state: "visible", timeout: 30_000 });
  await box.click();
  await box.fill(text);
  const send = page.getByRole("button", { name: /发送消息|Send message/ });
  if (await send.isVisible().catch(() => false)) {
    await send.click();
  } else {
    await box.press("Control+Enter");
  }
  const started = Date.now();
  while (Date.now() - started < SEND_TIMEOUT_MS) {
    await approvePending(page);
    const asking = await page.getByRole("radiogroup").first().isVisible().catch(() => false);
    const stop = page.getByRole("button", { name: /停止生成|Stop/ });
    const sending = await stop.isVisible().catch(() => false);
    const boxVisible = await box.isVisible().catch(() => false);
    if (!asking && !sending && boxVisible && Date.now() - started > 1500) {
      await page.waitForTimeout(1000);
      await approvePending(page);
      const stillAsk = await page.getByRole("radiogroup").first().isVisible().catch(() => false);
      const stillStop = await stop.isVisible().catch(() => false);
      if (!stillAsk && !stillStop) {
        note("对话结束", `「${text.slice(0, 24)}…」用了 ${Date.now() - started}ms`);
        return { ok: true, ms: Date.now() - started };
      }
    }
    await page.waitForTimeout(500);
  }
  note("对话超时", text.slice(0, 48), "issue");
  return { ok: false, ms: Date.now() - started };
}

function walkWorkspace(dir, prefix = "") {
  const files = {};
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(files, walkWorkspace(abs, rel));
    else if (entry.isFile() && entry.name.endsWith(".md")) {
      files[rel] = fs.readFileSync(abs, "utf8");
    }
  }
  return files;
}

const workspace = path.join(OUT, "workspace");
fs.rmSync(workspace, { recursive: true, force: true });
fs.mkdirSync(workspace, { recursive: true });
note("工作区", workspace);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  locale: "zh-CN",
});
page.setDefaultTimeout(20_000);

try {
  installCurrentPlugins();
  await startDsh(workspace);
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await shot(page, "boot");

  await clickIfVisible(page, /稍后|跳过/, 2000);
  await waitOverlay(page);
  await shot(page, "overlay-boot");
  await pickWorkspace(page, workspace);
  await shot(page, "workspace-picked");
  await page.getByText("workspace", { exact: true }).first().click().catch(() => {});
  await pickModel(page);
  await shot(page, "model-picked");
  await waitOverlay(page, { open: true });
  await shot(page, "overlay");

  const plan = await sendChat(
    page,
    [
      "请先调用 scaffold_novel，在当前工作区创建小说目录（正文/大纲/人物卡/世界书）。",
      `然后用 planning 模式为短篇《${BOOK}》给出五场梗概。只在聊天中回答，不要写项目文件。`,
      "核心 idea：筑基完成后的修仙者走出大山，发现外面是现代都市，城里有很多隐修人士。",
      "人物：陈砺（刚筑基，青冥谷外门），沈晚宁（便利店夜班隐修）。",
      "不要系统面板，不要后宫，不要突然升级。",
    ].join(""),
  );
  await shot(page, "after-scaffold-plan");
  if (!plan.ok) await dumpA11y(page, "after-plan");

  let listed = await treeLabels(page);
  if (listed.missing.length) {
    note("scaffold 后树未刷新", listed.missing.join("、"), "observation");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await waitOverlay(page, { open: true });
    await shot(page, "after-reload");
    await pickModel(page);
    const deadline = Date.now() + 10_000;
    do {
      listed = await treeLabels(page);
      if (!listed.missing.length) break;
      await page.waitForTimeout(500);
    } while (Date.now() < deadline);
  }
  for (const label of listed.found) note("树节点", label);
  for (const label of listed.missing) note("树缺少节点", label, "issue");

  const tree = listed.tree;
  const overview = tree.getByText("项目总览.md").or(tree.getByRole("button", { name: "项目总览.md" }));
  if (await overview.first().isVisible().catch(() => false)) {
    await overview.first().click();
    const editor = page.getByTestId("manuscript-editor");
    await editor.waitFor({ state: "visible", timeout: 10_000 });
    await editor.click();
    await editor.press("End");
    await editor.pressSequentially(`\n\n作品名：${BOOK}\n`, { delay: 20 });
    await editor.press("Control+S");
    await page.waitForTimeout(1200);
    await shot(page, "editor-overview");
    note("编辑器保存", "项目总览.md 追加了作品名");
  } else {
    note("打不开项目总览", "树里没看到文件", "issue");
  }

  const overviewPath = path.join(workspace, "项目总览.md");
  if (!fs.existsSync(overviewPath) || !fs.readFileSync(overviewPath, "utf8").includes(BOOK)) {
    note("保存未落盘", "项目总览.md 未包含编辑器追加内容", "issue");
  }

  const editor = page.getByTestId("manuscript-editor");
  if (await editor.isVisible().catch(() => false)) {
    await editor.click();
    await editor.press("End");
    await editor.pressSequentially("\n未保存保护测试", { delay: 10 });
    let sawCloseGuard = false;
    page.once("dialog", async (dialog) => {
      sawCloseGuard = /未保存/.test(dialog.message());
      await dialog.dismiss();
    });
    await page.getByTestId("manuscript-close").click();
    if (!sawCloseGuard || (await page.getByTestId("manuscript-overlay").getAttribute("data-state")) !== "open") {
      note("未保存关闭保护失效", "关闭稿纸时未阻止未保存缓冲区被隐藏", "issue");
    } else {
      note("未保存关闭保护", "关闭稿纸会提示且取消后仍保持打开");
    }
    await editor.press("Control+S");
    await page.waitForTimeout(800);
    await page.getByTestId("manuscript-close").click();
    if ((await page.getByTestId("manuscript-overlay").getAttribute("data-state")) !== "closed") {
      note("稿纸无法折叠", "保存后关闭仍未进入 closed 状态", "issue");
    }
    await shot(page, "drawer-closed");
    await page.getByTestId("manuscript-open").click();
    await page.getByTestId("manuscript-fim").click().catch(() => {});
    await page.waitForTimeout(2000);
    if (await page.getByTestId("manuscript-ghost").isVisible().catch(() => false)) {
      note("FIM 虚影", "补全通过 DSH 当前会话模型返回候选");
      await editor.press("Escape");
    } else {
      note("FIM 未出现", "当前模型或服务未返回候选；编辑器保持可用", "observation");
    }
  }

  const files = walkWorkspace(workspace);
  fs.mkdirSync(path.join(OUT, "files"), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const safe = rel.replaceAll("/", "__");
    fs.writeFileSync(path.join(OUT, "files", safe), content, "utf8");
  }
  NOTES.push({ type: "workspace", files: Object.keys(files).sort(), workspace });
  await shot(page, "final");
} catch (error) {
  note(
    "走查中断",
    error instanceof Error ? error.stack || error.message : String(error),
    "issue",
  );
  await shot(page, "crashed").catch(() => {});
  await dumpA11y(page, "crashed").catch(() => {});
} finally {
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ notes: NOTES }, null, 2), "utf8");
  await browser.close().catch(() => {});
  if (dshChild && dshChild.exitCode == null) {
    try {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(dshChild.pid), "/T", "/F"], { windowsHide: true });
      } else {
        dshChild.kill("SIGTERM");
      }
    } catch {
      /* ignore */
    }
  }
  console.log(`profile ${PROFILE}`);
  console.log(`workspace ${workspace}`);
  console.log(`report ${path.relative(root, path.join(OUT, "report.json"))}`);
  console.log(`shots ${shotIndex}`);
  const issueCount = NOTES.filter((item) => item.severity === "issue").length;
  console.log(`issues ${issueCount}`);
  if (issueCount > 0) process.exitCode = 1;
}
