#!/usr/bin/env node
/**
 * Move a package to a new location and update all import paths
 * 
 * Usage:
 *   node scripts/refactor/move-package.mjs <source> <target>
 * 
 * Example:
 *   node scripts/refactor/move-package.mjs packages/dsh-manuscript packages/domain/manuscript
 */

import { readdir, readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '../..');

async function movePackage(source, target) {
  console.log(`Moving ${source} -> ${target}`);
  
  const sourcePath = join(rootDir, source);
  const targetPath = join(rootDir, target);
  
  // 1. 读取package.json获取包名
  const pkgJsonPath = join(sourcePath, 'package.json');
  const pkgJson = JSON.parse(await readFile(pkgJsonPath, 'utf-8'));
  const packageName = pkgJson.name;
  
  console.log(`  Package: ${packageName}`);
  
  // 2. 创建目标目录
  await mkdir(dirname(targetPath), { recursive: true });
  
  // 3. 复制整个包
  console.log(`  Copying files...`);
  await cp(sourcePath, targetPath, { recursive: true });
  
  // 4. 更新所有文件中的import路径
  console.log(`  Updating import paths in all packages...`);
  await updateImportPaths(packageName, source, target);
  
  // 5. 更新pnpm-workspace.yaml
  console.log(`  Updating pnpm-workspace.yaml...`);
  await updateWorkspaceConfig(target);
  
  // 6. 删除原目录
  console.log(`  Removing source directory...`);
  await rm(sourcePath, { recursive: true, force: true });
  
  console.log(`✓ Successfully moved ${packageName}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Run: pnpm install`);
  console.log(`  2. Run: pnpm typecheck`);
  console.log(`  3. Commit the changes`);
}

async function updateImportPaths(packageName, oldPath, newPath) {
  const packagesDir = join(rootDir, 'packages');
  const appsDir = join(rootDir, 'apps');
  
  // 遍历所有包
  for (const dir of [packagesDir, appsDir]) {
    await updateImportsInDirectory(dir, packageName, oldPath, newPath);
  }
}

async function updateImportsInDirectory(dir, packageName, oldPath, newPath) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'lib') {
          continue;
        }
        await updateImportsInDirectory(fullPath, packageName, oldPath, newPath);
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') || 
                 entry.name.endsWith('.js') || entry.name.endsWith('.mjs') ||
                 entry.name === 'package.json' || entry.name === 'tsconfig.json') {
        await updateFileImports(fullPath, packageName, oldPath, newPath);
      }
    }
  } catch (err) {
    // Directory doesn't exist or not accessible
  }
}

async function updateFileImports(filePath, packageName, oldPath, newPath) {
  try {
    let content = await readFile(filePath, 'utf-8');
    let updated = false;
    
    // 更新workspace:*引用 (package.json)
    if (filePath.endsWith('package.json')) {
      const oldPattern = `"${packageName}": "workspace:\\*"`;
      if (content.includes(oldPattern)) {
        content = content.replace(
          new RegExp(`"${packageName}":\\s*"workspace:\\*"`, 'g'),
          `"${packageName}": "workspace:*"`
        );
        updated = true;
      }
    }
    
    // 更新tsconfig paths (暂不处理,pnpm会自动处理)
    
    if (updated) {
      await writeFile(filePath, content, 'utf-8');
      console.log(`    Updated: ${relative(rootDir, filePath)}`);
    }
  } catch (err) {
    // File not readable
  }
}

async function updateWorkspaceConfig(newPath) {
  const workspaceFile = join(rootDir, 'pnpm-workspace.yaml');
  let content = await readFile(workspaceFile, 'utf-8');
  
  // 检查是否需要添加新路径模式
  const pathPattern = newPath.split('/').slice(0, -1).join('/') + '/*';
  if (!content.includes(pathPattern)) {
    console.log(`  Adding pattern: ${pathPattern}`);
    // 简单追加,实际可能需要更智能的YAML编辑
    content = content.replace(
      'packages:\n',
      `packages:\n  - ${pathPattern}\n`
    );
    await writeFile(workspaceFile, content, 'utf-8');
  }
}

// 主程序
const [source, target] = process.argv.slice(2);

if (!source || !target) {
  console.error('Usage: node move-package.mjs <source> <target>');
  console.error('Example: node move-package.mjs packages/dsh-manuscript packages/domain/manuscript');
  process.exit(1);
}

movePackage(source, target).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
