# dsh-reasoning-effort

dsh Host + Client 插件：为本地能力目录中已确认支持 `reasoning_effort` 的第三方模型补齐推理等级，提供独立设置页面管理每个精确 `provider + model` 路由的可用等级和默认等级，并在 Composer 中加入鲸鱼娘推理强度滑块。

## 问题

`@deepseek-ai/dsh-llm-pi-ai` 只在模型条目声明了 `reasoningEfforts` 时向 composer 上报推理元数据；web 的「添加自定义提供方」卡片刻意不写这个字段，因此第三方模型只能选模型、选不了推理等级。本插件通过 `model.json` 的本地能力目录，仅对已确认支持 `effort` 的模型补齐该字段：

```yaml
reasoningEfforts:
  off:            # 选中 = 不下发参数
  minimal: minimal
  low: low
  medium: medium
  high: high
  xhigh: xhigh
  max: max
```

## 行为规则

- **按能力补缺**：模型名命中本地目录且 `reasoningEfforts` 缺失 → 写入该模型支持的档位；
- **保守匹配**：模型名先做规范化精确匹配，再做高置信度相似匹配；歧义、低置信度和未收录模型都不写入；
- **不覆盖**：已有映射、或 `reasoningEfforts: false`（显式声明不推理）→ 原样保留；
- **不碰组合层**：只修改 settings 用户层（web 新建 provider 和 `settings.yaml` 手写的内容都在这一层）；
- **幂等**：补完后不会二次写入；与 web 页面并发编辑通过 settings revision 冲突机制重试；
- **实时**：监听 `settings/document-updated`，新增 provider 后无需重启，composer 立即生效。
- **精确路由默认值**：同一个 model ID 位于不同 provider 时分别记忆；默认值只通过插件设置页保存。Harness 原生 composer 的选择属于当前会话，不会被提升为插件默认值。

目录默认包含 23 个常见模型：5 个 OpenAI、7 个 Claude、2 个 DeepSeek、2 个 Grok 和 7 个闭源 Qwen。每项都显式包含 `off: null`；其余档位来自 `models.dev` 的 `reasoning_options[type="effort"]`。

配置入口（可选，仅覆盖已命中模型的目录档位）：

```yaml
- id: providers-reasoning
  name: dsh-reasoning-effort
  config:
    efforts:
      off:
      minimal: minimal
      low: low
      medium: medium
      high: high
      xhigh: xhigh
      max: max
```

## 设置页面

插件的 Client bundle 通过 Harness 的 `settings.section` 注册「思考等级」页面。页面只枚举 `llm-pi-ai` raw user 层的 `providers.*.models`，也就是用户在 Harness「模型」页面添加的模型；内置 catalog、`modelOverrides` 和 `model.json` 不会成为页面条目。

每个模型可以配置：

- 是否支持 reasoning；关闭时写入 `reasoningEfforts: false`；
- 七档可用等级及每档实际下发的 wire 值；`off` 表示明确不下发参数；
- 该精确 `provider + model` 的默认等级，或继续采用 Provider 默认行为。

能力覆盖和精确路由默认等级都存入插件自己的 `providers-reasoning` settings namespace；能力由 Host 投影到 `llm-pi-ai` 模型条目。Client 通过插件自有的 Typert Remote 读写这一 namespace，不要求 Harness 把任意插件设置加入 Web ApiProxy allowlist。旧版 `reasoningDefaults` 和当前路由 `reasoningEffort` 只迁移一次，持久化标记会阻止用户清除默认值后再次导入旧值。

## Composer 滑块

插件以 `priority: -100` 注册 `conversation.input.model`，只替换 Composer 中的模型入口，不接管输入框、发送按钮或其他 Composer 控件。弹层保留按 Provider 分组的模型列表，并为当前模型显示鲸鱼娘推理强度滑块。

- **连续区间**：每个合法档位占据一个等宽区间。滑块拖到哪里就停在哪里，释放后不会吸附到档位中心；提交时只把所在区间映射为一个合法的 `reasoningEffort`，不会向 Provider 发送任意连续数值。
- **会话级选择**：模型切换只提交 `provider + model`，继续采用 Adapter 默认语义；只有操作滑块时才提交 `provider + model + reasoningEffort`。两者都只影响当前会话，不会写入设置页默认值。
- **交互与回滚**：支持指针拖动、方向键及 `Home` / `End`。提交失败时恢复到上一次成功位置，不会留下乐观状态。
- **平滑视觉**：鲸鱼精灵固定为单帧，位置、光晕和轨道平滑过渡；Canvas 辐射保持连续动画。启用 `prefers-reduced-motion` 后会关闭过渡并停止持续 Canvas 重绘，只保留静态画面。

滑块显示及请求优先级为：当前会话显式值 > 设置页保存的精确路由默认值 > Adapter 默认值 > 中间档。主 Agent 请求仍在公开的 `agent/request` waterfall 中补充缺失的 exact-route 默认值；顶层 `agent-default-model.reasoningEffort` 只用于旧配置迁移和当前路由兼容投影，不保存多路由 map。已从模型能力中移除的旧默认值不会下发。

## 构建

```bash
pnpm install
pnpm run build   # Host/Client JavaScript bundles + lib/**/*.d.ts
pnpm run typecheck
pnpm test
```

## 安装（本地源码，无需重启正在运行的 dsh web）

```bash
cd /absolute/path/to/dsh-reasoning-effort
pnpm install && pnpm run build

# 1. 先把包链接进 web profile
dsh plugin --profile web add link:$PWD

# 2. 在 $DSH_HOME/profiles/web/cordis.patch.yml（默认 ~/.dsh/profiles/web/cordis.patch.yml）加入：
#
#   - insert:
#       - id: providers-reasoning
#         name: dsh-reasoning-effort
#
# dsh web 自带对该文件的 HMR 监听：保存 patch 后运行中的进程会热加载插件，
# 并立即补全 settings.yaml 里已有第三方模型的 reasoningEfforts。
```

验证：

```bash
dsh --profile web --dump-config   # 确认 providers-reasoning 行已组合
grep -A 8 'reasoningEfforts' ~/.dsh/settings.yaml
```

浏览器中点击 Composer 的模型入口即可打开鲸鱼娘推理强度滑块和模型列表。将滑块停在同一档位区间的不同位置，释放后应保持原位且显示相同档位；设置面板中同时保留独立的「思考等级」页面。

## 模型目录

根目录的 [`model.json`](./model.json) 是随包发布的人工维护目录。每项包含上下文窗口、最大输出、官方 API 参考价格、可用思考等级及其来源。

- 能力匹配只使用 `model` 和 `aliases`，不依赖用户的 provider 名称；
- 价格只引用模型厂商官方资料，官方未公开的项目为 `null`，不会使用转售商价格；
- `models.dev` 仅用于筛选能力与档位；价格来源不参与匹配；
- `latest` 这类动态名称只能作为 alias，不会增加目录模型数。

## 已知边界

- 仅处理 `llm-pi-ai`；原生 `llm-deepseek` 自带档位，不受影响。
- 完整 Web 路径兼容 Harness `0.1.0-rc.6`，无需修改 Harness。插件只依赖该版本已公开的 Typert Remote、`agent/request` 和 `settings.section` Client slot。
- plugin-only 范围不接管原生 `/model` 命令；通过 `/model` 选中新模型时仍采用 Adapter 默认 effort。该选择会回显到 composer，但不会自动改写为插件 exact-route 默认。
- Headless/TUI 只要走主 Agent Loop 就会经过 `agent/request`；直接调用 `ctx.llm.resolveCallConfig()` 或 `ctx.llm.stream()` 的非 Agent 路径不会应用本插件默认值。
- 页面目前不提供删除 capability override／恢复自动目录的入口；若手工删除 `providers-reasoning` 中的 override，已投影到 `llm-pi-ai` 的旧 map 不会自动判定所有权并回退，请直接在页面保存目标能力。
- 未收录、低置信度或不支持 `effort` 的模型不会被默认设置思考等级。
- 对「整条内置 catalog 未收窄」的路由不逐模型改写（没有用户层模型条目可写；这类内置模型沿用 pi-ai catalog 自带的推理元数据）。
- 非法值（如 `reasoningEfforts: null` / `{}`）保留原样，交由 `llm-pi-ai` 自身报错，插件不猜测修复。
- 默认拼写=档位名，适用于 OpenAI 兼容方言；使用 DeepSeek `thinking` 等方言的私有网关请按上游文档配置 `compat.thinkingFormat`。

## License

MIT。鲸鱼精灵的来源、版本和版权声明见 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。
