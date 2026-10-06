#!/usr/bin/env node
/**
 * Validate dependency relationships after refactor
 * 
 * Usage:
 *   node scripts/refactor/validate-deps.mjs
 * 
 * Checks:
 * - No circular dependencies
 * - Correct dependency direction (App → Features → UI/Domain → Core)
 * - No domain dependencies in UI layer
 * - No domain dependencies in Core layer
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '../..');

const LAYER_ORDER = {
  app: 5,
  features: 4,
  ui: 3,
  domain: 3,
  core: 2,
};

async function validateDependencies() {
  console.log('🔍 Validating package dependencies...\n');
  
  const packages = await getAllPackages();
  const errors = [];
  const warnings = [];
  
  // 1. 检查循环依赖
  console.log('Checking for circular dependencies...');
  const cycles = findCircularDeps(packages);
  if (cycles.length > 0) {
    errors.push(`Found ${cycles.length} circular dependencies:`);
    cycles.forEach(cycle => errors.push(`  ${cycle.join(' → ')}`));
  } else {
    console.log('✓ No circular dependencies\n');
  }
  
  // 2. 检查依赖方向
  console.log('Checking dependency direction...');
  for (const pkg of packages) {
    const pkgLayer = getPackageLayer(pkg.name);
    
    for (const dep of pkg.dependencies) {
      const depPkg = packages.find(p => p.name === dep);
      if (!depPkg) continue; // 外部依赖
      
      const depLayer = getPackageLayer(dep);
      
      // UI不能依赖Domain
      if (pkgLayer === 'ui' && depLayer === 'domain') {
        errors.push(`❌ ${pkg.name} (UI) depends on ${dep} (Domain) - UI should not depend on Domain implementations`);
      }
      
      // Core不能依赖Domain或UI
      if (pkgLayer === 'core' && (depLayer === 'domain' || depLayer === 'ui' || depLayer === 'features')) {
        errors.push(`❌ ${pkg.name} (Core) depends on ${dep} (${depLayer}) - Core should have minimal dependencies`);
      }
      
      // Domain不能依赖UI或Features
      if (pkgLayer === 'domain' && (depLayer === 'ui' || depLayer === 'features')) {
        errors.push(`❌ ${pkg.name} (Domain) depends on ${dep} (${depLayer}) - Domain should not depend on UI or Features`);
      }
      
      // 检查层级顺序
      if (LAYER_ORDER[pkgLayer] < LAYER_ORDER[depLayer]) {
        warnings.push(`⚠️  ${pkg.name} (${pkgLayer}) depends on ${dep} (${depLayer}) - Lower layer depending on higher layer`);
      }
    }
  }
  
  if (errors.length === 0) {
    console.log('✓ All dependency directions are correct\n');
  }
  
  // 3. 统计信息
  console.log('=== Package Summary ===');
  const layerCounts = {};
  for (const pkg of packages) {
    const layer = getPackageLayer(pkg.name);
    layerCounts[layer] = (layerCounts[layer] || 0) + 1;
  }
  
  Object.entries(layerCounts).forEach(([layer, count]) => {
    console.log(`  ${layer}: ${count} packages`);
  });
  
  console.log(`\nTotal: ${packages.length} packages`);
  
  // 输出结果
  console.log('\n=== Validation Results ===');
  
  if (warnings.length > 0) {
    console.log(`\n⚠️  ${warnings.length} Warning(s):`);
    warnings.forEach(w => console.log(w));
  }
  
  if (errors.length > 0) {
    console.log(`\n❌ ${errors.length} Error(s):`);
    errors.forEach(e => console.log(e));
    process.exit(1);
  } else {
    console.log('\n✅ All validations passed!');
  }
}

async function getAllPackages() {
  const packages = [];
  
  // 扫描packages目录
  await scanDirectory(join(rootDir, 'packages'), packages);
  
  // 扫描apps目录
  await scanDirectory(join(rootDir, 'apps'), packages);
  
  return packages;
}

async function scanDirectory(dir, packages, depth = 0) {
  if (depth > 3) return; // 防止过深
  
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'lib') continue;
      
      const pkgJsonPath = join(dir, entry.name, 'package.json');
      try {
        const pkgJson = JSON.parse(await readFile(pkgJsonPath, 'utf-8'));
        packages.push({
          name: pkgJson.name,
          path: join(dir, entry.name),
          dependencies: [
            ...Object.keys(pkgJson.dependencies || {}),
            ...Object.keys(pkgJson.peerDependencies || {})
          ].filter(dep => dep.startsWith('dsh-editor-') || dep.startsWith('dsh-'))
        });
      } catch {
        // 没有package.json,继续扫描子目录
        await scanDirectory(join(dir, entry.name), packages, depth + 1);
      }
    }
  } catch {
    // 目录不存在或无法访问
  }
}

function getPackageLayer(packageName) {
  if (packageName.includes('/desktop')) return 'app';
  if (packageName.includes('features/') || packageName.includes('-features-')) return 'features';
  if (packageName.includes('ui/') || packageName.includes('-ui-') || 
      packageName.includes('shell') || packageName.includes('panel')) return 'ui';
  if (packageName.includes('domain/') || packageName.includes('-domain-') ||
      packageName.includes('manuscript') || packageName.includes('proofread') ||
      packageName.includes('novel') || packageName.includes('workbench')) return 'domain';
  if (packageName.includes('core/') || packageName.includes('-core-') ||
      packageName.includes('contracts') || packageName.includes('workspace') ||
      packageName.includes('seats') || packageName.includes('plugin-sdk')) return 'core';
  
  return 'unknown';
}

function findCircularDeps(packages) {
  const cycles = [];
  const visited = new Set();
  const recStack = new Set();
  
  function dfs(pkgName, path = []) {
    if (recStack.has(pkgName)) {
      const cycleStart = path.indexOf(pkgName);
      cycles.push([...path.slice(cycleStart), pkgName]);
      return;
    }
    
    if (visited.has(pkgName)) return;
    
    visited.add(pkgName);
    recStack.add(pkgName);
    
    const pkg = packages.find(p => p.name === pkgName);
    if (pkg) {
      for (const dep of pkg.dependencies) {
        dfs(dep, [...path, pkgName]);
      }
    }
    
    recStack.delete(pkgName);
  }
  
  for (const pkg of packages) {
    dfs(pkg.name);
  }
  
  return cycles;
}

// 主程序
validateDependencies().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
