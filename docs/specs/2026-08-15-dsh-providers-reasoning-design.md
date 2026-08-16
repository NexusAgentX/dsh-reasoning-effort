# dsh-reasoning-effort 设计文档

日期：2026-08-15
状态：已实现

## 1. 目标

为用户在 Harness「模型」页面添加的 `llm-pi-ai` 模型提供两项能力：

1. 管理模型实际提供的 `reasoningEfforts` 及 wire 映射；
2. 按精确 `provider + model` 记忆默认 effort，并让 composer 显示值、会话选择和真实请求保持一致。

本地 `model.json` 只提供保守的基础能力目录。未命中目录的用户模型仍可在页面中手工配置；未命中、低置信度或歧义模型不会被自动补齐。

## 2. 状态所有权

两类状态由不同 namespace 持有：

- `providers-reasoning.models.<provider>.<model>`：插件拥有的显式能力覆盖，值为 `false` 或 effort -> wire 映射；
- `agent-default-model.reasoningDefaults.<provider>.<model>`：Harness 拥有的精确路由默认 effort。

`llm-pi-ai.providers.*.models[*].reasoningEfforts` 是 Adapter 消费的投影，不是设置页面的事实源。`model.json` 是包内只读基础目录，永不写回。

## 3. Harness 通用契约

Harness 的 `LlmRuntime` 接受一个通用模型 reasoning 默认值来源。解析精确模型元数据时：

1. 来源返回的 exact-route effort 若仍在 Adapter 公布的 efforts 中，则覆盖 Adapter `defaultEffort`；
2. 来源值失效或模型不支持 reasoning 时忽略，保留 Adapter 默认值；
3. 显式请求 effort 始终优先于所有默认值。

`agent-default-model` 注册该来源。旧顶层 `reasoningEffort` 只作为当前顶层 provider/model 的迁移回退；新写入使用嵌套 `reasoningDefaults`。`saveSelection()` 通过 path mutation 原子更新顶层选择、兼容字段及当前 exact route，保留其他模型的默认值。

默认值优先级：

```text
同一活动路由的会话显式选择
  > exact provider + model 用户默认值
  > Adapter defaultEffort
  > Provider 默认行为
```

设置页更新影响未来模型切换和新会话，不静默改写活动会话。composer 中成功选择 effort 会写回该 exact route，延续 Harness「成功选择成为默认值」的现有语义。

## 4. Host 插件

Host 注册插件 namespace，并监听它与 `llm-pi-ai` 的 settings 更新：

1. 遍历 `llm-pi-ai` raw user 层的 `models` 和 `modelOverrides`；
2. exact-route 插件覆盖存在时，显式投影该值；
3. 无覆盖且条目已有任意 `reasoningEfforts` 值时原样保留，包括映射、`false`、`null` 和旧七档；
4. 字段缺失时，仅对本地目录高置信命中的模型补齐目录档位；
5. 使用整数组/整字典 path op 与 revision 乐观锁，冲突后排一次重试；相同值不产生 op，监听循环自然收敛。

Loader `config.efforts` 仍可统一替换目录命中模型的自动补齐值，但不覆盖页面中的 exact-route 显式设置。

## 5. Client 页面

Client bundle 通过 `settings.section` 注册独立页面，数据源为一次 `settings.describe()`：

- 只枚举 `llm-pi-ai` descriptor 的 raw `user.providers.*.models`；
- 不枚举 composed value、内置 catalog、`modelOverrides` 或 session model directory；
- 同名模型按 provider 分组并保持独立；
- 支持 reasoning 开关、七档复选、非 off wire 值编辑和默认等级选择；
- `off` 与未配置不同：前者是明确选择，后者保留 Provider 默认行为；
- 至少需要一个非 off 等级，默认值必须属于当前可用等级。

页面保留本地草稿。写入分别使用两个 namespace 的 revision；外部 invalidation 会刷新已加载页面，但不会覆盖正在编辑的草稿。任何一侧写入失败都会保留草稿并展示可重试错误。

## 6. 构建与测试

- `lib/index.js`：Node ESM Host bundle，所有 `@deepseek-ai/*` 保持 external；
- `lib/client.js`：浏览器 CJS closure factory，通过 `window.__ModuleLoader__.load()` 注册；
- `model.json`：随包发布的只读目录。

验证覆盖：目录匹配、自动补齐不覆盖、exact-route 强制覆盖与幂等、namespace 语义校验、只显示用户 models、跨 provider 隔离、默认值 save ops、`off`/失效值、Client slot 注册、Host 设置集成、类型检查、双端构建和 dry-run 打包。

## 7. 非目标

- 不提供添加/删除模型入口；
- 不编辑 `model.json`；
- 不修改 `llm-deepseek`；
- 不把 request 阶段的隐藏补值冒充为 UI 默认选择；
- 不在插件中复制 Harness 模型选择器或覆盖 `conversation.input.model`。
