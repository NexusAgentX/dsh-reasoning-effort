# 模型能力目录

每个 `<family>.toml` 描述一个模型家族。文件名必须与顶层 `family` 字段一致。

```toml
family = "example"
description = "可选说明"

[[models]]
model = "example-model"
aliases = []
input = ["text", "image"]
contextWindow = 128000
maxOutputTokens = 8192

[models.pricing]
currency = "USD"
unit = "per_million_tokens"
input = 1.0
output = 2.0
# cacheRead / cacheWrite 未公开时省略

[models.reasoningEfforts]
low = "low"
high = "high"

[models.sources]
capabilities = "https://models.dev/api.json"
pricing = "https://example.com/pricing"
```

约定：

- TOML 不支持 `null`，可空字段省略即可；生成器会补成 `null`。
- `reasoningEfforts.off` 不要手写，生成器固定补为 `null`。
- `input` 必须包含 `text`，视觉模型再加 `image`。
- 图像生成/编辑模型可省略 `contextWindow`、`maxOutputTokens` 和价格；空的
  `[models.reasoningEfforts]` 会生成只有 `off` 的档位。
- 修改后运行 `pnpm run generate:models`，并提交生成的
  `src/model-catalog.generated.json`。
- `pnpm run check:models` 可在 CI 中检查生成物是否过期。
