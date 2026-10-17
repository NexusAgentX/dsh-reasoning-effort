import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))

describe('model catalog source files', () => {
  it('keeps the generated catalog in sync with models/*.toml', () => {
    expect(() => execFileSync(
      process.execPath,
      ['scripts/generate-model-catalog.mjs', '--check'],
      { cwd: repositoryRoot, stdio: 'pipe', encoding: 'utf8' },
    )).not.toThrow()
  })
})
