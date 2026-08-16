# 模型能力目录设计

日期：2026-08-15
状态：已确认，待数据落盘与实现

## 目标

在仓库根目录维护一份人工筛选的 `model.json`，供插件仅根据模型名判断是否为常见且支持 `reasoning_effort` 的模型。目录首版固定 23 个模型：5 个 OpenAI、7 个 Claude、2 个 DeepSeek、2 个 Grok 和 7 个 Qwen。

目录不按 provider 匹配。用户的模型名通过规范名、人工别名和高置信度相似匹配查找；低置信度或歧义结果不返回能力，因此不会默认写入思考等级。

## 数据格式

根对象包含 `version: 1` 与 `models` 数组。每个模型包含以下字段：

- `model`：唯一规范模型名。
- `aliases`：可选的显式别名；`latest` 仅能作为别名，不能增加模型数。
- `contextWindow` 与 `maxOutputTokens`：正整数，官方未公开时为 `null`。
- `pricing`：官方 API 参考价格，货币固定为 `USD`，单位固定为 `per_million_tokens`；`input`、`output`、`cacheRead` 与 `cacheWrite` 在官方未公开时为 `null`。存在长上下文阶梯、地区或活动范围时，额外记录 `tiers`、`region` 与 `conditions`。
- `reasoningEfforts`：始终包含 `off: null`；其余键只能来自已筛选 `models.dev` 元数据中的 `reasoning_options` 且 `type` 为 `effort`。
- `sources`：分别记录能力数据和官方价格的来源 URL。价格来源不参与模型匹配。

`models.dev` 的 `none` 表示不下发 effort，因此统一转换为本地的 `off: null`，不额外保存 `none`。

## 初始模型范围

- OpenAI：`gpt-5.4`、`gpt-5.5`、`gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna`。
- Claude：`claude-opus-4.6`、`claude-opus-4.7`、`claude-opus-4.8`、`claude-opus-5`、`claude-sonnet-4.6`、`claude-sonnet-5`、`claude-fable-5`。
- DeepSeek：`deepseek-v4-flash`、`deepseek-v4-pro`。
- Grok：`grok-4.5`、`grok-4.6`。
- Qwen：`qwen3.7-max`、`qwen3.7-max:thinking`、`qwen3.7-plus`、`qwen3.7-plus:thinking`、`qwen3.7-flash`、`qwen3.7-flash:thinking`、`qwen3.8-max:thinking`。

开源权重 Qwen 变体不收录。`qwen3.8-2.4t-a95b` 的公开权重属性与描述不一致，也不收录。

## 匹配与写入

匹配顺序为：规范化后的精确模型名、显式别名、满足最低分数且相对第二候选存在明确领先差距的相似模型名。相似匹配不得因为移除 `mini`、`pro`、`thinking` 等语义后缀而命中。

只有命中目录并且原 settings 条目缺失 `reasoningEfforts` 时才写入相应映射。已有映射、`false` 和其他已声明值均保留。未匹配、模糊、元数据不完整或不支持 `effort` 的模型不写入默认值。

## 验证

新增目录测试，确保：

- `models` 恰有 23 个规范名唯一的条目。
- 每个条目都有 `off: null`，且额外档位是允许的 pi-ai 档位。
- 所有数值限制为正整数或 `null`；所有价格为非负数或 `null`。
- 每项包含有效的能力与价格来源 URL；`pricing.unit` 为 `per_million_tokens`。
- Qwen 条目未包含开源权重型号。

README 将说明目录用于 model-only 能力匹配，价格仅是官方 API 的参考值，并可能因官方未公开而为空。
