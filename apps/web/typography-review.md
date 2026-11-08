# Typography 对照与修正

## 测量范围和限制

本轮采用同一系统 Chrome、1440×1000 和 1366×768 两个 CSS viewport、deviceScaleFactor=1，确认 `visualViewport.scale=1`、根节点 `zoom=1`。本机 before/after 的字号、行高、字体族、字重和颜色均通过浏览器 `getComputedStyle` 实测；实际渲染字体通过 CDP `CSS.getPlatformFontsForNode` 核对。

对照目标是 `https://atoms.dev/zh/dashboard`。独立 Playwright 无线上登录态，访问后被重定向到 `https://atoms.dev/zh` 官网，因此其官网排版没有被当作 Dashboard 数据。总管通过已有登录 Chrome 对 Dashboard 做了 100% 缩放目视对照，确认线上导航、卡片正文较本机旧版清晰；但未取得可靠的线上 computed CSS 数值。线上编辑工作区的 message/task 没有访问，不宣称逐项复刻。

因此，本报告区分：**线上 Dashboard 目视参考，本机 before/after 精确测量**。表中不填入推测的线上 14/16px 数值。

## 问题判断

本机主标题原本为 36px，并不是主要问题。大多数操作文本被组件样式覆盖到 8–13px：消息 11px、任务说明 10px、API 状态和时间线详情 8px。较浅的颜色进一步降低了可读性。仅提升根字号或整体 zoom 不能修复这些组件覆盖，还会同时放大不需要调整的标题和布局。

## 实测对比

两个测试 viewport 的以下字号/行高结果一致。单位为 CSS px；`normal` 是旧版浏览器实际 computed 值，不将它虚构为确定行高。

| 内容 | Before 字号 / 行高 / 字重 | After 字号 / 行高 / 字重 | 线上 Dashboard 数值 |
| --- | --- | --- | --- |
| 主标题 | 36 / normal / 600 | 36 / 45 / 600 | 未取得可靠实测 |
| 首页说明正文 | 12 / normal / 400 | 15 / 24 / 400 | 未取得可靠实测 |
| 侧栏当前导航 | 13 / normal / 600 | 14 / 22 / 600 | 仅目视对照 |
| 工作区切换 | 12 / normal / 400 | 14 / 22 / 400 | 未取得可靠实测 |
| 首页需求输入 | 13 / 23.4 / 400 | 16 / 26 / 400 | 仅目视对照 |
| 构建模式选择 | 10 / normal / 400 | 12 / 20 / 400 | 未取得可靠实测 |
| 区块标题 | 16 / normal / 600 | 18 / 27 / 600 | 未取得可靠实测 |
| 助手消息 | 11 / 20.9 / 400 | 14 / 25 / 400 | 未访问线上编辑器 |
| 任务状态标题 | 11 / normal / 500 | 14 / 22 / 600 | 未访问线上编辑器 |
| 任务说明 | 10 / 18 / 400 | 14 / 23 / 400 | 未访问线上编辑器 |
| 耗时元信息 | 9 / normal / 400 | 12 / 19 / 400 | 未访问线上编辑器 |
| API 同步状态 | 8 / normal / 400 | 12 / 19 / 400 | 未访问线上编辑器 |
| 时间线标题 | 9 / 15.3 / 500 | 12 / 20 / 500 | 未访问线上编辑器 |
| 时间线详情 | 8 / 14.4 / 400 | 12 / 20 / 400 | 未访问线上编辑器 |
| 预览/代码/版本页签 | 10 / normal / 400 | 14 / 22 / 400 | 未访问线上编辑器 |
| 工作区修改输入 | 11 / 19.8 / 400 | 14 / 23 / 400 | 未访问线上编辑器 |

## 字体族

旧版声明 `DM Sans, Noto Sans SC, -apple-system, system-ui, Segoe UI, sans-serif`，但没有加载 DM Sans 或 Noto 字体资源。CDP 核对实际中文是 **PingFang SC**（标题 Semibold、正文 Regular），Latin 是 **.SF NS**。

新版明确使用系统字体栈：

```css
-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
'Microsoft YaHei', sans-serif
```

不增加字体 CDN、下载依赖或声称使用未加载的字体。代码区单独使用系统等宽字体栈。After 实际 renderedFonts 随测量 JSON 一起记录；跨平台系统字体外观仍会不同。

## 对比度

Before 下列比值由原有前景/背景颜色计算；After 通过浏览器逐层合成元素背景后计算。均为正常、非禁用状态；不将禁用按钮作为普通正文校验。

| 内容 | Before 约值 | After 实测 |
| --- | --- | --- |
| 首页说明 | 3.58:1 | 6.30:1 |
| 消息正文 | 5.16:1 | 6.37:1 |
| 任务说明 | 3.62:1 | 6.19:1 |
| 成功状态 | 2.77:1 | 5.90:1 |
| API 同步状态 | 3.14:1 | 5.49:1 |
| 时间线详情 | 2.63:1 | 5.24:1 |

普通文本、元信息和输入 placeholder 的目标均为至少 4.5:1。实测断言只覆盖脚本列出的关键选择器，不宣称已进行全站完整无障碍认证。

## 实现方式与布局约束

- 新增 `src/typography.css`，通过组件级字号、行高与颜色 token 覆盖原有微小字号；不使用全局 zoom、transform 或浏览器缩放。
- 主标题保留 36px，显式行高 45px；重要消息/任务文本为 14px，元信息/时间线为 12px。
- 输入区、模式选择、页签、侧栏与按钮使用相应字号和足够行高，控制行允许合理换行。
- 原有工作台分栏、固定输入区和专用内容滚动区域保留。较大字体下，长任务卡/时间线在会话面板内滚动，这是预期行为，不以缩小文字把所有内容强塞入 768px 高度。
- 两个目标尺寸均验证页面无水平溢出、关键控制栏无横向溢出、输入区不超出容器、100% 缩放不变。
- 本轮未修改后端、Agent、共享协议、生成应用 CSS 或模型行为。

## 可复跑验证

只读真实服务审计（只允许 GET 和体验码登录，不创建任务、不调用模型）：

```bash
ATOMS_TYPOGRAPHY_PROJECT=<已有成功项目ID> \
  pnpm --filter @atoms/web test:typography
```

可选环境变量：`ATOMS_WEB_URL`、`ATOMS_DEMO_CODE`、`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`。脚本同时测量两个尺寸，并断言字号、行高、对比度、页面/控制栏边界和缩放。

独立 Mock 布局测试：

```bash
pnpm --filter @atoms/web exec playwright test e2e/typography.spec.ts
```

该测试只启动独立 5181 Mock 服务，不复用正在运行的 5173 真实 DSH 服务。

原始测量：`typography/before-measurements.json`、`typography/after-measurements.json`。Before 文件在样式变更前保存，不会被审计脚本覆盖。截图本地生成于 `review-artifacts/typography/before/` 和 `review-artifacts/typography/after/`，该目录 gitignore；需要共享时单独导出。

测量 JSON 已去除页面文案、助手消息和官网正文；线上访问诊断仅保留请求路径、是否重定向、目标路径及状态。脱敏未重算或修改 Before 的字体、颜色、行高或布局数值，After 文件同样仅保留测量元数据。
