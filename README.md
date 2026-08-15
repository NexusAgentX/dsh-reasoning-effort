# dsh-providers-reasoning

宿主端 dsh 插件：给 **所有第三方 provider 模型自动补齐 7 个推理等级**，让 web 输入框右下角的模型选择器对自定义供应商也出现「推理等级」（Effort）行——体验与原生 DeepSeek 一致。

## 问题

`@deepseek-ai/dsh-llm-pi-ai` 只在模型条目声明了 `reasoningEfforts` 时向 composer 上报推理元数据；web 的「添加自定义提供方」卡片刻意不写这个字段，因此第三方模型只能选模型、选不了推理等级。本插件补齐该字段：

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

- **只补缺**：`reasoningEfforts` 完全缺失的模型条目 → 自动写入 7 档；
- **不覆盖**：已有映射、或 `reasoningEfforts: false`（显式声明不推理）→ 原样保留；
- **不碰组合层**：只修改 settings 用户层（web 新建 provider 和 `settings.yaml` 手写的内容都在这一层）；
- **幂等**：补完后不会二次写入；与 web 页面并发编辑通过 settings revision 冲突机制重试；
- **实时**：监听 `settings/document-updated`，新增 provider 后无需重启，composer 立即生效。

配置入口（可选，默认即 7 档）：

```yaml
- id: providers-reasoning
  name: dsh-providers-reasoning
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

## 构建

```bash
pnpm install
pnpm run build   # lib/index.js（宿主端 ESM 单文件）
pnpm test
```

## 安装（本地源码，无需重启正在运行的 dsh web）

```bash
cd /absolute/path/to/dsh-providers-reasoning
pnpm install && pnpm run build

# 1. 先把包链接进 web profile
dsh plugin --profile web add link:$PWD

# 2. 在 $DSH_HOME/profiles/web/cordis.patch.yml（默认 ~/.dsh/profiles/web/cordis.patch.yml）加入：
#
#   - insert:
#       - id: providers-reasoning
#         name: dsh-providers-reasoning
#
# dsh web 自带对该文件的 HMR 监听：保存 patch 后运行中的进程会热加载插件，
# 并立即补全 settings.yaml 里已有第三方模型的 reasoningEfforts。
```

验证：

```bash
dsh --profile web --dump-config   # 确认 providers-reasoning 行已组合
grep -A 8 'reasoningEfforts' ~/.dsh/settings.yaml
```

浏览器中打开 composer 的模型菜单，第三方模型的「推理等级」行即出现。

## 已知边界

- 仅处理 `llm-pi-ai`；原生 `llm-deepseek` 自带档位，不受影响。
- 对「整条内置 catalog 未收窄」的路由不逐模型改写（没有用户层模型条目可写；这类内置模型沿用 pi-ai catalog 自带的推理元数据）。
- 非法值（如 `reasoningEfforts: null` / `{}`）保留原样，交由 `llm-pi-ai` 自身报错，插件不猜测修复。
- 默认拼写=档位名，适用于 OpenAI 兼容方言；使用 DeepSeek `thinking` 等方言的私有网关请按上游文档配置 `compat.thinkingFormat`。

## License

MIT
