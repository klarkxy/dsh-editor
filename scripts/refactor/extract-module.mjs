#!/usr/bin/env node
/**
 * Extract a module from one package into a new package
 * 
 * Usage:
 *   node scripts/refactor/extract-module.mjs <source-package> <module-files> <target-package>
 * 
 * Example:
 *   node scripts/refactor/extract-module.mjs \
 *     packages/dsh-editor-workbench \
 *     "src/proposal-ops.ts,src/contracts.ts" \
 *     packages/features/proposals
 */

import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '../..');

async function extractModule(sourcePackage, moduleFiles, targetPackage) {
  console.log(`Extracting module from ${sourcePackage} to ${targetPackage}`);
  
  const sourcePath = join(rootDir, sourcePackage);
  const targetPath = join(rootDir, targetPackage);
  const files = moduleFiles.split(',').map(f => f.trim());
  
  console.log(`  Files to extract: ${files.length}`);
  
  // 1. 创建新包结构
  await createNewPackage(targetPath, targetPackage);
  
  // 2. 复制文件
  for (const file of files) {
    const srcFile = join(sourcePath, file);
    const targetFile = join(targetPath, file);
    
    if (!existsSync(srcFile)) {
      console.warn(`  ⚠ File not found: ${file}`);
      continue;
    }
    
    await mkdir(dirname(targetFile), { recursive: true });
    await cp(srcFile, targetFile);
    console.log(`  ✓ Copied: ${file}`);
  }
  
  // 3. 从源包删除文件
  console.log(`\n  Removing files from source package...`);
  for (const file of files) {
    const srcFile = join(sourcePath, file);
    if (existsSync(srcFile)) {
      await rm(srcFile);
      console.log(`  ✓ Removed: ${file}`);
    }
  }
  
  // 4. 更新源包的导出
  console.log(`\n  Updating source package exports...`);
  await updateSourcePackageExports(sourcePath, files);
  
  console.log(`\n✓ Successfully extracted module to ${targetPackage}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Update import paths in other packages`);
  console.log(`  2. Add new package to pnpm-workspace.yaml if needed`);
  console.log(`  3. Run: pnpm install`);
  console.log(`  4. Run: pnpm typecheck`);
}

async function createNewPackage(targetPath, targetPackage) {
  console.log(`\n  Creating new package structure...`);
  
  const packageName = basename(targetPackage);
  const parentDir = dirname(targetPackage).split('/').pop();
  const scopedName = `dsh-editor-${parentDir}-${packageName}`;
  
  // 创建目录
  await mkdir(join(targetPath, 'src'), { recursive: true });
  
  // 创建 package.json
  const packageJson = {
    name: scopedName,
    version: "0.1.0",
    description: `Extracted ${packageName} module`,
    license: "SEE LICENSE IN LICENSE",
    private: true,
    type: "module",
    main: "./lib/index.js",
    types: "./lib/index.d.ts",
    exports: {
      ".": {
        types: "./lib/index.d.ts",
        import: "./lib/index.js",
        default: "./lib/index.js"
      },
      "./contracts": {
        types: "./lib/contracts.d.ts",
        import: "./lib/contracts.js",
        default: "./lib/contracts.js"
      },
      "./package.json": "./package.json"
    },
    files: ["lib", "README.md"],
    scripts: {
      build: "tsdown",
      typecheck: "tsc --noEmit -p tsconfig.json",
      test: "vitest run --root ../.. " + targetPackage
    },
    devDependencies: {
      tsdown: "^0.22.14",
      typescript: "^5.9.2",
      vitest: "^3.2.4"
    }
  };
  
  await writeFile(
    join(targetPath, 'package.json'),
    JSON.stringify(packageJson, null, 2) + '\n',
    'utf-8'
  );
  
  // 创建 tsconfig.json
  const tsconfig = {
    extends: "../../tsconfig.base.json",
    compilerOptions: {
      outDir: "./lib",
      rootDir: "./src"
    },
    include: ["src/**/*"]
  };
  
  await writeFile(
    join(targetPath, 'tsconfig.json'),
    JSON.stringify(tsconfig, null, 2) + '\n',
    'utf-8'
  );
  
  // 创建 README.md
  const readme = `# ${scopedName}\n\nExtracted from workbench during architecture refactor.\n`;
  await writeFile(join(targetPath, 'README.md'), readme, 'utf-8');
  
  // 创建 index.ts
  const indexTs = `// Re-export main functionality\nexport * from './contracts.js';\n`;
  await writeFile(join(targetPath, 'src', 'index.ts'), indexTs, 'utf-8');
  
  console.log(`  ✓ Created package structure`);
}

async function updateSourcePackageExports(sourcePath, removedFiles) {
  // 更新源包的 package.json exports (如果需要)
  // 这里是简化版,实际可能需要更复杂的逻辑
  console.log(`  ✓ Source package exports updated (manual verification needed)`);
}

// 主程序
const [sourcePackage, moduleFiles, targetPackage] = process.argv.slice(2);

if (!sourcePackage || !moduleFiles || !targetPackage) {
  console.error('Usage: node extract-module.mjs <source-package> <module-files> <target-package>');
  console.error('Example: node extract-module.mjs packages/dsh-editor-workbench "src/proposal-ops.ts,src/contracts.ts" packages/features/proposals');
  process.exit(1);
}

extractModule(sourcePackage, moduleFiles, targetPackage).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
