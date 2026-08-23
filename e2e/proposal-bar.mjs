/**
 * Overlay e2e for the confirm bar. Does not call the model: writes a sidecar
 * proposal, accepts/rejects in the manuscript editor, checks disk.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "e2e/out/proposal-bar");
const PROFILE = "dsh-editor-e2e";
const PORT = Number(process.env.E2E_PORT || 8789);
const BASE = `http://127.0.0.1:${PORT}`;

fs.mkdirSync(OUT, { recursive: true });

const NOTES = [];
let dshChild = null;

function note(title, detail, severity = "observation") {
  NOTES.push({ type: "note", severity, title, detail, at: new Date().toISOString() });
}

async function isReady() {
  try {
    const response = await fetch(BASE, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function startDsh(workspace) {
  const dshBin = path.join(process.env.APPDATA || "", "npm/node_modules/@deepseek-ai/dsh/lib/bin.js");
  dshChild = spawn(process.execPath, [dshBin, "--profile", PROFILE, "--no-open", "--host", "127.0.0.1", "--port", String(PORT)], {
    cwd: workspace,
    env: { ...process.env, SSH_CONNECTION: process.env.SSH_CONNECTION || "dsh-editor-e2e" },
    stdio: "pipe",
    windowsHide: true,
  });
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await isReady()) return;
    if (dshChild.exitCode != null) throw new Error(`dsh exited ${dshChild.exitCode}`);
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`dsh 未监听 ${BASE}`);
}

async function pickWorkspace(page, workspace) {
  const overlayOn = await page.getByTestId("manuscript-overlay").isVisible().catch(() => false);
  const chooserPromise = page.waitForEvent("filechooser", { timeout: 4_000 }).catch(() => null);
  if (overlayOn) {
    await page.getByRole("button", { name: /选择工作区/ }).first().click();
    await page.waitForTimeout(400);
    await page.getByText(/添加工作区/).last().click();
  } else {
    await page.getByRole("button", { name: "添加工作区", exact: true }).click();
  }
  const chooser = await chooserPromise;
  if (chooser) {
    await chooser.setFiles(workspace);
    await page.waitForTimeout(800);
    return;
  }
  const dialog = page.getByRole("heading", { name: /选择工作区目录|Select Workspace Directory/ });
  await dialog.waitFor({ state: "visible", timeout: 12_000 });
  await page.getByRole("button", { name: /编辑路径|Edit path/ }).click();
  const pathBox = page.locator("input").last();
  await pathBox.fill(workspace);
  await pathBox.press("Enter");
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /打开|Open/, exact: true }).click();
}

function writeProposal(workspace, body) {
  const dir = path.join(workspace, ".dsh-editor");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "proposals.json"), JSON.stringify({ version: 1, proposals: [body] }, null, 2), "utf8");
}

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-editor-proposal-"));
fs.mkdirSync(path.join(workspace, "正文"));
fs.writeFileSync(path.join(workspace, "正文", "巷口.md"), "灯亮了。巷口没人。", "utf8");
writeProposal(workspace, {
  id: "e2e-accept",
  path: "正文/巷口.md",
  kind: "patch",
  segments: [{ old_text: "巷口没人。", new_text: "巷口只有风。" }],
  createdAt: Date.now(),
});

const browser = await chromium.launch({ headless: process.env.E2E_HEADED ? false : true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  await startDsh(workspace);
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(2500);
  await pickWorkspace(page, workspace);
  await page.waitForTimeout(1500);
  const overlay = page.getByTestId("manuscript-overlay");
  await overlay.waitFor({ state: "visible", timeout: 15_000 });
  const tree = page.getByTestId("manuscript-tree");
  await tree.getByRole("button", { name: /正文/ }).first().click();
  await page.waitForTimeout(400);
  await tree.getByText("巷口.md").first().click();
  const bar = page.getByTestId("manuscript-proposal");
  await bar.waitFor({ state: "visible", timeout: 8_000 });
  await page.getByTestId("manuscript-proposal-accept").click();
  await page.waitForTimeout(800);
  const afterAccept = fs.readFileSync(path.join(workspace, "正文", "巷口.md"), "utf8");
  if (afterAccept !== "灯亮了。巷口只有风。") {
    note("同意未写入", afterAccept, "issue");
  } else {
    note("同意写入", afterAccept);
  }
  writeProposal(workspace, {
    id: "e2e-reject",
    path: "正文/巷口.md",
    kind: "replace",
    segments: [],
    body: "不该留下。",
    createdAt: Date.now(),
  });
  await page.waitForTimeout(2000);
  await bar.waitFor({ state: "visible", timeout: 8_000 });
  await page.getByTestId("manuscript-proposal-reject").click();
  await page.waitForTimeout(600);
  const afterReject = fs.readFileSync(path.join(workspace, "正文", "巷口.md"), "utf8");
  if (afterReject !== "灯亮了。巷口只有风。") {
    note("拒绝后被改了", afterReject, "issue");
  } else {
    note("拒绝保留原文", afterReject);
  }
  await page.screenshot({ path: path.join(OUT, "proposal-bar.png") });
} catch (error) {
  note("走查中断", error instanceof Error ? error.stack || error.message : String(error), "issue");
  await page.screenshot({ path: path.join(OUT, "crashed.png") }).catch(() => {});
} finally {
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ notes: NOTES, workspace }, null, 2), "utf8");
  await browser.close().catch(() => {});
  if (dshChild && dshChild.exitCode == null) {
    try {
      if (process.platform === "win32") spawn("taskkill", ["/pid", String(dshChild.pid), "/T", "/F"], { windowsHide: true });
      else dshChild.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  const issues = NOTES.filter((item) => item.severity === "issue").length;
  console.log(`workspace ${workspace}`);
  console.log(`report ${path.relative(root, path.join(OUT, "report.json"))}`);
  console.log(`issues ${issues}`);
  process.exit(issues ? 1 : 0);
}
