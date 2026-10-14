# 星核脉冲爱心 · Cosmic Pulse Heart

一个全屏 WebGL 粒子艺术体验：多层粒子组成三维爱心，以双峰心跳驱动表面能量传播，并支持蓄能、结构化爆发、悬浮、旋涡回归与弹性复位。

## 核心能力

- GPU 双缓冲粒子模拟：位置与速度通过 `GPUComputationRenderer` 在显卡端更新。
- 多层结构：表面壳层、体积层、星核层、能量流、火花与轨道粒子。
- 双脉冲节奏：不是简单整体缩放，而是带传播延迟的两段峰值包络。
- 完整爆发链路：蓄能、裂解、法线/切向爆发、悬浮、旋涡回归、越界与稳定。
- 三档画质与自动降级：Ultra、Balanced、Performance。
- 完整输入：鼠标、触控、键盘、全屏、暂停与可选程序化音效。
- 安全降级：WebGL2 不可用、上下文丢失或减少动态模式下仍有完整静态视觉。
- 无障碍：键盘等价操作、可见焦点、语义控件、`prefers-reduced-motion` 与 44px 触控目标。

## 本地运行

需要 Node.js 22.13.0 或更高版本。

```bash
npm install
npm run dev
```

开发服务器会显示实际本地地址；端口 3000 被占用时通常自动切换到 3001。

## 操作方式

| 操作 | 效果 |
|---|---|
| 单击/轻触爱心 | 触发增强双脉冲 |
| 按住约 180ms | 进入蓄能 |
| 松开 | 按蓄能强度触发结构化爆发 |
| 移动指针 | 产生轻微排斥与旋涡扰动 |
| Enter / Space | 键盘触发或蓄能 |
| 右下角控制按钮 | 调整画质、辉光、心率、运镜、音效、减少动态、暂停与全屏 |

音效默认关闭，只有用户明确开启并完成手势交互后才会创建 Web Audio 节点。

## 架构

| 模块 | 职责 |
|---|---|
| `app/experience/core` | 状态机、心跳包络、画质策略、确定性随机数与共享类型 |
| `app/experience/engine` | Three.js 场景、GPGPU 计算、GLSL、粒子采样、后期与资源生命周期 |
| `app/experience/audio` | 程序化双心音与浏览器音频解锁 |
| `app/experience/ui` | 体验说明、状态提示与无障碍控制面板 |
| `CosmicHeartExperience.tsx` | React 与渲染引擎之间的输入、设置、生命周期和降级适配 |

粒子纹理通道：

- Position：`xyz` 为当前位置，`w` 为激活度。
- Velocity：`xyz` 为速度，`w` 为能量。
- Home：`xyz` 为目标点，`w` 为粒子分组。
- Normal / Meta / Spawn：分别保存法线与深度、随机属性、初始星尘位置与出现延迟。

状态机主链路：

```text
PREWARM → ASSEMBLE → AWAKEN → IDLE_BEAT
CHARGE → FRACTURE → BURST → SUSPEND
→ VORTEX_RETURN → OVERSHOOT → SETTLE → IDLE_BEAT
```

## 画质与视觉安全

- Performance：128×128 计算纹理，约 1.6 万主体粒子。
- Balanced：224×224，约 5 万主体粒子。
- Ultra：384×384，约 14.7 万主体粒子。
- DPR 有档位上限；运行时控制器按帧率与 P95 帧时间逐级降档。
- 默认曝光为 0.72，辉光采用受控强度与较高阈值，避免爱心被抬成纯白。
- 主色为深红、玫红、莓粉与暖金；高能量只加入少量粉色高光。
- 页面进入后台后暂停 RAF 与模拟，恢复时重置时间基准。

## 可访问性与降级

- 系统或手动启用减少动态后，会跳过聚合、爆发、旋涡回归和自动运镜。
- Canvas 为装饰层并带有正文等价描述；“触发脉冲”按钮提供键盘等价操作。
- WebGL2 初始化失败时显示 CSS 粒子爱心，不会留下空白页面。
- WebGL 上下文丢失时停止提交并提示恢复；恢复失败会回到静态模式。
- 所有用户设置保存在浏览器本地，不依赖账户。

## 项目命令

| 命令 | 用途 |
|---|---|
| `npm run dev` | 启动开发服务器与热更新 |
| `npm run build` | 生成 vinext / Cloudflare 生产构建 |
| `npm run preview` | 启动已构建的生产服务 |
| `npm run typecheck` | 严格 TypeScript 检查 |
| `npm run lint` | ESLint 与 React/无障碍规则检查 |
| `npm test` | 完整类型、Lint、构建与测试门禁 |
| `npm run test:e2e` | 生产 Worker 服务端渲染与元数据集成测试 |
| `npm run test:visual` | 调色、曝光、Bloom、Shader 与社交图视觉契约测试 |

## 测试与验收

生产测试会验证：

- 页面、标题、描述、绝对 Open Graph URL 与社交图。
- 无脚手架占位内容或 `react-loading-skeleton` 依赖。
- Shader 模板字符串无转义损坏，且不使用 GLSL 保留字。
- 玫红调色、曝光、Bloom 上限和默认辉光参数不回退到过曝值。
- 社交分享图为 1731×909 的有效 PNG。

浏览器运行验收还应覆盖点击、长按释放、指针取消、暂停、全屏、画质切换、减少动态和 WebGL 上下文恢复。

## 浏览器支持

完整路径需要 WebGL2 与可渲染浮点纹理。目标范围为当前受支持的 Chrome、Edge、Firefox、Safari 最近两个稳定主版本，以及近两个主要版本的 iOS/iPadOS Safari。较旧 WebView 会自动使用 Performance 或静态模式。

## 常见问题

### 页面仍显示旧的 Vite 编译错误

停止并重新执行 `npm run dev`，再刷新页面。开发依赖发生变化后，旧的优化缓存可能继续引用已经移除的模块。

### 爱心过亮

在控制面板降低“辉光”。默认已使用 0.72 曝光和受控 Bloom；若浏览器保留了旧设置，可把辉光调回 0.7。

### 页面进入静态模式

确认浏览器启用了硬件加速且支持 WebGL2。静态模式会在页面状态区域给出原因，不影响正文和控制说明。

### 移动设备发热或掉帧

选择 Performance，关闭自动运镜与音效，并保持系统的减少动态设置。自动画质模式也会在持续低帧率时降档。

## 主要依赖

- React 19
- Three.js 0.185.1
- vinext 1.0.0-beta.2
- Vite 8
- Cloudflare Workers / Sites 运行时

社交分享图位于 `public/og-card.png`，页面元数据会根据当前请求 Host 生成绝对 URL。
