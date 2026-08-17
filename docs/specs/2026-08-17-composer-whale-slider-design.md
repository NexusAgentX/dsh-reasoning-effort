# Composer 鲸鱼娘推理滑块设计

## 目标

在 DSH Composer 的 `conversation.input.model` 位置恢复 `temp` 中的模型与推理强度控件，并使用鲸鱼娘八帧精灵作为滑块 thumb。现有“思考等级”设置页继续负责持久化的精确 `provider + model` 能力与默认值。

## 范围

- 注册一个独立的 Composer 模型入口，显示当前模型与当前会话的推理强度。
- 弹层根视图显示鲸鱼娘滑块；模型列表仍按 Provider 分组。
- 档位完全来自当前模型的 `reasoning.efforts`，不硬编码三档。
 - 每个档位占据一个等宽区间，拖动和释放都保持连续位置；提交时按所在区间映射到合法档位并通过 `ModelDirectory.select()` 提交。
- 保留深浅主题、左侧辐射、拖尾、最高档呼吸、拖动加速和 `prefers-reduced-motion` 降级。
- 复用 DSH UI primitives 的图标，并扩展插件自己的 locale，不依赖 DSH 私有的 `model` locale namespace，也不保留 `temp` 中的硬编码中文控件文案。

## 非目标

- 不修改“思考等级”设置页的布局或默认值下拉框。
- 不让 Composer 的选择写入插件持久默认值。
- 不修改 Host、Remote、模型能力目录或 `agent/request` 默认值注入逻辑。
- 不增加设置页开关；插件加载后 Composer 增强默认生效。
- 不恢复 `temp` 的自定义 Provider 档位指引面板。

## 组件与数据流

新增独立的 Composer 模块，避免把会话交互塞入现有设置页模块：

1. `installClient()` 保持现有 Remote 与设置页注册，复用同一个 `ReasoningSettingsController`，并额外取得 `modelDirectories`。
2. 通过 `ctx.slots.inject` 在 `conversation.input.model` 注册 `priority: -100` 的单一 occupant，覆盖原生模型入口但不接管整个 Composer；scope 卸载时由 slot disposer 自动清理。
3. slot 的 `sessionId` 用于取得 `modelDirectories.directoryFor(sessionId)`；不可用或 addressed-subagent 会话仍注入 `available: false`，由组件返回 `null`，并始终遵守 slot 的 `locked` 属性。
4. 组件通过 `useSyncExternalStore` 分别订阅目录和设置 controller 的稳定 snapshot；挂载时非阻塞调用 `controller.load()`，菜单打开时刷新目录，设置加载中或失败立即使用 Adapter 默认值，成功后再刷新精确路由默认值。
5. 模型切换与原生 DSH 保持一致，只提交 `provider + model`，随后按新路由重新计算显示值；滑块提交当前 `provider + model + reasoningEffort`。
6. 成功结果由同一个 `ModelDirectory` 回显；失败保留上一个已确认值并向可访问状态区报告错误。

Composer 的有效显示顺序固定为：当前会话显式值 > 设置页保存的精确路由默认值 > 模型声明的 adapter default > 中间档。通过 `modelRouteKey(provider, model)` 查找精确默认值；设置 controller 尚未 ready 或加载失败时立即回退到 Adapter 默认值，不阻塞 Composer。这样 UI 与 `agent/request` 的实际请求优先级一致；拖动仍只调用 `ModelDirectory.select()`，不会修改设置 controller 或持久默认值。设置 controller 只枚举 raw user 路由，未命中的内置路由自然回退到 adapter default。

## 视觉实现

- 将 `temp/assets/chibi-runner-strip.png` 复制到根仓库资产目录，并由 esbuild 以内联 data URL 打包。该素材由 `temp` 仓库作者 HanaAyane 在提交 `a837e10` 中加入，同仓库以 MIT 发布；根仓库保留相同 MIT 许可。当前只确认仓库整体许可，发布前必须确认用户拥有该 PNG 的再发布权，或补充素材 attribution。
- CSS 保持稳定的滑块高度和端点 inset，确保角色在两端完整可见。
- Canvas 只绘制 thumb 左侧的波纹、像素辐射和粒子；CSS 负责轨道、拖尾、thumb 精灵与主题颜色。
- 动画循环和 DOM observer 必须在 effect cleanup 中释放。
- `prefers-reduced-motion` 下停止 Canvas 循环和精灵逐帧动画，只绘制稳定帧。

## 交互与失败处理

- 使用原生 `input[type="range"]` 保留焦点、键盘和辅助技术语义。
- Pointer 拖动期间只更新本地预览；`pointerup` 才提交，`pointercancel` 回滚。
- 提交前刷新目录并以新档位集合重新校验目标索引，防止模型或能力在拖动期间变化。
- 选择失败时恢复上一个已确认档位；加载失败保留最后一次成功目录，并提供重试入口。
- 模型少于两个档位时不渲染滑块，显示当前模型没有可选推理强度的本地化状态。
- `locked` 时入口和滑块不可交互；不可用会话仍通过 slot 注入 `available: false`，由组件返回 `null`。

## 兼容性与构建

- 增加 `@deepseek-ai/dsh-client-ui-conversation` 与 `@deepseek-ai/dsh-client-ui-model-selection` 的 peer/dev dependency 和 Client inject。
- 将上述浏览器模块加入 closure-factory 的 external allowlist。
- 为 PNG 增加 TypeScript module declaration，并给 esbuild 配置 `.png=dataurl` loader。
- 扩展 `src/client/locales.ts` 的中英文 Composer 文案，并通过现有插件 locale translator 注入组件。
- 保持 DSH `0.1.0-rc.6` API：`conversation.input.model`、`modelDirectories`、`ModelDirectory.select()`。

## 验证

- 单元测试：精确路由默认值优先级、会话显式值优先级、失败回滚、不可用会话、slot 注册/卸载，以及会话 effort 提交不触碰持久默认值。
- 注册测试从一个设置页 entry 更新为“设置页 + Composer”两个 entry，并验证 `priority: -100` 和 teardown。
- 覆盖设置 controller 未 ready/加载失败时的 Adapter 默认值回退。
- 静态验证：`pnpm run typecheck`、`pnpm test`、`pnpm run build`。
- 浏览器验证：深色与浅色、桌面与窄屏、拖动/点击/键盘、模型切换、失败回滚、减少动态效果；用截图和 Canvas 像素检查确认非空渲染、角色两端不裁切且控件不与 Composer 其他元素重叠。
