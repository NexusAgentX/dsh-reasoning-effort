/**
 * Build script for both faces of dsh-reasoning-effort.
 *
 * Emits the Host ESM artifact (`lib/index.js`) and the browser closure-factory
 * artifact (`lib/client.js`). Host `@deepseek-ai/*` imports stay external;
 * the browser bundle keeps only platform module-table imports external.
 *
 * The native esbuild binary is invoked directly (stdio inherit) rather than
 * through the JS API: the JS API spawns a service process over a pipe, which
 * the development sandbox denies.
 */
import { spawnSync } from 'node:child_process'
import { globSync, mkdirSync, readFileSync } from 'node:fs'

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

function runEsbuild(args) {
  const result = spawnSync(esbuildBinary(), args, { stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function runTsc() {
  const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json'], {
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

mkdirSync('lib', { recursive: true })
runEsbuild([
  'src/index.ts',
  '--bundle',
  '--format=esm',
  '--platform=node',
  '--target=node20',
  '--external:@deepseek-ai/*',
  '--outfile=lib/index.js',
])

const clientExternals = [
  'react',
  'react/jsx-runtime',
  '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-client-ui-primitives',
]
runEsbuild([
  'src/client/index.tsx',
  '--bundle',
  '--format=cjs',
  '--platform=browser',
  '--target=es2020',
  '--jsx=automatic',
  '--define:process.env.NODE_ENV="production"',
  ...clientExternals.map(specifier => `--external:${specifier}`),
  '--banner:js=window.__ModuleLoader__.load({ id: "dsh-reasoning-effort", factory: (require) => { var module = { exports: {} }; var exports = module.exports;',
  '--footer:js=return module.exports; } });',
  '--outfile=lib/client.js',
])
runTsc()

const client = readFileSync('lib/client.js', 'utf8')
if (!client.includes('window.__ModuleLoader__.load(') || !client.includes('dsh-reasoning-effort')) {
  throw new Error('client bundle contract: closure-factory handoff is missing')
}
if (client.includes('import.meta') || /(^|\n)\s*(import|export)\s/.test(client)) {
  throw new Error('client bundle contract: classic-script artifact contains ESM syntax')
}
for (const match of client.matchAll(/require\(\s*["'](@deepseek-ai\/[^"']+)["']\s*\)/g)) {
  if (!clientExternals.includes(match[1])) {
    throw new Error(`client bundle contract: unsupported external ${match[1]}`)
  }
}
