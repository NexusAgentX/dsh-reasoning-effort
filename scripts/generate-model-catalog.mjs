/**
 * Build the runtime model catalog from the human-maintained TOML family files.
 *
 * Source of truth: models/*.toml
 * Generated artifact: src/model-catalog.generated.json
 *
 * TOML has no null value, so nullable catalog fields are represented by
 * omission. The generator normalizes omissions back to explicit nulls so the
 * runtime schema and tests stay unambiguous. `reasoningEfforts.off` is always
 * injected as null; TOML files only declare selectable thinking levels.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { basename, join } from 'node:path'
import { parse } from 'smol-toml'

const MODELS_DIR = fileURLToPath(new URL('../models/', import.meta.url))
const OUTPUT_FILE = fileURLToPath(new URL('../src/model-catalog.generated.json', import.meta.url))
const REASONING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const THINKING_LEVELS = REASONING_LEVELS.filter(level => level !== 'off')
const INPUT_MODALITIES = new Set(['text', 'image'])
const MODEL_KEYS = new Set([
  'model', 'aliases', 'input', 'contextWindow', 'maxOutputTokens',
  'pricing', 'reasoningEfforts', 'sources',
])
const PRICING_KEYS = new Set([
  'currency', 'unit', 'input', 'output', 'cacheRead', 'cacheWrite',
  'tiers', 'region', 'conditions',
])
const TIER_KEYS = new Set(['condition', 'input', 'output', 'cacheRead', 'cacheWrite'])
const SOURCE_KEYS = new Set(['capabilities', 'pricing'])

function fail(file, message) {
  throw new Error(`models/${file}: ${message}`)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertObject(value, file, label) {
  if (!isObject(value)) fail(file, `${label} must be a table`)
  return value
}

function assertKnownKeys(value, allowed, file, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(file, `${label} has unknown key "${key}"`)
  }
}

function assertString(value, file, label) {
  if (typeof value !== 'string' || value.length === 0) fail(file, `${label} must be a non-empty string`)
  return value
}

function readUrl(value, file, label) {
  const url = assertString(value, file, label)
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    fail(file, `${label} must be a valid URL`)
  }
  if (parsed.protocol !== 'https:') fail(file, `${label} must use https`)
  return url
}

function readPositiveIntegerOrNull(value, file, label) {
  if (value === undefined || value === null) return null
  if (!Number.isInteger(value) || value <= 0) fail(file, `${label} must be a positive integer`)
  return value
}

function readNonNegativeNumberOrNull(value, file, label) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail(file, `${label} must be a non-negative number`)
  }
  return value
}

function readStringArray(value, file, label) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.length === 0)) {
    fail(file, `${label} must be an array of non-empty strings`)
  }
  return [...value]
}

function normalizePricingTier(tier, file, index) {
  const label = `pricing.tiers[${index}]`
  assertObject(tier, file, label)
  assertKnownKeys(tier, TIER_KEYS, file, label)
  const normalized = { condition: assertString(tier.condition, file, `${label}.condition`) }
  for (const key of ['input', 'output', 'cacheRead', 'cacheWrite']) {
    if (tier[key] !== undefined) normalized[key] = readNonNegativeNumberOrNull(tier[key], file, `${label}.${key}`)
  }
  return normalized
}

function normalizePricing(value, file) {
  const pricing = assertObject(value, file, 'pricing')
  assertKnownKeys(pricing, PRICING_KEYS, file, 'pricing')
  if (pricing.currency !== 'USD') fail(file, 'pricing.currency must be "USD"')
  if (pricing.unit !== 'per_million_tokens') fail(file, 'pricing.unit must be "per_million_tokens"')
  const normalized = {
    currency: 'USD',
    unit: 'per_million_tokens',
    input: readNonNegativeNumberOrNull(pricing.input, file, 'pricing.input'),
    output: readNonNegativeNumberOrNull(pricing.output, file, 'pricing.output'),
    cacheRead: readNonNegativeNumberOrNull(pricing.cacheRead, file, 'pricing.cacheRead'),
    cacheWrite: readNonNegativeNumberOrNull(pricing.cacheWrite, file, 'pricing.cacheWrite'),
  }
  if (pricing.tiers !== undefined) {
    if (!Array.isArray(pricing.tiers)) fail(file, 'pricing.tiers must be an array of tables')
    if (pricing.tiers.length > 0) {
      normalized.tiers = pricing.tiers.map((tier, index) => normalizePricingTier(tier, file, index))
    }
  }
  if (pricing.region !== undefined) normalized.region = assertString(pricing.region, file, 'pricing.region')
  if (pricing.conditions !== undefined) {
    normalized.conditions = assertString(pricing.conditions, file, 'pricing.conditions')
  }
  return normalized
}

function normalizeReasoningEfforts(value, file) {
  const efforts = assertObject(value, file, 'reasoningEfforts')
  const normalized = { off: null }
  for (const level of THINKING_LEVELS) {
    if (efforts[level] === undefined) continue
    if (efforts[level] !== level) fail(file, `reasoningEfforts.${level} must equal "${level}"`)
    normalized[level] = level
  }
  for (const key of Object.keys(efforts)) {
    if (key === 'off') fail(file, 'reasoningEfforts.off is implicit and must be omitted')
    if (!THINKING_LEVELS.includes(key)) fail(file, `reasoningEfforts has unknown level "${key}"`)
  }
  return normalized
}

function normalizeModel(model, file) {
  assertObject(model, file, 'models[] entry')
  assertKnownKeys(model, MODEL_KEYS, file, 'models[] entry')
  const input = readStringArray(model.input, file, 'input')
  if (!input.includes('text')) fail(file, 'input must include "text"')
  for (const modality of input) {
    if (!INPUT_MODALITIES.has(modality)) fail(file, `input has unsupported modality "${modality}"`)
  }
  const sources = assertObject(model.sources, file, 'sources')
  assertKnownKeys(sources, SOURCE_KEYS, file, 'sources')
  return {
    model: assertString(model.model, file, 'model'),
    aliases: readStringArray(model.aliases, file, 'aliases'),
    input: [...new Set(input)],
    contextWindow: readPositiveIntegerOrNull(model.contextWindow, file, 'contextWindow'),
    maxOutputTokens: readPositiveIntegerOrNull(model.maxOutputTokens, file, 'maxOutputTokens'),
    pricing: normalizePricing(model.pricing, file),
    reasoningEfforts: normalizeReasoningEfforts(model.reasoningEfforts, file),
    sources: {
      capabilities: readUrl(sources.capabilities, file, 'sources.capabilities'),
      pricing: readUrl(sources.pricing, file, 'sources.pricing'),
    },
  }
}

function readFamilyFile(file) {
  const family = basename(file, '.toml')
  const source = readFileSync(join(MODELS_DIR, file), 'utf8')
  let document
  try {
    document = parse(source)
  } catch (error) {
    throw new Error(`models/${file}: invalid TOML: ${error instanceof Error ? error.message : String(error)}`)
  }
  assertObject(document, file, 'document')
  assertKnownKeys(document, new Set(['family', 'description', 'models']), file, 'document')
  if (document.family !== family) {
    fail(file, `family must match filename "${family}"`)
  }
  if (document.description !== undefined) assertString(document.description, file, 'description')
  if (!Array.isArray(document.models) || document.models.length === 0) {
    fail(file, 'models must be a non-empty array of tables')
  }
  return document.models.map(model => normalizeModel(model, file))
}

const files = readdirSync(MODELS_DIR).filter(file => file.endsWith('.toml')).sort()
if (files.length === 0) throw new Error('models/: no family TOML files found')

const models = []
const seenModels = new Set()
for (const file of files) {
  for (const model of readFamilyFile(file)) {
    if (seenModels.has(model.model)) throw new Error(`models/${file}: duplicate model "${model.model}"`)
    seenModels.add(model.model)
    models.push(model)
  }
}

const output = `${JSON.stringify({ version: 1, models }, null, 2)}\n`
if (process.argv.includes('--check')) {
  let current = ''
  try {
    current = readFileSync(OUTPUT_FILE, 'utf8')
  } catch {
    throw new Error('src/model-catalog.generated.json is missing; run pnpm run generate:models')
  }
  if (current !== output) {
    throw new Error('src/model-catalog.generated.json is stale; run pnpm run generate:models')
  }
  console.log(`model catalog is up to date (${models.length} models, ${files.length} family files)`)
} else {
  writeFileSync(OUTPUT_FILE, output)
  console.log(`generated src/model-catalog.generated.json (${models.length} models, ${files.length} family files)`)
}
