# dsh-reasoning-effort 设计文档

日期：2026-08-15
状态：已实现

## 1. 目标

为用户在 Harness「模型」页面添加的 `llm-pi-ai` 模型提供两项能力：

1. 管理模型实际提供的 `reasoningEfforts` 及 wire 映射；
2. 按精确 `provider + model` 记忆默认 effort，并在会话没有显式 effort 时应用到真实请求。

本地 `models.json` 只提供保守的基础能力目录。未命中目录的用户模型仍可在页面中手工配置；未命中、低置信度或歧义模型不会被自动补齐。

## 2. 状态所有权

两类状态都由插件 namespace 持有：

- `providers-reasoning.models.<provider>.<model>`：插件拥有的显式能力覆盖，值为 `false` 或 effort -> wire 映射；
- `providers-reasoning.defaults.<provider>.<model>`：插件拥有的精确路由默认 effort。
- `providers-reasoning.legacyDefaultsMigrated`：旧默认值的一次性迁移标记；标记后不再读取旧 map 作为默认事实源。

`llm-pi-ai.providers.*.models[*].reasoningEfforts` 是 Adapter 消费的投影，不是设置页面的事实源。`models.json` 是包内只读基础目录，永不写回。

## 3. Plugin-only 扩展点

实现只使用 Harness `0.1.0-rc.6` 已公开的扩展点，不修改 Harness：

1. Host 通过 `{ global: true, prepend: true }` 的 `agent/request` waterfall 监听器，在下游会话选择完成后读取最终 route；
2. 最终请求已有 effort 时原样保留；缺失时才注入仍在该 route 有效能力 map 中的插件默认值；
3. Client 通过插件自有 Typert Remote 读写设置，不依赖 Web ApiProxy 的静态 Settings allowlist；
4. 不注册或替换 `conversation.input.model`，composer 完全由 Harness 原生组件与选择流程持有。

旧顶层 `agent-default-model.reasoningEffort` 只作为当前顶层 provider/model 的迁移输入。插件启动时把有效旧值及早期实现遗留的 `reasoningDefaults` 与持久化迁移标记原子写入自己的 namespace；标记后不再回读旧字段，设置页只在当前 route 变更时兼容投影顶层字段。

默认值优先级：

```text
同一活动路由的会话显式选择
  > exact provider + model 用户默认值
  > Adapter defaultEffort
  > Provider 默认行为
```

设置页更新 exact-route 默认值，但不静默改写活动会话。Harness 原生 composer 的选择只属于当前会话，不通过插件 Remote 写回 exact route。

## 4. Host 插件

Host 注册插件 namespace，并监听它与 `llm-pi-ai` 的 settings 更新：

1. 遍历 `llm-pi-ai` raw user 层的 `providers.*.models`；
2. exact-route 插件覆盖存在时，显式投影该值；
3. 无覆盖且条目已有任意 `reasoningEfforts` 值时原样保留，包括映射、`false`、`null` 和旧七档；
4. 字段缺失时，仅对本地目录高置信命中的模型补齐目录档位；
5. 使用整数组/整字典 path op 与 revision 乐观锁，冲突后排一次重试；相同值不产生 op，监听循环自然收敛。

Loader `config.efforts` 仍可统一替换目录命中模型的自动补齐值，但不覆盖页面中的 exact-route 显式设置。

## 5. Client 页面

Client bundle 通过 `settings.section` 注册独立页面，数据源为插件 Remote 返回的一次脱敏 Host `settings.describe()` 投影：

- 只枚举 `llm-pi-ai` descriptor 的 raw `user.providers.*.models`；
- 不枚举 composed value、内置 catalog、`modelOverrides` 或 session model directory；
- 同名模型按 provider 分组并保持独立；
- 支持 reasoning 开关、七档复选、非 off wire 值编辑和默认等级选择；
- `off` 与未配置不同：前者是明确选择，后者保留 Provider 默认行为；
- 至少需要一个非 off 等级，默认值必须属于当前可用等级。

页面保留本地草稿。能力和默认值在一次插件 namespace mutation 中写入；当前 route 的顶层兼容投影使用自己的 revision。外部 invalidation 会刷新已加载页面，但不会覆盖正在编辑的草稿。部分写入失败后刷新 revision，重试只提交尚未完成的投影。

## 6. 构建与测试

- `lib/index.js`：Node ESM Host bundle，所有 `@deepseek-ai/*` 保持 external；
- `lib/client.js`：浏览器 CJS closure factory，通过 `window.__ModuleLoader__.load()` 注册；
- `models.json`：随包发布的只读目录。

验证覆盖：目录匹配、自动补齐不覆盖、exact-route 强制覆盖与幂等、namespace 语义校验、只显示用户 models、跨 provider 隔离、默认值 save ops、一次性迁移及清除后不回灌、`off`/失效值、Remote strict descriptor、Client 不接管 composer、Host `agent/request` 注入、类型检查、双端构建和 dry-run 打包。

## 7. 非目标

- 不提供添加/删除模型入口；
- 不编辑 `models.json`；
- 不修改 `llm-deepseek`；
- 不把 request 阶段的隐藏补值冒充为 UI 默认选择；
- 不接管原生 `/model` 命令；该入口仍采用 Adapter 默认 effort；
- 不影响绕过 Agent Loop、直接调用 `ctx.llm` 的请求；
- 不注册、不替换、也不仿制 Harness 原生 composer model/effort seat。
