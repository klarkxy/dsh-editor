#!/usr/bin/env node
/**
 * Update import paths after workbench internal reorganization
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '../../packages/dsh-editor-workbench/src');

// Mapping of old imports to new imports
const importMapping = {
  // Proposals
  './writing-propose-tool': './proposals/writing-propose-tool',
  './planning-proposals': './proposals/planning-proposals',
  './proposal-ops': './proposals/proposal-ops',
  './chapter-meta': './proposals/chapter-meta',
  
  // Memory
  './author-memory': './memory/author-memory',
  './author-preferences': './memory/author-preferences',
  './memory': './memory/memory',
  './memory-tool': './memory/memory-tool',
  './memory-access': './memory/memory-access',
  './memory-contracts': './memory/memory-contracts',
  
  // Tools
  './tools': './tools/tools',
  './observe-tool': './tools/observe-tool',
  './novel-tools': './tools/novel-tools',
  './workbench-tools': './tools/workbench-tools',
  
  // Integrations
  './proofread': './integrations/proofread',
  './proofread-defaults': './integrations/proofread-defaults',
  './overview': './integrations/overview',
  
  // Lifecycle
  './lifecycle': './lifecycle/lifecycle',
  './project': './lifecycle/project',
  './import': './lifecycle/import',
  './snapshot': './lifecycle/snapshot',
  './writing-log': './lifecycle/writing-log',
  
  // Context
  './context': './context/context',
  './project-context-hooks': './context/project-context-hooks',
  
  // IO
  './binary': './io/binary',
  './metadata-io': './io/metadata-io',
  './frontmatter': './io/frontmatter',
};

async function updateImportsInFile(filePath, relativePath) {
  let content = await readFile(filePath, 'utf-8');
  let updated = false;
  
  for (const [oldPath, newPath] of Object.entries(importMapping)) {
    // Handle different import/export patterns
    const patterns = [
      // import ... from './old'
      new RegExp(`(from\\s+['"])${oldPath.replace(/\./g, '\\.')}(['"])`, 'g'),
      // export ... from './old'
      new RegExp(`(from\\s+['"])${oldPath.replace(/\./g, '\\.')}(['"])`, 'g'),
    ];
    
    for (const pattern of patterns) {
      if (pattern.test(content)) {
        content = content.replace(pattern, `$1${newPath}$2`);
        updated = true;
      }
    }
  }
  
  if (updated) {
    await writeFile(filePath, content, 'utf-8');
    console.log(`Updated: ${relativePath}`);
    return true;
  }
  
  return false;
}

async function updateDirectory(dir, baseDir = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  let count = 0;
  
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    
    if (entry.isDirectory()) {
      count += await updateDirectory(fullPath, baseDir);
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      const relativePath = fullPath.substring(baseDir.length + 1);
      if (await updateImportsInFile(fullPath, relativePath)) {
        count++;
      }
    }
  }
  
  return count;
}

console.log('Updating import paths in workbench...\n');

updateDirectory(srcDir).then(count => {
  console.log(`\n✓ Updated ${count} files`);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
