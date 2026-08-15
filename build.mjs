/**
 * Build script for the dsh-providers-reasoning host plugin.
 *
 * Emits one ESM artifact, `lib/index.js`. Every `@deepseek-ai/*` import stays
 * EXTERNAL: the profile's healed `node_modules` fallback resolves them at
 * runtime, and the plugin must share the host's cordis/settings instances
 * rather than bundling its own copies.
 *
 * The native esbuild binary is invoked directly (stdio inherit) rather than
 * through the JS API: the JS API spawns a service process over a pipe, which
 * the development sandbox denies.
 */
import { spawnSync } from 'node:child_process'
import { globSync, mkdirSync } from 'node:fs'

function esbuildBinary() {
  // Platform-dependent pnpm layout: node_modules/.pnpm/@esbuild+<platform>-<arch>@*/...
  // falls back to a flat install (node_modules/@esbuild/<platform>-<arch>/...).
  const bin = process.platform === 'win32' ? 'esbuild.exe' : 'bin/esbuild'
  const triple = `${process.platform}-${process.arch}`
  const patterns = [
    `node_modules/.pnpm/@esbuild+${triple}@*/node_modules/@esbuild/${triple}/${bin}`,
    `node_modules/@esbuild/${triple}/${bin}`,
  ]
  for (const pattern of patterns) {
    const matches = globSync(pattern)
    if (matches.length > 0) return matches[0]
  }
  throw new Error(`esbuild native binary not found (${triple}) — run \`pnpm install\` first`)
}

mkdirSync('lib', { recursive: true })
const result = spawnSync(esbuildBinary(), [
  'src/index.ts',
  '--bundle',
  '--format=esm',
  '--platform=node',
  '--target=node20',
  '--external:@deepseek-ai/*',
  '--outfile=lib/index.js',
], { stdio: 'inherit' })
if (result.error !== undefined) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
