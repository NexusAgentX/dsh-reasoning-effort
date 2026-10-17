# 模型能力目录设计

日期：2026-08-15
状态：已确认，待数据落盘与实现

## 目标

在仓库根目录的 `models/` 中按家族维护人工筛选的 TOML 文件，供插件仅根据模型名判断常见模型的输入模态和 `reasoning_effort` 能力。当前目录固定 52 个模型（2026-10 根据 models.dev 同名家族及厂商官方文档新增模型后）。

每个 `models/<family>.toml` 使用 `family` 元数据和 `[[models]]` 数组。构建脚本 `scripts/generate-model-catalog.mjs` 负责解析、校验并生成 `src/model-catalog.generated.json`；运行时只导入生成物，不读取文件系统，因此 Host 与 Client bundle 都能使用同一份数据。

目录不按 provider 匹配。用户的模型名通过规范名、人工别名和高置信度相似匹配查找；低置信度或歧义结果不返回能力，因此不会默认写入模型能力。

## 数据格式

源文件是 `models/<family>.toml`，生成后的运行时对象包含 `version: 1` 与 `models` 数组。每个模型包含以下字段：

- `model`：唯一规范模型名。
- `aliases`：可选的显式别名；`latest` 仅能作为别名，不能增加模型数。
- `input`：模型可接受的输入模态；所有条目都包含 `text`，视觉模型额外包含 `image`。
- `contextWindow` 与 `maxOutputTokens`：正整数；TOML 中省略即生成 `null`。
- `pricing`：官方 API 参考价格，货币固定为 `USD`，单位固定为 `per_million_tokens`；`input`、`output`、`cacheRead` 与 `cacheWrite` 在 TOML 中省略即表示未公开。存在长上下文阶梯、地区或活动范围时，额外记录 `tiers`、`region` 与 `conditions`。
- `reasoningEfforts`：生成后始终包含 `off: null`；TOML 中只写可选的思考档位，且值必须与键一致。其余键只能来自已筛选 `models.dev` 元数据中的 `reasoning_options` 且 `type` 为 `effort`。
- `sources`：分别记录能力数据和官方价格的来源 URL。价格来源不参与模型匹配。

`models.dev` 的 `none` 表示不下发 effort，因此统一转换为本地的 `off: null`，不额外保存 `none`。

## 初始模型范围

- OpenAI：`gpt-5.4`、`gpt-5.5`、`gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna`。
- Claude：`claude-opus-4.6`、`claude-opus-4.7`、`claude-opus-4.8`、`claude-opus-5`、`claude-sonnet-4.6`、`claude-sonnet-5`、`claude-fable-5`。
- DeepSeek：`deepseek-v4-flash`、`deepseek-v4-pro`、`deepseek-v4-flash-vision-exp`。
- Grok：`grok-4.5`、`grok-4.6`。
- Qwen：`qwen3.7-max`、`qwen3.7-plus`、`qwen3.7-flash`、`qwen3.8-max`。
- 其他：`kimi-k3`、`glm-5.3`、`mimo-v2.5`、`mimo-v2.5-pro`、`hy3`。

开源权重 Qwen 变体不收录。`qwen3.8-2.4t-a95b` 的公开权重属性与描述不一致，也不收录。

### 2026-10 家族增补

依据 `models.dev/api.json` 中已有模型家族，补充 2026-09 中旬后发布且已进入模型清单的品牌家族：

- OpenAI：`gpt-6-sol`、`gpt-6-luna`、`gpt-6.1-sol`。
- Claude：`claude-opus-5-5`、`claude-sonnet-5-5`、`claude-haiku-5-5`。
- Gemini、Grok：`gemini-4-argon`、`grok-4.7`。
- Qwen、GLM、MiMo：`qwen3.8-omni-flash`、`glm-5.3-flashx`、`mimo-v2.6-pro`、`mimo-v2.6-flash`、`mimo-v2.6-pro-ultraspeed`。
- 商汤：`sensenova-6.8-flash-lite`、`sensenova-u1.5-lite`、`sensenova-u1.5-fast`。
- MiniMax：`MiniMax-M3`、`MiniMax-M3.1-Flash-Preview`。

只补充可对话且支持文本输出的模型；不新增 Meta、Mistral 等此前目录未覆盖的家族。商汤 U1.5 是官方目录中的图像生成/编辑模型：目录记录其模型 ID、输入模态和来源，但容量按“不适用”留空，推理档位只有 `off`。

## 匹配与写入

匹配顺序为：规范化后的精确模型名、显式别名、满足最低分数且相对第二候选存在明确领先差距的相似模型名。相似匹配不得因为移除 `mini`、`pro`、`thinking` 等语义后缀而命中。

只有命中目录并且原 settings 条目缺失 `reasoningEfforts` 或 `input` 时才写入相应能力。已有映射、`false` 和其他已声明值均保留。未匹配或模糊的模型不自动写入能力。

## 验证

新增目录测试，确保：

- `models` 恰有 52 个规范名唯一的条目，且每项都声明 `input`。
- 每个条目都有 `off: null`，且额外档位是允许的 pi-ai 档位。
- 所有数值限制为正整数或 `null`；所有价格为非负数或 `null`。
- 每项包含有效的能力与价格来源 URL；`pricing.unit` 为 `per_million_tokens`。
- Qwen 条目未包含开源权重型号。

生成器还会校验文件名与 `family` 一致、模型名全局唯一、字段无未知键、URL 为 HTTPS，并支持 `--check` 校验生成物是否过期。README 说明目录用于 model-only 能力匹配，价格仅是官方 API 的参考值，并可能因官方未公开而为空。
