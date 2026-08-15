# dsh-providers-reasoning 设计文档

日期：2026-08-15
状态：已确认（用户批准后进入实现）

## 1. 目标

让第三方 provider 的模型在 web composer 中与原生 DeepSeek 一样出现「推理等级」选择器。具体行为：**凡是出现在 `llm-pi-ai` settings 用户层的模型条目，只要 `reasoningEfforts` 缺失，就自动补齐 7 个推理等级**。

## 2. 根因（源码链）

- `ui-model-selection` 的 `ModelSelect` 只在 `model.reasoning !== undefined` 时渲染 Effort 行。
- `apiproxy.buildModelCatalog()` 只在 `ctx.llm.resolveModelInfo()` 返回 `reasoning` 时把该字段带进目录。
- `llm-pi-ai` 的 `reasoningInfo()` 在模型 descriptor 无 reasoning 元数据时返回空。
- 手工声明路由的模型没有 catalog base，`resolveModelReasoning()` 在 `reasoningEfforts === undefined` 时得出 `reasoning: false`。
- web「添加自定义提供方」与模型列表编辑器刻意不写 `reasoningEfforts`。

因此外部插件唯一被平台允许的修复点是把 `reasoningEfforts` 写进 `llm-pi-ai` 的用户 settings 层。

## 3. 架构

宿主端单插件，无客户端产物：

```
src/config.ts   —— schemastery 配置 schema + 语义校验（默认 7 档）
src/enrich.ts   —— 纯函数：用户层文档 → 需要补的 settings path ops
src/index.ts    —— apply：监听事件，幂等地执行补全
```

依赖注入：`inject = ['settings']`。事件源：`settings/document-updated`、`settings/updated`（按 namespace 过滤），微任务合并；插件行位于 profile patch 层，故首次执行时 `llm-pi-ai` 已注册。

## 4. 关键算法

1. `settings.describe({ redactSecrets: true })` 找到 `llm-pi-ai` descriptor，取其 `user` 与 `revision`。
2. 遍历 `providers.<route>.models[*]` 与 `providers.<route>.modelOverrides.<id>`：
   - `reasoningEfforts === undefined` → 生成 `set` op，值为配置的档位映射副本；
   - 其他任何值（映射、`false`、`null`）→ 跳过。
3. ops 非空时 `settings.mutate(NS, ops, revision)`。
4. `SettingsConflictError` → 排一次重试；其余错误记录日志。只读 settings 或无该 namespace → 静默跳过。
5. 自己的写入触发事件后，下一轮 ops 为空，循环自然终止。

## 5. 默认值

| 档位 | 线级拼写 |
| --- | --- |
| off | null（不下发） |
| minimal | minimal |
| low | low |
| medium | medium |
| high | high |
| xhigh | xhigh |
| max | max |

可通过插件行 `config.efforts` 覆盖；校验规则：仅 `off` 可为空、至少保留一个非 off 档位、键限 pi-ai 七档。

## 6. 边界与错误处理

- 不写组合 base 层；未收窄的整条内置 catalog 不逐模型改写。
- 尊重用户显式声明；插件只补缺失。
- 非法已存值交还上游报错，插件不猜测修复。
- 并发安全：revision 乐观锁 + 冲突重试；事件驱动、无轮询、无循环写。

## 7. 测试

- `enrich.test.ts`：补缺、不覆盖、`false`/`null` 保留、modelOverrides 路径、畸形文档容错、每 op 值对象独立。
- `config.test.ts`：默认 7 档、未知键拒绝、off-only/空映射拒绝、非 off 空拼写拒绝。
- `index.test.ts`（真实 MemorySettings + schemastery）：apply 时补全、后续 settings 更新补全新模型、幂等不二次写、revision 冲突重试、只读与 namespace 未注册时惰性。

## 8. 构建与安装

- 构建：esbuild 生成 `lib/index.js`（ESM，`@deepseek-ai/*` 全部 external）。
- 安装：`dsh plugin --profile web add link:<path>`，并在 `~/.dsh/profiles/web/cordis.patch.yml` 插入 `providers-reasoning` 行。
- 无需重启：dsh web 自带对 profile patch 文件的 HMR；保存 patch 即热加载，插件当场补全已有模型，后续新增模型经 settings 事件实时补全。

## 9. 非目标

- 不实现配置网页卡、不改上游 UI、不复制 `llm-pi-ai` 适配器逻辑、不处理 `llm-deepseek`（自带档位）。
