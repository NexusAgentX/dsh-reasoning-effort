// src/index.ts
import { ReasoningEffortId } from "@deepseek-ai/dsh-llm";
import { SettingsConflictError } from "@deepseek-ai/dsh-settings";

// src/config.ts
import z from "@deepseek-ai/schemastery";

// src/constants.ts
var REASONING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
];
var PLUGIN_SETTINGS_NAMESPACE_ID = "providers-reasoning";
var PI_AI_SETTINGS_NAMESPACE_ID = "llm-pi-ai";
var AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE_ID = "agent-default-model";

// src/config.ts
var DEFAULT_EFFORTS = {
  off: null,
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max"
};
var reasoningEffortsSchema = z.dict(
  z.union([z.string(), z.const(null)]),
  z.union(REASONING_LEVELS)
);
var capabilitySchema = z.union([
  z.const(false),
  reasoningEffortsSchema
]);
var modelsSchema = z.dict(z.dict(capabilitySchema)).default({});
var defaultsSchema = z.dict(z.dict(z.string())).default({});
var legacyDefaultsMigratedSchema = z.boolean().default(false);
var ReasoningPluginSettingsSchema = z.object({
  models: modelsSchema,
  defaults: defaultsSchema,
  legacyDefaultsMigrated: legacyDefaultsMigratedSchema
});
function emptyReasoningPluginSettings() {
  return { models: {}, defaults: {}, legacyDefaultsMigrated: false };
}
function validateReasoningPluginSettings(settings) {
  for (const [provider, models] of Object.entries(settings.models)) {
    if (provider.length === 0) {
      throw new Error("dsh-reasoning-effort: provider keys must be non-empty");
    }
    for (const [model, capability] of Object.entries(models)) {
      if (model.length === 0) {
        throw new Error(`dsh-reasoning-effort: model keys under provider "${provider}" must be non-empty`);
      }
      if (capability !== false) resolveConfig({ efforts: capability });
    }
  }
  for (const [provider, models] of Object.entries(settings.defaults)) {
    if (provider.length === 0) {
      throw new Error("dsh-reasoning-effort: default provider keys must be non-empty");
    }
    for (const [model, effort] of Object.entries(models)) {
      if (model.length === 0 || effort.length === 0) {
        throw new Error(`dsh-reasoning-effort: defaults under provider "${provider}" need non-empty model and effort values`);
      }
    }
  }
}
var optionalEffortsSchema = z.union([z.const(void 0), reasoningEffortsSchema]);
var Config = z.object({
  efforts: optionalEffortsSchema,
  models: modelsSchema.volatile(),
  defaults: defaultsSchema.volatile(),
  legacyDefaultsMigrated: legacyDefaultsMigratedSchema.volatile()
});
var CONFIG_KEYS = /* @__PURE__ */ new Set([
  "efforts",
  "models",
  "defaults",
  "legacyDefaultsMigrated"
]);
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function plain(value) {
  if (Array.isArray(value)) return value.map((entry) => plain(entry));
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, plain(entry)]));
  }
  return value;
}
function current(value, fallback) {
  if (value === void 0 || value === null) return fallback;
  if (isRecord(value) && typeof value.get === "function") {
    return plain(value.get());
  }
  return plain(value);
}
function resolveConfig(raw) {
  if (!isRecord(raw)) {
    throw new TypeError("dsh-reasoning-effort: configuration must be a plain object");
  }
  for (const key of Object.keys(raw)) {
    if (!CONFIG_KEYS.has(key)) {
      throw new Error(`dsh-reasoning-effort: unknown config key "${key}"`);
    }
  }
  const efforts = optionalEffortsSchema(raw.efforts);
  if (efforts === void 0) return {};
  const levels = Object.keys(efforts);
  if (levels.length === 0) {
    throw new Error("dsh-reasoning-effort: efforts must declare at least one reasoning level");
  }
  let thinkingLevel = false;
  for (const [level, wire] of Object.entries(efforts)) {
    if (!REASONING_LEVELS.includes(level)) {
      throw new Error(`dsh-reasoning-effort: unknown reasoning level "${level}"`);
    }
    if (wire === null) {
      if (level !== "off") {
        throw new Error(`dsh-reasoning-effort: only "off" may leave its wire spelling empty (${level} needs a value)`);
      }
    } else if (typeof wire !== "string" || wire.length === 0) {
      throw new Error(`dsh-reasoning-effort: reasoningEfforts.${level} must be a non-empty string or, for "off", null`);
    }
    if (level !== "off") thinkingLevel = true;
  }
  if (!thinkingLevel) {
    throw new Error('dsh-reasoning-effort: efforts must offer at least one level beyond "off"');
  }
  return { efforts: { ...efforts } };
}
function resolveRuntimeConfig(raw) {
  const resolved = resolveConfig(raw);
  const config = raw;
  const settings = () => {
    const value = {
      models: current(config.models, emptyReasoningPluginSettings().models),
      defaults: current(config.defaults, emptyReasoningPluginSettings().defaults),
      legacyDefaultsMigrated: current(config.legacyDefaultsMigrated, false)
    };
    validateReasoningPluginSettings(value);
    return value;
  };
  settings();
  return { ...resolved, settings };
}

// src/enrich.ts
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function copyEfforts(efforts) {
  return { ...efforts };
}
function copyInput(input) {
  return [...input];
}
function copyCapability(capability) {
  return capability === false ? false : copyEfforts(capability);
}
function capabilityEquals(value, expected) {
  if (expected === false) return value === false;
  if (!isPlainObject(value)) return false;
  const valueEntries = Object.entries(value);
  const expectedEntries = Object.entries(expected);
  if (valueEntries.length !== expectedEntries.length) return false;
  return expectedEntries.every(([level, wire]) => value[level] === wire);
}
function modelIdFor(entry, fallback) {
  for (const key of ["id", "model", "name"]) {
    const value = entry[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return fallback;
}
function enrichedEntry(entry, resolveEfforts, resolveOverride, resolveInput, resolveCapacity, providerId, fallbackModelId) {
  if (!isPlainObject(entry)) return entry;
  const modelId = modelIdFor(entry, fallbackModelId);
  if (modelId === void 0) return entry;
  const changes = {};
  const override = resolveOverride(providerId, modelId);
  if (override !== void 0) {
    if (!capabilityEquals(entry["reasoningEfforts"], override)) {
      changes.reasoningEfforts = copyCapability(override);
    }
  } else if (entry["reasoningEfforts"] === void 0) {
    const efforts = resolveEfforts(modelId);
    if (efforts !== void 0) changes.reasoningEfforts = copyEfforts(efforts);
  }
  if (entry["input"] === void 0) {
    const input = resolveInput(modelId);
    if (input !== void 0 && input.includes("image")) changes.input = copyInput(input);
  }
  if (entry["contextWindow"] === void 0 || entry["maxTokens"] === void 0) {
    const capacity = resolveCapacity(modelId);
    if (capacity !== void 0) {
      if (entry["contextWindow"] === void 0) changes.contextWindow = capacity.contextWindow;
      if (entry["maxTokens"] === void 0) changes.maxTokens = capacity.maxTokens;
    }
  }
  return Object.keys(changes).length === 0 ? entry : { ...entry, ...changes };
}
function computeEnrichmentOps(user, resolveEfforts, resolveOverride = () => void 0, resolveInput = () => void 0, resolveCapacity = () => void 0) {
  if (!isPlainObject(user)) return [];
  const providers = user["providers"];
  if (!isPlainObject(providers)) return [];
  const ops = [];
  for (const [route, profileValue] of Object.entries(providers)) {
    if (!isPlainObject(profileValue)) continue;
    const profile = profileValue;
    const models = profile["models"];
    if (Array.isArray(models)) {
      const next = models.map((entry) => enrichedEntry(entry, resolveEfforts, resolveOverride, resolveInput, resolveCapacity, route));
      if (next.some((entry, index) => entry !== models[index])) {
        ops.push({
          op: "set",
          path: ["providers", route, "models"],
          value: next
        });
      }
    }
    const overrides = profile["modelOverrides"];
    if (isPlainObject(overrides)) {
      const next = {};
      let changed = false;
      for (const [model, entry] of Object.entries(overrides)) {
        const enriched = enrichedEntry(
          entry,
          resolveEfforts,
          resolveOverride,
          resolveInput,
          resolveCapacity,
          route,
          model
        );
        Object.defineProperty(next, model, {
          value: enriched,
          enumerable: true,
          configurable: true,
          writable: true
        });
        changed ||= enriched !== entry;
      }
      if (changed) {
        ops.push({
          op: "set",
          path: ["providers", route, "modelOverrides"],
          value: next
        });
      }
    }
  }
  return ops;
}

// src/model-catalog.generated.json
var model_catalog_generated_default = {
  version: 1,
  models: [
    {
      model: "claude-opus-4.6",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 1e6,
      maxOutputTokens: 128e3,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 5,
        output: 25,
        cacheRead: 0.5,
        cacheWrite: 6.25,
        tiers: [
          {
            condition: "1h cache write",
            cacheWrite: 10
          }
        ]
      },
      reasoningEfforts: {
        off: null,
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: "max"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://docs.anthropic.com/en/docs/about-claude/pricing"
      }
    },
    {
      model: "claude-opus-4.7",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 1e6,
      maxOutputTokens: 128e3,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 5,
        output: 25,
        cacheRead: 0.5,
        cacheWrite: 6.25,
        tiers: [
          {
            condition: "1h cache write",
            cacheWrite: 10
          }
        ]
      },
      reasoningEfforts: {
        off: null,
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: "max"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://docs.anthropic.com/en/docs/about-claude/pricing"
      }
    },
    {
      model: "claude-opus-4.8",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 1e6,
      maxOutputTokens: 128e3,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 5,
        output: 25,
        cacheRead: 0.5,
        cacheWrite: 6.25,
        tiers: [
          {
            condition: "1h cache write",
            cacheWrite: 10
          }
        ]
      },
      reasoningEfforts: {
        off: null,
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: "max"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://docs.anthropic.com/en/docs/about-claude/pricing"
      }
    },
    {
      model: "claude-opus-5",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 1e6,
      maxOutputTokens: 128e3,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 5,
        output: 25,
        cacheRead: 0.5,
        cacheWrite: 6.25,
        tiers: [
          {
            condition: "1h cache write",
            cacheWrite: 10
          }
        ]
      },
      reasoningEfforts: {
        off: null,
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: "max"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://docs.anthropic.com/en/docs/about-claude/pricing"
      }
    },
    {
      model: "claude-opus-5-5",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 1e6,
      maxOutputTokens: 128e3,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 4,
        output: 20,
        cacheRead: 0.2,
        cacheWrite: 5
      },
      reasoningEfforts: {
        off: null,
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: "max"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://docs.anthropic.com/en/docs/about-claude/pricing"
      }
    },
    {
      model: "claude-sonnet-4.6",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 1e6,
      maxOutputTokens: 128e3,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 3,
        output: 15,
        cacheRead: 0.3,
        cacheWrite: 3.75,
        tiers: [
          {
            condition: "1h cache write",
            cacheWrite: 6
          }
        ]
      },
      reasoningEfforts: {
        off: null,
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: "max"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://docs.anthropic.com/en/docs/about-claude/pricing"
      }
    },
    {
      model: "claude-sonnet-5",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 1e6,
      maxOutputTokens: 128e3,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 2,
        output: 10,
        cacheRead: 0.2,
        cacheWrite: 2.5,
        tiers: [
          {
            condition: "1h cache write",
            cacheWrite: 4
          }
        ]
      },
      reasoningEfforts: {
        off: null,
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: "max"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://docs.anthropic.com/en/docs/about-claude/pricing"
      }
    },
    {
      model: "claude-sonnet-5-5",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 1e6,
      maxOutputTokens: 128e3,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 2,
        output: 10,
        cacheRead: 0.1,
        cacheWrite: 2.5
      },
      reasoningEfforts: {
        off: null,
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: "max"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://docs.anthropic.com/en/docs/about-claude/pricing"
      }
    },
    {
      model: "claude-fable-5",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 1e6,
      maxOutputTokens: 128e3,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 10,
        output: 50,
        cacheRead: 1,
        cacheWrite: 12.5,
        tiers: [
          {
            condition: "1h cache write",
            cacheWrite: 20
          }
        ]
      },
      reasoningEfforts: {
        off: null,
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: "max"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://docs.anthropic.com/en/docs/about-claude/pricing"
      }
    },
    {
      model: "claude-fable-5-1",
      aliases: [
        "fable-5.1"
      ],
      input: [
        "text",
        "image"
      ],
      contextWindow: 1e6,
      maxOutputTokens: 128e3,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 10,
        output: 50,
        cacheRead: 0.25,
        cacheWrite: 12.5,
        tiers: [
          {
            condition: "1h cache write",
            cacheWrite: 20
          }
        ]
      },
      reasoningEfforts: {
        off: null,
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: "max"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://docs.anthropic.com/en/docs/about-claude/pricing"
      }
    },
    {
      model: "claude-haiku-5-5",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 1e6,
      maxOutputTokens: 128e3,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 0.1,
        output: 0.5,
        cacheRead: 0.01,
        cacheWrite: 0.125,
        tiers: [
          {
            condition: "promptTokens > 100000",
            input: 0.5,
            output: 2.5,
            cacheRead: 0.05,
            cacheWrite: 0.625
          }
        ]
      },
      reasoningEfforts: {
        off: null,
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: "max"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://docs.anthropic.com/en/docs/about-claude/pricing"
      }
    },
    {
      model: "deepseek-v4-flash",
      aliases: [],
      input: [
        "text"
      ],
      contextWindow: 1048576,
      maxOutputTokens: 393216,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: null,
        output: null,
        cacheRead: null,
        cacheWrite: null
      },
      reasoningEfforts: {
        off: null,
        high: "high",
        max: "max"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://api-docs.deepseek.com/news/news260813/"
      }
    },
    {
      model: "deepseek-v4-pro",
      aliases: [],
      input: [
        "text"
      ],
      contextWindow: 1048576,
      maxOutputTokens: 393216,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: null,
        output: null,
        cacheRead: null,
        cacheWrite: null
      },
      reasoningEfforts: {
        off: null,
        high: "high",
        max: "max"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://api-docs.deepseek.com/news/news260813/"
      }
    },
    {
      model: "deepseek-v4-flash-vision-exp",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 1048576,
      maxOutputTokens: 384e3,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 0.22,
        output: 0.66,
        cacheRead: 7e-3,
        cacheWrite: null
      },
      reasoningEfforts: {
        off: null,
        low: "low",
        high: "high",
        max: "max"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://api-docs.deepseek.com/news/news260821/"
      }
    },
    {
      model: "deepseek-flash",
      aliases: [
        "deepseek-v4.1-flash"
      ],
      input: [
        "text",
        "image"
      ],
      contextWindow: 1e6,
      maxOutputTokens: 384e3,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 0.15,
        output: 0.6,
        cacheRead: 3e-3,
        cacheWrite: null,
        conditions: "Off-peak rate; peak hours (01:00-04:00, 06:00-10:00 UTC Mon-Fri) are 2x."
      },
      reasoningEfforts: {
        off: null,
        low: "low",
        high: "high",
        max: "max"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://api-docs.deepseek.com/quick_start/pricing"
      }
    },
    {
      model: "gemini-3.7-flash",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 1048576,
      maxOutputTokens: 1048576,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 0.75,
        output: 3.75,
        cacheRead: 0.075,
        cacheWrite: 0.038
      },
      reasoningEfforts: {
        off: null,
        low: "low",
        medium: "medium",
        high: "high"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://ai.google.dev/gemini-api/docs/pricing"
      }
    },
    {
      model: "gemini-3.8-flash",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 1048576,
      maxOutputTokens: 65536,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 0.75,
        output: 3.75,
        cacheRead: 0.075,
        cacheWrite: 0.038
      },
      reasoningEfforts: {
        off: null,
        low: "low",
        medium: "medium",
        high: "high"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://ai.google.dev/gemini-api/docs/pricing"
      }
    },
    {
      model: "gemini-4-argon",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 1048576,
      maxOutputTokens: 32768,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 2,
        output: 10,
        cacheRead: 0.1,
        cacheWrite: null
      },
      reasoningEfforts: {
        off: null,
        low: "low",
        medium: "medium",
        high: "high"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://ai.google.dev/gemini-api/docs/pricing"
      }
    },
    {
      model: "glm-5.3",
      aliases: [],
      input: [
        "text"
      ],
      contextWindow: 1048576,
      maxOutputTokens: 131072,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 1.4,
        output: 4.4,
        cacheRead: 0.26,
        cacheWrite: null
      },
      reasoningEfforts: {
        off: null,
        low: "low",
        high: "high",
        max: "max"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://docs.z.ai/guides/glm-5/pricing"
      }
    },
    {
      model: "glm-5.3-flash",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 1048576,
      maxOutputTokens: 131072,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 0.15,
        output: 0.5,
        cacheRead: 0.03,
        cacheWrite: null
      },
      reasoningEfforts: {
        off: null,
        low: "low",
        high: "high",
        max: "max"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://docs.z.ai/guides/glm-5/pricing"
      }
    },
    {
      model: "glm-5.3-flashx",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 1e6,
      maxOutputTokens: 131072,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 0.37,
        output: 1.25,
        cacheRead: 0.075,
        cacheWrite: 0
      },
      reasoningEfforts: {
        off: null,
        low: "low",
        high: "high",
        max: "max"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://docs.z.ai/guides/glm-5/pricing"
      }
    },
    {
      model: "gpt-5.4",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 105e4,
      maxOutputTokens: 128e3,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 2.5,
        output: 15,
        cacheRead: 0.25,
        cacheWrite: null
      },
      reasoningEfforts: {
        off: null,
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://developers.openai.com/api/docs/models/gpt-5.4"
      }
    },
    {
      model: "gpt-5.5",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 105e4,
      maxOutputTokens: 128e3,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: null,
        output: null,
        cacheRead: null,
        cacheWrite: null
      },
      reasoningEfforts: {
        off: null,
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://developers.openai.com/api/docs/models/compare"
      }
    },
    {
      model: "gpt-5.6-sol",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 105e4,
      maxOutputTokens: 128e3,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 5,
        output: 30,
        cacheRead: 0.5,
        cacheWrite: 6.25,
        tiers: [
          {
            condition: "promptTokens > 272000",
            input: 10,
            output: 45
          }
        ]
      },
      reasoningEfforts: {
        off: null,
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: "max"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://developers.openai.com/api/docs/models/gpt-5.6-sol"
      }
    },
    {
      model: "gpt-5.6-terra",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 105e4,
      maxOutputTokens: 128e3,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 2,
        output: 12,
        cacheRead: 0.2,
        cacheWrite: 2.5,
        tiers: [
          {
            condition: "promptTokens > 272000",
            input: 4,
            output: 18
          }
        ]
      },
      reasoningEfforts: {
        off: null,
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: "max"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://developers.openai.com/api/docs/models/gpt-5.6-terra"
      }
    },
    {
      model: "gpt-5.6-luna",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 105e4,
      maxOutputTokens: 128e3,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 0.2,
        output: 1.2,
        cacheRead: 0.02,
        cacheWrite: 0.25,
        tiers: [
          {
            condition: "promptTokens > 272000",
            input: 0.4,
            output: 1.8
          }
        ]
      },
      reasoningEfforts: {
        off: null,
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: "max"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://developers.openai.com/api/docs/models/gpt-5.6-luna"
      }
    },
    {
      model: "gpt-6-astra",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 105e4,
      maxOutputTokens: 128e3,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 10,
        output: 50,
        cacheRead: 1,
        cacheWrite: 12.5,
        tiers: [
          {
            condition: "promptTokens > 272000",
            input: 20,
            output: 75,
            cacheRead: 2,
            cacheWrite: 25
          }
        ]
      },
      reasoningEfforts: {
        off: null,
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: "max"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://developers.openai.com/api/docs/models/gpt-6-astra"
      }
    },
    {
      model: "gpt-6-sol",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 105e4,
      maxOutputTokens: 128e3,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 2,
        output: 10,
        cacheRead: 0.2,
        cacheWrite: 2.5,
        tiers: [
          {
            condition: "promptTokens > 272000",
            input: 4,
            output: 15,
            cacheRead: 0.4,
            cacheWrite: 5
          }
        ]
      },
      reasoningEfforts: {
        off: null,
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: "max"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://developers.openai.com/api/docs/models/gpt-6-sol"
      }
    },
    {
      model: "gpt-6-luna",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 105e4,
      maxOutputTokens: 128e3,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 0.1,
        output: 0.5,
        cacheRead: 0.01,
        cacheWrite: 0.125,
        tiers: [
          {
            condition: "promptTokens > 272000",
            input: 0.2,
            output: 0.75,
            cacheRead: 0.02,
            cacheWrite: 0.25
          }
        ]
      },
      reasoningEfforts: {
        off: null,
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: "max"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://developers.openai.com/api/docs/models/gpt-6-luna"
      }
    },
    {
      model: "gpt-6.1-sol",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 105e4,
      maxOutputTokens: 128e3,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 2,
        output: 10,
        cacheRead: 0.1,
        cacheWrite: 2.5,
        tiers: [
          {
            condition: "promptTokens > 272000",
            input: 4,
            output: 15,
            cacheRead: 0.2,
            cacheWrite: 5
          }
        ]
      },
      reasoningEfforts: {
        off: null,
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: "max"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://developers.openai.com/api/docs/models/gpt-6.1-sol"
      }
    },
    {
      model: "grok-4.5",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 5e5,
      maxOutputTokens: 5e5,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 2,
        output: 6,
        cacheRead: 0.3,
        cacheWrite: null,
        tiers: [
          {
            condition: "promptTokens >= 200000",
            input: 4,
            output: 12,
            cacheRead: 0.6
          }
        ]
      },
      reasoningEfforts: {
        off: null,
        low: "low",
        medium: "medium",
        high: "high"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://docs.x.ai/developers/pricing"
      }
    },
    {
      model: "grok-4.6",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 5e5,
      maxOutputTokens: 5e5,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 2,
        output: 6,
        cacheRead: 0.5,
        cacheWrite: null,
        tiers: [
          {
            condition: "promptTokens >= 200000",
            input: 4,
            output: 12,
            cacheRead: 1
          }
        ]
      },
      reasoningEfforts: {
        off: null,
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://docs.x.ai/developers/pricing"
      }
    },
    {
      model: "grok-4.7",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 5e5,
      maxOutputTokens: 5e5,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 2,
        output: 6,
        cacheRead: 0.5,
        cacheWrite: null,
        tiers: [
          {
            condition: "promptTokens > 200000",
            input: 4,
            output: 12,
            cacheRead: 1
          }
        ]
      },
      reasoningEfforts: {
        off: null,
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://docs.x.ai/developers/pricing"
      }
    },
    {
      model: "hy3",
      aliases: [],
      input: [
        "text"
      ],
      contextWindow: 262144,
      maxOutputTokens: 262144,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 0.066,
        output: 0.26,
        cacheRead: 0.029,
        cacheWrite: null
      },
      reasoningEfforts: {
        off: null,
        low: "low",
        high: "high"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://cloud.tencent.com/document/product/1729"
      }
    },
    {
      model: "kimi-k3",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 1048560,
      maxOutputTokens: 1048560,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 3,
        output: 15,
        cacheRead: 0.3,
        cacheWrite: null
      },
      reasoningEfforts: {
        off: null,
        low: "low",
        high: "high",
        max: "max"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://platform.moonshot.cn/docs/pricing/chat"
      }
    },
    {
      model: "mimo-v2.5",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 1048576,
      maxOutputTokens: 131072,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 0.14,
        output: 0.28,
        cacheRead: 28e-4,
        cacheWrite: 0
      },
      reasoningEfforts: {
        off: null,
        high: "high"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://docs.mimo.com/pricing"
      }
    },
    {
      model: "mimo-v2.5-pro",
      aliases: [],
      input: [
        "text"
      ],
      contextWindow: 1048576,
      maxOutputTokens: 131072,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 0.435,
        output: 0.87,
        cacheRead: 36e-4,
        cacheWrite: 0
      },
      reasoningEfforts: {
        off: null,
        high: "high"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://docs.mimo.com/pricing"
      }
    },
    {
      model: "mimo-v2.6-pro",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 1048576,
      maxOutputTokens: 131072,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 0.435,
        output: 0.87,
        cacheRead: 36e-4,
        cacheWrite: null
      },
      reasoningEfforts: {
        off: null,
        high: "high"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://docs.mimo.com/pricing"
      }
    },
    {
      model: "mimo-v2.6-flash",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 1048576,
      maxOutputTokens: 131072,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 0.14,
        output: 0.28,
        cacheRead: 28e-4,
        cacheWrite: null
      },
      reasoningEfforts: {
        off: null,
        high: "high"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://docs.mimo.com/pricing"
      }
    },
    {
      model: "mimo-v2.6-pro-ultraspeed",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 1048576,
      maxOutputTokens: 131072,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 4.35,
        output: 8.7,
        cacheRead: 0.036,
        cacheWrite: null
      },
      reasoningEfforts: {
        off: null,
        high: "high"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://docs.mimo.com/pricing"
      }
    },
    {
      model: "MiniMax-M3",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 1e6,
      maxOutputTokens: 512e3,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 0.3,
        output: 1.2,
        cacheRead: 0.06,
        cacheWrite: null,
        tiers: [
          {
            condition: "promptTokens > 512000",
            input: 0.6,
            output: 2.4,
            cacheRead: 0.12
          }
        ]
      },
      reasoningEfforts: {
        off: null,
        high: "high"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://platform.minimax.io/docs/guides/pricing"
      }
    },
    {
      model: "MiniMax-M3.1-Flash-Preview",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 1e6,
      maxOutputTokens: 512e3,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: null,
        output: null,
        cacheRead: null,
        cacheWrite: null,
        conditions: "MiniMax Coding Plan subscription; per-token API pricing is not published."
      },
      reasoningEfforts: {
        off: null,
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: "max"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://platform.minimax.io/docs/guides/pricing"
      }
    },
    {
      model: "qwen3.7-max",
      aliases: [],
      input: [
        "text"
      ],
      contextWindow: 1e6,
      maxOutputTokens: 65536,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 2.5,
        output: 7.5,
        cacheRead: null,
        cacheWrite: null,
        region: "Singapore International",
        conditions: "Official list price; a time-limited discount may apply."
      },
      reasoningEfforts: {
        off: null,
        high: "high"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://www.alibabacloud.com/help/en/model-studio/model-pricing"
      }
    },
    {
      model: "qwen3.7-plus",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 991808,
      maxOutputTokens: 65536,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 0.4,
        output: 1.6,
        cacheRead: null,
        cacheWrite: null,
        tiers: [
          {
            condition: "promptTokens > 256000",
            input: 1.2,
            output: 4.8
          }
        ],
        region: "Singapore International"
      },
      reasoningEfforts: {
        off: null,
        high: "high"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://www.alibabacloud.com/help/en/model-studio/model-pricing"
      }
    },
    {
      model: "qwen3.7-flash",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 991808,
      maxOutputTokens: 65536,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: null,
        output: null,
        cacheRead: null,
        cacheWrite: null,
        region: "Singapore International"
      },
      reasoningEfforts: {
        off: null,
        high: "high"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://www.alibabacloud.com/help/en/model-studio/model-pricing"
      }
    },
    {
      model: "qwen3.8-max",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 991e3,
      maxOutputTokens: 131072,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: null,
        output: null,
        cacheRead: null,
        cacheWrite: null,
        region: "Singapore International"
      },
      reasoningEfforts: {
        off: null,
        low: "low",
        medium: "medium",
        high: "high",
        max: "max"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://www.alibabacloud.com/help/en/model-studio/model-pricing"
      }
    },
    {
      model: "qwen3.8-27b",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 262144,
      maxOutputTokens: 262144,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 0.334,
        output: 2.451,
        cacheRead: 0.111,
        cacheWrite: null,
        region: "Singapore International"
      },
      reasoningEfforts: {
        off: null,
        low: "low",
        medium: "medium",
        xhigh: "xhigh"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://www.alibabacloud.com/help/en/model-studio/model-pricing"
      }
    },
    {
      model: "qwen3.8-flash",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 1e6,
      maxOutputTokens: 131072,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 0.16,
        output: 0.47,
        cacheRead: 0.016,
        cacheWrite: 0.2,
        region: "Singapore International"
      },
      reasoningEfforts: {
        off: null,
        high: "high"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://www.alibabacloud.com/help/en/model-studio/model-pricing"
      }
    },
    {
      model: "qwen3.8-omni-flash",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 1e6,
      maxOutputTokens: 131072,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 0.15,
        output: 0.47,
        cacheRead: 0.016,
        cacheWrite: null,
        region: "Singapore International"
      },
      reasoningEfforts: {
        off: null,
        low: "low",
        medium: "medium",
        xhigh: "xhigh"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://www.alibabacloud.com/help/en/model-studio/model-pricing"
      }
    },
    {
      model: "sensenova-6.8-flash-lite",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: 262144,
      maxOutputTokens: 65536,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: null
      },
      reasoningEfforts: {
        off: null,
        low: "low",
        medium: "medium",
        high: "high"
      },
      sources: {
        capabilities: "https://models.dev/api.json",
        pricing: "https://platform.sensenova.ai/docs"
      }
    },
    {
      model: "sensenova-u1.5-lite",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: null,
      maxOutputTokens: null,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: null,
        output: null,
        cacheRead: null,
        cacheWrite: null,
        conditions: "Image generation/editing model; per-token context/output limits and pricing are not applicable."
      },
      reasoningEfforts: {
        off: null
      },
      sources: {
        capabilities: "https://platform.sensenova.ai/docs",
        pricing: "https://www.sensenova.ai/token-plan"
      }
    },
    {
      model: "sensenova-u1.5-fast",
      aliases: [],
      input: [
        "text",
        "image"
      ],
      contextWindow: null,
      maxOutputTokens: null,
      pricing: {
        currency: "USD",
        unit: "per_million_tokens",
        input: null,
        output: null,
        cacheRead: null,
        cacheWrite: null,
        conditions: "Image generation/editing model; per-token context/output limits and pricing are not applicable."
      },
      reasoningEfforts: {
        off: null
      },
      sources: {
        capabilities: "https://platform.sensenova.ai/docs",
        pricing: "https://www.sensenova.ai/token-plan"
      }
    }
  ]
};

// src/model-catalog.ts
var modelCatalog = model_catalog_generated_default;
var MATCH_THRESHOLD = 0.9;
var MINIMUM_MARGIN = 0.08;
function normalizeModelName(value) {
  const pathTail = value.trim().toLowerCase().split("/").at(-1) ?? "";
  return pathTail.replace(/[^a-z0-9]/g, "");
}
function similarity(left, right) {
  if (left === right) return 1;
  if (left.length === 0 || right.length === 0) return 0;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex];
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      previous[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + 1,
        diagonal + cost
      );
      diagonal = above;
    }
  }
  return 1 - previous[right.length] / Math.max(left.length, right.length);
}
function resolveCatalogModel(modelId) {
  if (typeof modelId !== "string") return void 0;
  const normalized = normalizeModelName(modelId);
  if (normalized.length === 0) return void 0;
  for (const model of modelCatalog.models) {
    if ([model.model, ...model.aliases].some((name2) => normalizeModelName(name2) === normalized)) {
      return model;
    }
  }
  const scored = modelCatalog.models.map((model) => ({
    model,
    score: Math.max(...[model.model, ...model.aliases].map((name2) => similarity(normalized, normalizeModelName(name2))))
  })).sort((left, right) => right.score - left.score);
  const [best, runnerUp] = scored;
  if (best === void 0 || best.score < MATCH_THRESHOLD) return void 0;
  if (runnerUp !== void 0 && best.score - runnerUp.score < MINIMUM_MARGIN) return void 0;
  return best.model;
}
function copyEfforts2(efforts) {
  return { ...efforts };
}
function copyInput2(input) {
  return [...input];
}
function resolveModelEfforts(modelId) {
  const model = resolveCatalogModel(modelId);
  return model === void 0 ? void 0 : copyEfforts2(model.reasoningEfforts);
}
function resolveModelInput(modelId) {
  const model = resolveCatalogModel(modelId);
  return model === void 0 ? void 0 : copyInput2(model.input);
}
function resolveModelCapacity(modelId) {
  const model = resolveCatalogModel(modelId);
  if (model === void 0 || model.contextWindow === null || model.maxOutputTokens === null) return void 0;
  return { contextWindow: model.contextWindow, maxTokens: model.maxOutputTokens };
}

// src/routes.ts
function isRecord2(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0 ? value : void 0;
}
function own(record, key) {
  return Object.hasOwn(record, key) ? record[key] : void 0;
}
function capabilityOf(value) {
  if (value === false) return false;
  if (!isRecord2(value)) return void 0;
  try {
    const parsed = resolveConfig({ efforts: value }).efforts;
    return parsed === void 0 ? void 0 : { ...parsed };
  } catch {
    return void 0;
  }
}
function routeCapability(settings, provider, model) {
  if (!Object.hasOwn(settings.models, provider)) return void 0;
  const models = settings.models[provider];
  return models !== void 0 && Object.hasOwn(models, model) ? models[model] : void 0;
}
function routeDefault(settings, provider, model) {
  if (!Object.hasOwn(settings.defaults, provider)) return void 0;
  const models = settings.defaults[provider];
  return models !== void 0 && Object.hasOwn(models, model) ? nonEmptyString(models[model]) : void 0;
}
function rawModelEntry(piAiUser, provider, model) {
  if (!isRecord2(piAiUser)) return void 0;
  const providers = own(piAiUser, "providers");
  if (!isRecord2(providers) || !Object.hasOwn(providers, provider)) return void 0;
  const profile = providers[provider];
  if (!isRecord2(profile)) return void 0;
  const models = own(profile, "models");
  if (!Array.isArray(models)) return void 0;
  return models.find((entry) => isRecord2(entry) && own(entry, "id") === model);
}
function effectiveRouteCapability(settings, piAiUser, provider, model) {
  const explicit = routeCapability(settings, provider, model);
  if (explicit !== void 0) return explicit;
  const entry = rawModelEntry(piAiUser, provider, model);
  if (entry === void 0) return void 0;
  if (Object.hasOwn(entry, "reasoningEfforts")) return capabilityOf(entry.reasoningEfforts);
  const catalog = resolveModelEfforts(model);
  return catalog === void 0 ? void 0 : { ...catalog };
}
function validRouteDefault(settings, piAiUser, provider, model) {
  const effort = routeDefault(settings, provider, model);
  if (effort === void 0) return void 0;
  const capability = effectiveRouteCapability(settings, piAiUser, provider, model);
  return capability !== void 0 && capability !== false && Object.hasOwn(capability, effort) ? effort : void 0;
}
function nestedString(root, provider, model) {
  if (!isRecord2(root) || !Object.hasOwn(root, provider)) return void 0;
  const models = root[provider];
  return isRecord2(models) && Object.hasOwn(models, model) ? nonEmptyString(models[model]) : void 0;
}
function computeLegacyDefaultOps(settings, piAiUser, agentDefaultValue) {
  if (!isRecord2(piAiUser) || !isRecord2(agentDefaultValue)) return [];
  const providers = own(piAiUser, "providers");
  if (!isRecord2(providers)) return [];
  const oldDefaults = own(agentDefaultValue, "reasoningDefaults");
  const currentProvider = nonEmptyString(own(agentDefaultValue, "provider"));
  const currentModel = nonEmptyString(own(agentDefaultValue, "model"));
  const legacyEffort = nonEmptyString(own(agentDefaultValue, "reasoningEffort"));
  const ops = [];
  for (const [provider, profile] of Object.entries(providers)) {
    if (!isRecord2(profile) || !Array.isArray(profile.models)) continue;
    for (const entry of profile.models) {
      if (!isRecord2(entry)) continue;
      const model = nonEmptyString(own(entry, "id"));
      if (model === void 0 || routeDefault(settings, provider, model) !== void 0) continue;
      const old = nestedString(oldDefaults, provider, model);
      const legacy = provider === currentProvider && model === currentModel ? legacyEffort : void 0;
      const effort = old ?? legacy;
      if (effort === void 0) continue;
      const capability = effectiveRouteCapability(settings, piAiUser, provider, model);
      if (capability === void 0 || capability === false || !Object.hasOwn(capability, effort)) continue;
      ops.push({ op: "set", path: ["defaults", provider, model], value: effort });
    }
  }
  return ops;
}

// src/index.ts
var name = "dsh-reasoning-effort";
var inject = ["settings"];
var SETTINGS_NAMESPACE = PLUGIN_SETTINGS_NAMESPACE_ID;
function findDescriptor(descriptors, ns) {
  return descriptors.find((descriptor) => String(descriptor.ns) === ns);
}
function apply(ctx, config) {
  const runtime = resolveRuntimeConfig(config);
  const logger = ctx.logger("dsh-reasoning-effort");
  const ownEntry = ctx.fiber.entry;
  const pluginNs = ownEntry?.options?.id ?? PLUGIN_SETTINGS_NAMESPACE_ID;
  ctx.effect(() => ctx.on("agent/request", async (_payload, next) => {
    const call = await next();
    if (call.reasoningEffort !== void 0 || call.provider === void 0 || call.model === void 0) return call;
    try {
      const descriptors = ctx.settings.describe({ redactSecrets: true });
      const piAi = findDescriptor(descriptors, PI_AI_SETTINGS_NAMESPACE_ID);
      if (piAi === void 0) return call;
      const settings = runtime.settings();
      let effort = validRouteDefault(settings, piAi.user, call.provider, call.model);
      if (effort === void 0 && !settings.legacyDefaultsMigrated) {
        const legacy = findDescriptor(descriptors, AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE_ID)?.value;
        if (legacy !== null && typeof legacy === "object" && !Array.isArray(legacy)) {
          const value = legacy;
          const sameRoute = nonEmptyString(value.provider) === call.provider && nonEmptyString(value.model) === call.model;
          const candidate = sameRoute ? nonEmptyString(value.reasoningEffort) : void 0;
          const capability = effectiveRouteCapability(settings, piAi.user, call.provider, call.model);
          if (candidate !== void 0 && capability !== void 0 && capability !== false && Object.hasOwn(capability, candidate)) effort = candidate;
        }
      }
      return effort === void 0 ? call : { ...call, reasoningEffort: ReasoningEffortId(effort) };
    } catch (error) {
      logger.warn("failed to resolve an exact-route reasoning default");
      logger.warn(error);
      return call;
    }
  }, { global: true, prepend: true }), "dsh-reasoning-effort: request defaults");
  ctx.effect(() => {
    let scheduled = false;
    let disposed = false;
    let running = Promise.resolve();
    const run = async () => {
      if (disposed) return;
      const settings = ctx.settings;
      if (!settings.writable) return;
      let descriptors;
      try {
        descriptors = settings.describe({ redactSecrets: true });
      } catch (error) {
        logger.warn("settings.describe failed");
        logger.warn(error);
        return;
      }
      const descriptor = findDescriptor(descriptors, PI_AI_SETTINGS_NAMESPACE_ID);
      if (descriptor === void 0) return;
      const pluginDescriptor = findDescriptor(descriptors, pluginNs);
      const agentDefault = findDescriptor(descriptors, AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE_ID);
      const current2 = runtime.settings();
      if (pluginDescriptor !== void 0 && agentDefault !== void 0 && !current2.legacyDefaultsMigrated) {
        const migratedDefaults = computeLegacyDefaultOps(current2, descriptor.user, agentDefault.value);
        const migrationOps = [
          ...migratedDefaults,
          { op: "set", path: ["legacyDefaultsMigrated"], value: true }
        ];
        try {
          if (disposed) return;
          await settings.mutate(pluginDescriptor.ns, migrationOps, pluginDescriptor.revision);
          if (disposed) return;
          logger.info("migrated %s exact-route reasoning defaults into plugin settings", migratedDefaults.length);
          schedule();
          return;
        } catch (error) {
          if (error instanceof SettingsConflictError) {
            logger.debug("settings conflict while migrating reasoning defaults; retrying once");
            schedule();
            return;
          }
          logger.warn("failed to migrate exact-route reasoning defaults");
          logger.warn(error);
        }
      }
      const ops = computeEnrichmentOps(descriptor.user, (modelId) => {
        const catalogEfforts = resolveModelEfforts(modelId);
        return catalogEfforts === void 0 ? void 0 : runtime.efforts ?? catalogEfforts;
      }, (providerId, modelId) => {
        return routeCapability(current2, providerId, modelId);
      }, (modelId) => {
        return resolveModelInput(modelId);
      }, (modelId) => {
        return resolveModelCapacity(modelId);
      });
      if (ops.length === 0) return;
      try {
        if (disposed) return;
        await settings.mutate(descriptor.ns, ops, descriptor.revision);
        if (disposed) return;
        logger.info("backfilled model capabilities on %s model entries", ops.length);
      } catch (error) {
        if (error instanceof SettingsConflictError) {
          logger.debug("settings conflict while backfilling; retrying once");
          schedule();
          return;
        }
        logger.warn("failed to backfill model capabilities");
        logger.warn(error);
      }
    };
    const schedule = () => {
      if (disposed || scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (disposed) return;
        running = running.then(run).then(void 0, (error) => {
          if (disposed) return;
          logger.warn("unexpected enrichment failure");
          logger.warn(error);
        });
      });
    };
    const onChange = () => schedule();
    const offDocument = ctx.on("settings/document-updated", onChange);
    const offVolatile = ctx.on("loader/volatile-update", onChange);
    schedule();
    return async () => {
      disposed = true;
      scheduled = false;
      offDocument();
      offVolatile();
      await running;
    };
  }, "dsh-reasoning-effort: reasoning-effort backfill");
}
export {
  Config,
  DEFAULT_EFFORTS,
  REASONING_LEVELS,
  SETTINGS_NAMESPACE,
  apply,
  inject,
  name
};
