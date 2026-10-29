# 变更记录（CHANGELOG）

> 记录规则：每个版本写清 **目标 / 改动文件 / 设计要点 / 验证方式**。
> 代码版本号跟 `package.json` 的 `version` 对齐；纯文档调整记为 `D` 系列，不占用代码版本号。

---

## D4 — 删库重建，彻底抹掉早期提交里的个人数据（2026-10-29，仓库操作）

**背景**：D2 用 `filter-branch` 重写历史 + `--force-with-lease` 强推后，旧提交 `1c3a076…`
仍能用完整 SHA 直接访问（返回 200）—— GitHub 的悬空对象不会因强推立刻消失。

**做法**

| 步骤 | 说明 |
| --- | --- |
| 删除 | 网页 Settings → Danger Zone。API 删除需要 `delete_repo` 权限，本机 GCM 的 token 只有 `repo` / `gist` / `workflow` 等，`DELETE /repos/...` 返回 403 |
| 重建 | `POST /user/repos` `{"name":"oc--","private":false,"description":"…"}`，写权限足够 |
| 重推 | `git push -u origin main`，4 个提交（`bee29ed` → `cb3bbc6`）一起上，提交对象都在本地，没有丢东西 |

**验证**

| 检查 | 结果 |
| --- | --- |
| 旧提交 `1c3a076…` | `422 No commit found for SHA`（重建前 200） |
| 旧 blob（`characters.db`） | `404` |
| 新 `main` | 200，38 个文件，无 `data/` `images/` |
| 匿名访问 | 200，`visibility: public` |

**结论**：强推只是解绑引用，对象还留在服务端；要真正抹掉痕迹只有**删库重建**。
文档落点：`09-01 §7.4` 补齐「删库重建」小节与上面这张验证表。

---

## D3 — 新增《功能说明书》（2026-10-29，仅文档）

**目标**：此前 23 篇文档全是**面向开发者**的（架构 / 函数 / 修改指引），缺一份**面向使用者**的手册 ——
每个按钮干什么、字段填什么、导入导出会不会覆盖、数据存哪、出问题怎么自救。

**新增**：`docs/00-总览/03-功能说明书.md`（13 节）

| 节 | 内容 |
| --- | --- |
| 1–2 | 一分钟上手；界面地图（工具栏 / 左侧栏 / 详情三块逐项列表） |
| 3 | 角色档案：7 个表单分区、**20 列字段全表**（含中文名与显示位置）、头像与立绘规则、删除的级联后果 |
| 4–5 | 能力 / 武器 / 战斗属性三块的实际输入框与徽章；关系四组、SVG 图、"关系存姓名不存 ID"的代价 |
| 6 | 两种故事的对照表、双向可见（参与的故事 ⇄ 参与角色）、Markdown 与清洗 |
| 7–8 | 搜索与三维筛选的叠加规则；三主题 / 三布局 / 减少动效 / 通透度 |
| 9 | 导出（含 base64 图片）、导入（**追加不去重**）、角色卡、备份建议 |
| 10–12 | 快捷键与关闭方式、数据存放位置、8 条 FAQ |
| 13 | 功能速查表：能做 / 不能做 |

**索引**：`docs/README.md` 的 00 区块加一条并标注"含功能说明书"；根 `README.md` 的文档导航拆成
「会用 → 看说明书 / 改代码 → 看 docs」两条路径，总览行加上入口。

**为什么单独写一份而不是扩充 00-01**：读者不同。开发者要的是契约与修改指引，
使用者要的是"我点这个会发生什么"。混在一篇里两边都会读得累。

---

## D2 — 仓库发布与历史清理（2026-10-29，配置 + 文档）

**目标**：把程序上传到 GitHub（`death1001/oc--`，public），但**只上传程序**，
个人角色数据与立绘必须留在本机。

**做了什么**

| 项 | 内容 |
| --- | --- |
| `.gitignore` | 新增 `data/`、`images/`、`.workbuddy/`、`.tmp_prebuild/`、`.vscode/`、`.idea/`、`desktop.ini`；保留原有日志 / 临时文件规则 |
| 停止跟踪 | `git rm -r --cached data images` —— 工作区文件不动，只从索引移除 |
| 历史清理 | `filter-branch --index-filter` 重写全部 2 个提交，把 `data/` `images/` 从每个提交里擦掉；`--force-with-lease=main:<旧SHA>` 强推；清掉 `refs/original` + reflog + `gc --prune=now` |
| 文档 | `docs/09-构建与运维/01` §7 整节重写为「什么进 Git / .gitignore 全文 / 新机器 clone / 历史清理命令与局限」；`README.md` 两处补充「数据目录不进 Git」 |

**为什么"停止跟踪"不够**

首次提交（2026-08-22）里 `data/characters.db`（237KB）与 4 张立绘（2.5MB）已经在树里。
只提交一次删除，旧提交仍然翻得到 —— 公开仓库里等于永久可查。必须重写历史。

**结果**

- 远端 `main` = `ff6d9be` → `bee29ed`（`Initial commit`），共 37 个文件，无 `data/` `images/`；
- 本地对象库中 `git rev-list --objects --all | grep data/` 为空，旧提交 `cat-file -t` 已查不到。

**强推也挡不住的那部分**（重要）

GitHub 的服务端悬空对象不会立刻回收：`api.github.com/repos/death1001/oc--/commits/1c3a076…`
仍然返回 200。也就是说**能挡住"翻提交历史"，挡不住"拿着旧 SHA 直接访问"**。
要彻底清除只能等 GitHub GC、联系 Support 请求删除，或删库重建。
教训写进 `09-01 §7.4`：`.gitignore` 必须在**第一次提交之前**写好。

---

## v2.0.2 — 立绘铺满画框，消除上下留白（2026-10-29）

**目标**：用户反馈详情页的角色卡「立绘没有自动填充空白处」——画框上下各有一条空白。

**根因**：`.portrait-img` 用的是 `max-width/max-height: 100%` + `object-fit: contain`，
即"按原比例塞进框里，塞不满就留空"。而本工程的立绘**多是横图**
（库内唯一一张 1632×1024，比例 1.59），塞进 300×380（0.789）的画框后
实际只占 300×188 —— 上下各空出 96px，露出占位渐变，看起来像"图没加载全"。

**改动文件**

| 文件 | 改动 |
| --- | --- |
| `styles.css` | `.portrait-img`：`max-width/max-height + contain` → `display:block; width/height:100%; object-fit:cover; object-position:50% 25%` |
| `styles.css` | `.participant-portrait-img`（故事详情 / 阅读弹窗的参与角色小卡）：同样改 `cover` + `50% 25%`，两处观感一致 |
| `package.json` / `index.html` | 版本 `2.0.1` → `2.0.2`（设置面板「关于」同步） |
| `docs/04-角色详情与表单/01` | §3 补「立绘必须铺满框」与 `object-position` 取值理由；修改指引补一条；历史表加 v2.0.2 |

**设计要点**

- **为什么是 `cover` 而不是 `contain` + 模糊衬底**：`cover` 与侧栏卡片（`.char-card-img`）用同一策略，
  共享元素 FLIP 从卡片飞进详情时是"同一张图的同一种裁法在放大"，不会出现
  "卡片里是满的、飞过去变成带黑边的"这种断裂。模糊衬底能保住全景，但会在浅色 UI 上糊成一片色块，
  且要在 DOM 里多挂一层背景图。
- **裁掉多少是明确的**：比例 1.59 的图放进 0.789 的框，`cover` 后横向为 605.6×380，
  保留中间 49.5%（裁掉 305.6px）。这是取舍：详情区的立绘负责"快速认出是谁"，
  不是"看全整张场景"。要看全景走「编辑资料 → 立绘预览」，那里的 `.image-preview img`
  仍是 `contain`（预览的目的是确认选对了文件，不能裁）。
- **`object-position: 50% 25%` 不是随手写的**：`cover` 只在**一个方向**溢出。
  横图按高缩放 → 只有横向溢出，纵向 25% 不参与计算（等于居中）；
  竖图按宽缩放 → 纵向溢出，25% 让取景偏上、优先保住头部，避免 50% 拦腰截断。
- **图片盒子从 300×380 变成 298.7×378.7**：画框有 1px 边框，`width/height:100%` 填的是
  内容区（含 `box-sizing: border-box` 的边框扣除）。属预期。

**验证**（临时钩子 + DevTools 协议，钩子与探针文件已删除）

| 检查项 | 实测 |
| --- | --- |
| 计算样式 | `objectFit: cover`、`objectPosition: 50% 25%`、`display: block` |
| 图片盒子 | 298.7×378.7（画框 300×380 减 1px 边框），与框内区域完全重合 |
| 覆盖计算 | 1632×1024 → 按高缩放为 605.6×380，横向裁 305.6、纵向裁 0 —— **上下零留白** |
| 视觉确认 | DevTools `Page.captureScreenshot` 截图：立绘铺满画框，人物头部完整、取景居中 |
| 参与角色小卡 | 合成同结构卡片实测 78×100 容器内图片 76.7×98.7、`cover / 50% 25%`，flex 布局未被 `width:100%` 撑破 |

> 附带收获：本机 `webContents.capturePage()` 一直返回 0 字节，但
> `webContents.debugger` → `Page.captureScreenshot` 可以正常截到 PNG（约 600KB）。
> 以后再验证 UI 不必只靠读计算样式。

---

## v2.0.1 — 修复滑动背板尺寸漂移（2026-10-29）

**目标**：用户反馈侧栏「故事」标签的选中块（白色圆角背板）有偏移，盖不满标签。

**根因**：背板的宽高与偏移是 `place()` 时**一次性量出来的 px**
（`active.offsetWidth / offsetHeight / offsetLeft / offsetTop`），只有"切换选中项"才会重量。
而宿主尺寸会变的地方有两处没人通知它：

1. **侧栏宽度随布局切换**：`list` 300px ⇄ `grid`/`compact` 352px，带 380ms 过渡；
2. **`#detailTabs` 随窗口宽度变化**。

启动时若保存的是卡片布局，`applyLayout()` 在 DOMContentLoaded 里就把 `.grid-mode` 挂上了，
侧栏从 300 开始向 352 过渡 —— `placePill()` 恰好在这个过渡中间量尺寸，量到的是中间值；
之后过渡结束，背板就永远停在一个"既不是 300 也不是 352"的宽度上。

**实测复现**（切到网格布局后）：

| | 标签宽 | 背板宽 | 差 |
| --- | --- | --- | --- |
| 修复前 | 141.7px | 116px（还停在列表布局的值） | −25.7px |

**改动文件**

| 文件 | 改动 |
| --- | --- |
| `motion.js` | `pill()` 给宿主挂 `ResizeObserver`：尺寸真的变了才 `place({ instant: true, hold: true })`；`place()` 增加 `if (!host.offsetWidth) return;`（宿主不可见时不落位，避免压成 0×0）与 `_lastW` 记录；`hold` 用 220ms 空闲计时器还回过渡 |
| `renderer.js` | `applyLayout()` 在切完 `.grid-mode` 后显式 `placePill('#sideTabs', true)` 兜底 |
| `package.json` / `index.html` | 版本 `2.0.0` → `2.0.1`（设置面板「关于」同步） |
| `docs/11-动效与过渡/01` | §4 补「尺寸漂移陷阱」与 `ResizeObserver` 契约；验收表补一条实测；历史表加 v2.0.1 |
| `docs/03-角色列表与布局/01` | 历史表补 v2.0.1 |

**设计要点**

- **为什么用 `ResizeObserver` 而不是监听 resize 事件**：窗口大小没变，侧栏也会因为切布局而变宽
  （CSS 过渡），`window.resize` 完全收不到。观察宿主自身才是唯一可靠的信号。
- **`instant + hold` 而不是普通落位**：普通落位会用 260ms 缓动去"追"宿主，
  在 380ms 的侧栏过渡里会看到背板明显滞后；`instant` 让它逐帧贴合，`hold` 保证连续变化期间
  不被 `transition` 拖慢，停下 220ms 后再把过渡还给用户点击时的那次滑动。
- **`_lastW` 去重**：`ResizeObserver` 注册瞬间会先回调一次，若不加判断，会把首次落位重放一遍、
  并给背板挂上 `instant`（正好撞上用户刚点标签的那次切换，动画会被吃掉）。
- **`!host.offsetWidth` 保护**：`#segTheme` / `#detailTabs` 在弹窗与详情未打开时是 `display:none`，
  此时 `offsetWidth` 全为 0，落位会把背板压成 0×0 并提前加 `.on`。

**验证**（临时钩子 + `executeJavaScript` 量 `getBoundingClientRect`，钩子已删除）

| 检查项 | 实测 |
| --- | --- |
| 启动（列表布局） | 标签 115.7 / 背板 116.0，`dx=0.0 dy=0.0` |
| 切网格，过渡中 150ms | 侧栏 346.5px 时标签 138.9 / 背板 139.0 —— 逐帧跟随 |
| 切网格，稳定后 | 标签 141.7 / 背板 142.0（`dw=0.3` 为 `offsetWidth` 取整） |
| 切回列表 | 标签 115.7 / 背板 116.0 |
| 详情四标签 / 设置三选 | `dx ≤ 0.4px`、`dy = 0`；切换后无残余 `.instant` 类 |
| 切换动画未受影响 | `.nav-pill` 的 `transition-duration` 仍为 `0.26s×3 + 0.14s` |

> 注：`dw` 稳定在 0.2~0.4px 是 `offsetWidth`（整数）与 `getBoundingClientRect`（小数）的口径差。
> 这里**故意用 `offsetWidth` 而不是 rect**：rect 会被祖先的 `transform` 缩放污染
> （设置弹窗开场的 `scale(.985)` 会让量到的宽度偏小 1.5%），而布局尺寸不受 transform 影响。

---

## v2.0 — 全面重做 UI：引入 DSH-X 设计语言（2026-10-29）

**目标**：完全参照《DSH-X UI 设计规范与可复用示例》重做整个界面 ——
不是换配色，而是换一套**设计语汇**：浅色为主的双主题令牌、4 个控件几何变量、
6 条具名缓动曲线 + 6 个时长档位、滑动背板、快出慢进的面板切换、按钮三层反馈、
弹窗开合状态机、折叠区高度动画、减少动效双闸门。

**改动文件**

| 文件 | 改动 |
| --- | --- |
| `styles.css` | **整文件重写**（1545 → 2135 行）。① 令牌换代：`--bg/-card/-card-sub/-track/-side-bg/-line/-hover-line/-text/-muted/-accent*/-on-accent/-danger*/-ok/-pill-*/-switch-*/-rel-*`；② `:root` 改浅色，暗色移到 `html[data-theme="dark"]`；③ 新增 4 个控件几何变量 + 3 档圆角 + 4 层阴影；④ 新增动效语汇（`--e-*` 6 条曲线 / `--t-*` 6 个档位 / `--mo-*` 别名）；⑤ 新增 `.bg-bloom` 氛围层与 `.app-shell` 浮起外壳（22px 圆角）；⑥ 新增 `.nav-pill` 滑动背板、`.toggle` 开关、`.range` 滑杆、`.fold` 折叠区；⑦ 弹窗改 `data-dialog-size` 三档 + `100dvh`；⑧ 删除全部 `--glass-*` 令牌与玻璃分层规则 |
| `index.html` | **整文件重写**（392 → 543 行）。① 加 `.bg-bloom`、`.app-shell`、`<svg class="icon-sprite">`（19 个 symbol）；② 全部 emoji 图标换 SVG `<use>`；③ 侧栏 / 详情 / 主题三选改「背板宿主」结构；④ 角色表单 7 个分区改 `<details class="fold" open>`；⑤ 5 个弹窗加 `data-dialog-size`；⑥ 设置面板新增「动效 / 减少动效」与「面板通透度」两节；⑦ 移除 `☀🌙🖥` 等 emoji 与 `.seg-ico` |
| `motion.js` | **整文件重写**（327 → 459 行）。① 参数改读新令牌，退 90ms / 进 260ms / 位移 48px；② `swap()` 改水平位移；③ 新增 `pill(host).place()` 与 `placePills()`、resize 防抖重算；④ 新增 `dialog(el, opening)`（中途反向 / `inert` / motion 身份比对）；⑤ `reduced()` 改双闸门并对外暴露；⑥ `flip()` 时长改 `--mo-dur-enter` |
| `renderer.js` | 1578 行。① 新增 `icon()` / `openDialog()` / `closeDialog()` / `isDialogOpen()` / `placePill()`；② 5 个弹窗的显隐全部改走 `Motion.dialog`；③ `selectCharacter` / `renderDetail` / `switchSideView` / `bindTabSwitching` / `openSettings` / `setTheme` 补背板落位；④ 新增 `applyReduceMotion()` / `applyPanelOpacity()` / `loadReduceMotion()` / `loadPanelOpacity()`；⑤ 新增折叠区高度动画拦截；⑥ `toast()` 加回流，修「第一次弹没有过渡」；⑦ 关系图颜色改 `.rel-*` 类走主题变量；⑧ 故事卡按钮、动态行删除键换 SVG |
| `theme-init.js` | 54 → 109 行。扩为四份偏好的唯一解析器：主题 / `clw:reduceMotion` / `clw:panelOpacity`；`Theme` 新增 4 个方法 |
| `main.js` | 窗口 `backgroundColor` 写死 `#171a21` → `shellBg()`（`nativeTheme.shouldUseDarkColors` 取 `#18181b` / `#eef3fd`） |
| `story-editor.html` | 按钮去掉失效的 `.btn-secondary` 类 |
| `package.json` | `1.5.0` → `2.0.0` |
| `docs/08-主题与设置/03-设计语言与交互规范.md` | **新增**：令牌全表、控件几何、曲线与时长表、5 个交互模式、排版层级、反模式清单、修改指引 |
| `docs/08-主题与设置/01、02` | 01 改写为「浅色为主 + 四份偏好 + 闪屏现状」；02 重写为「四个分区 + 控件实现 + 自检」 |
| `docs/11-动效与过渡/01` | 重写：swap / pill / dialog / fold / flip 五套契约 + 验收实测表 |
| 其它区块文档 | 03-01 / 04-01 / 02-01 追加 v2.0 历史；`00-02` 同步行数与分区表；`docs/README.md` 补 08-03 与快速定位 |

**设计要点**

- **先立变量再写组件**。`--control-height/--control-padding/--control-radius/--control-font-size`
  四个变量管住所有横向控件；此前工具栏混着 28/30/32/36 四种高度，逐项对齐永远差 1~2px。
- **暗色把 `--accent` 反转成灰白**，于是 `.btn-primary` 是"白底深字"。为此引入 `--on-accent`，
  全站禁止写 `color: #fff` —— 写死一次，暗色下就是白字白底。
- **选中态只画一层**。背板负责画底衬，`.side-tab.active` / `.tab-btn.active` / `.seg-item.active`
  只改文字色；条目自己再画一层会盖住背板滑过去的瞬间。
- **快出慢进**。退场 90ms 加速离开（别让用户等），入场 260ms 带回弹落定；
  两边同速会显得"一样沉"，像卡了一下。
- **零 `backdrop-filter`**。背景光斑本身已 `blur(70px)`，外壳再采样一次在视觉上几乎无差别，
  代价是每帧全窗口模糊。外壳用 `rgb(255 255 255 / var(--panel-opacity))` 叠在光斑上，
  通透度由设置里的滑杆实时写变量。遮罩同理：它要做 opacity 动画，而祖先 opacity 动画
  会隔断 `backdrop-filter` 采样，模糊会在动画期间消失。
- **一处有意偏离规范**：暗色下 `--danger` 仍保留玫瑰色相 `#ff8fa8`（规范写的是灰白）。
  删除是不可逆操作，让它和普通按钮长得一样是可用性倒退。
- **照片上的文字不进令牌体系**：`.char-card-info`（渐变条 + 白字）与 `.char-card-tag`
  （白底深字）是压在立绘上的叠加层，两种主题下都成立。

**验证**（临时 `did-finish-load` 钩子 + `webContents.executeJavaScript` 读计算样式；
`webContents.debugger` + `CSS.forcePseudoState` 读 `:hover`；钩子与探针脚本已删除）

| 检查项 | 实测结果 |
| --- | --- |
| 浅色令牌 | body `rgb(238,243,253)`、外壳 `rgba(255,255,255,.82)` + 22px 圆角、分隔线 `#d8e2f7` |
| 控件几何 | 按钮 / 搜索 / 下拉全部 `height 36px`、`radius 9px`、`font-size 13px`；下拉 `appearance:none` + 自绘箭头 `10px 6px` |
| 主按钮（浅色） | `bg #3b6fe0` / 字 `#fff` |
| 主按钮（暗色） | `bg rgb(240,240,242)` / 字 `rgb(37,37,43)` —— **反转成立** |
| 滑动背板（侧栏） | `translate3d(3px,3px,0)`、116×28，与 `.side-tab.active` 的 `offsetWidth/Height/Left/Top` 完全一致 |
| 滑动背板（标签页） | 点击第 4 页后 `translate3d(4px→781px,4px,0)`，`transition 0.26s×3 + 0.14s`，`.tab-panel.active` 同步 |
| 背板（设置） | `.seg` 内 `178×32`，切到深色后 `translate3d(184px,4px,0)` |
| 弹窗 | `.modal` 600px / 圆角 18px / `max-height calc(100dvh-48px)`；关闭后 `.hidden=true`、`inert=false` |
| 折叠区 | 397px →（60ms 时 212px，动画中）→ 78px；再点回 397px |
| 卡片 | 圆角 16px、`aspect-ratio 3/4`、悬停 `matrix(1.02,0,0,1.02,0,-2)` |
| 减少动效（应用内） | `html.reduce-motion=true`、按钮 `transition-duration: 1e-05s` |
| 减少动效（关掉后） | `transition-duration: 0.14s, 0.14s, 0.14s, 0.2s, 0.14s` |
| 通透度 | 滑到 60 → 外壳 `rgba(...,0.6)`、提示 `60%`、落盘 `'60'` |
| 图标 | 可见 12 个 `svg.ico`，`getBBox()` 全部非零，0 个损坏 |
| 编辑器窗口 | 外壳 22px / `rgba(39,39,43,.82)`、主按钮白底深字、正文 12px 圆角 |
| 控制台 | 0 条 error / warning |

> 实测陷阱：切主题后立刻读计算样式会读到**过渡中间值**（`.btn` 的背景色有 140ms 过渡），
> 需 `await` 200ms 以上；`CSS.forcePseudoState` 需先 `Emulation.setFocusEmulationEnabled`，
> 且 force 后要等 ≥ 400ms 才是终值。

---

## v1.5 — 全站玻璃质感 UI（2026-10-29）

**目标**：把各类 UI 按钮做成透明玻璃质感，覆盖阵营 / 种族 / 标签筛选下拉、
角色 / 故事侧栏切换，以及它们的下级选择控件（主题三选、布局三选、参与角色胶囊、
详情标签页、弹窗关闭键、展示型标签），深浅两套主题都要成立。

**改动文件**

| 文件 | 改动 |
| --- | --- |
| `styles.css` | ① `:root` / `html[data-theme="light"]` 各新增 17 个 `--glass-*` 令牌 + `--sel-arrow` + `color-scheme`；② 新增「玻璃质感基础层」共享规则（`.btn` / `.side-tab` / `.seg-item` / `.layout-card` / `.participant-option` / `.participant-chip` / `.modal-close` / `.count-badge`）；③ 统一 `:focus-visible` 焦点环；④ `.btn` 改玻璃，`-primary` / `-danger` 换成同形态的语义色玻璃，`-danger-ghost` 悬停才浮出；⑤ `.search` / `.filter` 改玻璃内凹，`select` 用 `appearance:none` + 自绘箭头 + `option` 跟随主题；⑥ `.side-tab` 改单层背景色过渡（原 `::before` 被玻璃底盖住）；⑦ `.tab-btn` 改顶部圆角玻璃片，指示条用 `::after`（`scaleX`+`opacity`）；⑧ `.seg` 改玻璃凹槽、`.seg-item` / `.layout-card` / `.lc-preview` 改玻璃片；⑨ `.chip` / `.chip-tag` / `.kv-row` 做「薄玻璃」（半透明底 + 1px 内高光，不加 `backdrop-filter`）；⑩ 末尾新增「玻璃输入类统一层」覆盖 `form-grid` / `.dyn-input` / `.editor-*`；⑪ reduce 媒体查询补 `.tab-btn::after` / `.layout-card:hover`；⑫ 修 `.rel-link:hover` 的硬编码 `#8fb1ff` |
| `package.json` | 版本 `1.4.0` → `1.5.0` |
| `docs/08-主题与设置/02-设置面板与配色令牌.md` | 新增 8.1 玻璃令牌全表 + 覆盖范围 + 性能取舍表；原 8.1 / 8.2 顺延为 8.2 / 8.3；补玻璃自检片段 |
| `docs/11-动效与过渡/01-侧栏切换与页面转场.md` | 3.1 节改写（`::before` → 单层背景色过渡）与验收表同步 |
| `docs/03-角色列表与布局/01-三种布局与卡片交互.md` | 区块历史补 v1.5 |

**设计要点**

- **纯色背景上 `blur()` 是看不见的**。玻璃由四层叠加成立：顶部反光渐变（`--glass-sheen`）
  → `saturate/brightness` 提亮底层（`--glass-filter`）→ `inset` 上亮下暗边（`--glass-inset`）
  → 外部双层投影（`--glass-shadow`）。只写 `backdrop-filter: blur()` 会得到"什么都没变"。
- **浮起 vs 内凹**：按钮 / 标签页 / 卡片浮起（外投影），输入框 / 下拉 / 凹槽内凹（只有内阴影）。
  两者混用会失去层次。
- **语义色不改形态**：主要 / 危险操作仍是玻璃，只把色相换成 `--glass-accent-*` /
  `--glass-danger-*`，不再是实心色块。
- **动效仍只碰颜色**：所有过渡集中在 `background-color` / `border-color` / `box-shadow` / `color`，
  不引入新的 layout 触发；`.layout-card:hover` 的 `translateY(-1px)` 在 reduce 下关闭。
- **按数量级做性能分级**：`.chip` 可能成片出现 → 不做 `backdrop-filter`；
  `.editor-content` / `.editor-preview` 面积大 → 不做 `backdrop-filter`。
- **修掉一个会被玻璃破坏的老结构**：`.side-tab` 原本用 `::before`（`z-index:-1`）做选中底衬，
  父元素有了不透明玻璃底后伪元素被压在下面，选中色直接不可见。改为直接过渡 `background-color`
  （`background-image` 是常量，过渡依然干净），并同步 `padding` 抵消新增边框。

**验证**（临时钩子 + `webContents.debugger` 的 `CSS.forcePseudoState`，已删除）

| 检查项 | 实测结果 |
| --- | --- |
| 普通按钮（深色） | `bg rgba(255,255,255,.055)`、`blur(12px) saturate(1.5) brightness(1.06)`、外双层投影 + `inset 0 1px 0` |
| 主要按钮 | `bg rgba(91,141,239,.20)`、边框 `rgba(123,166,245,.5)`、文字 `#b9d0ff` |
| 强制 `:hover` | `bg rgba(91,141,239,.32)`、`matches(':hover') === true`、投影加深 |
| 筛选下拉 | `appearance: none`、`background-size: 100% 100%, 10px 6px`、`padding-right: 30px` |
| 侧栏 角色/故事 | 选中 `bg rgba(91,141,239,.2)`、边框与文字同步变色；切故事视图后选中态正确跟随 |
| 详情标签页 | 选中 accent 底 + `::after` `opacity 1` / `matrix(1,0,0,1,0,0)`；未选中为白 `.055` + 内高光 |
| 设置面板 | `.seg` 凹槽 `inset 0 2px 7px`、`.seg-item` 未选中仅内高光、选中浮起 |
| 浅色主题 | 按钮 `bg rgba(255,255,255,.6)`、边框 `rgba(28,40,58,.13)`、文字 `#1e2430`；选中 `rgba(59,111,212,.11)` |
| 主题还原 | 切换测试后 `data-theme` 回到 `dark`，用户偏好未被污染 |
| 布局不抖 | 工具栏高度仍 `54px`，按钮 `32.67×89.75`（与原 32 高一致） |

> Windows 150% 缩放下 `1px` 边框的 computed 值为 `0.666667px`（按设备像素吸附），属正常。

---

## v1.4 — 侧栏切换与页面转场动效（2026-10-29）

**目标**：给「侧栏切换」和「页面转场」加上流畅、克制的显示切换效果；
统一动效参数、可被打断、尊重减少动态效果、不牺牲列表性能。

> 需求文本假设存在 WorkBuddy 的 `.wb-home-header` / `.chat-container` / `--cb-*` 与路由，
> 本工程均不存在（已 grep 确认）。实际映射：侧栏 = `.sidebar`（`.side-tab` 一级、
> `.char-item` / `.story-item` 二级），页面 = `#detail` 与 `#globalStoryDetail` 两个互斥 section，
> 切换方式 = `.hidden { display:none !important }`，无路由。

**改动文件**

| 文件 | 改动 |
| --- | --- |
| `motion.js`（新增，327 行） | 动效控制器：`swap` / `enter` / `flip` / `kill` / `cancelAll` / `isAnimating` / `config`；分组取消与「最后发起者接管」；滚动位置存取；`prefers-reduced-motion` 监听；低端设备判定（`hardwareConcurrency` / `deviceMemory` → `html.mo-lite`） |
| `styles.css` | ① 新增 `:root` 动效令牌（`--mo-dur-micro/fast/base/exit/slow`、`--mo-shift-x/y`、三条 `--mo-ease-*`）；② `html.mo-lite` 降级覆盖；③ `.char-item` / `.story-item` 指示条改 `::before`（`scaleY + opacity`，160ms），`border-left` 仅占位；④ `.side-tab` 底衬改独立图层 `::before` + `isolation: isolate`（`opacity` 过渡）；⑤ `.tab-panel.active` 加 `mo-fade-up`（4px 上移淡入）；⑥ `.sidebar` / `.char-card` 过渡改用令牌；⑦ 新增 `.mo-anim`（临时 `will-change`）、`.mo-flip-clone`、`prefers-reduced-motion` 归零块 |
| `renderer.js` | ① `state` 增 `pane`；② 新增 `Motion` 引用（含空实现兜底）；③ 新增 `imageUrl()` 缓存、`charListFingerprint()`、`syncCharActive()`；④ `renderList()` 指纹命中不重建；⑤ `selectCharacter(id, srcEl)` 改 async 并触发 FLIP；⑥ `renderDetail(id, options)` 支持 `animate:false`，末尾做内容淡入；⑦ 新增 `setDetailPane()`，`renderGlobalStoryDetail` / `showGlobalStoryEmpty` / `showEmptyDetail` / `switchSideView` / `jumpToCharacterById` / `#btnGSBack` 全部改走它；⑧ `switchSideView` 同视图早退 + 侧栏列表 `Motion.swap` |
| `index.html` | `renderer.js` 之前引入 `motion.js` |
| `package.json` | 版本 `1.3.0` → `1.4.0`；`check` 脚本纳入 `motion.js` |
| `docs/11-动效与过渡/01-侧栏切换与页面转场.md`（新增） | 本区块说明书：参数表、契约、集成点、验收、风险 |

**设计要点**

- 只动 `transform` / `opacity`：指示条 `scaleY+opacity`、底衬 `opacity`、面板 `translate+opacity`；
  唯一的例外是侧栏宽度（`width` 过渡，仅「设置里切布局」时触发）。
- 动画状态与业务状态分离：`state` 只记 `view` / `pane` / `layout`，进度全在 `motion.js` 的 `groups`。
- 取消优于排队：每次切换 `cancel` 旧动画、建新 `group`；异步链里比对 `groups.get(key) === group`，
  只有最后一次能提交 DOM，杜绝排队与错位。
- 先取快照再取消：被打断时从当前帧的 `opacity` / `transform` 继续，不闪回基态。
- `.hidden` 是 `display:none !important`，所以「先播退出 → 再提交显隐」；顺带在提交时
  存取子树 `scrollTop`，解决 `display:none` 丢滚动位置的问题。
- 共享元素落点选「立绘框」而非「立绘图」：实测立绘 1632×1024 横图按 `contain` 显示为 319×200，
  与 3:4 卡片（149×200）宽高比不一致，等比缩放只有 1.002、宽度却差 2.14 倍，
  只能靠非等比缩放硬拉导致变形；改以 320×400 的框为落点（等比 2.0），末段 15% 淡出交棒。
- 稳定 key：列表引入「布局 + 顺序 + 展示字段」指纹，切选中项不再重建 DOM，
  配合图片 URL 缓存，消除每次点击的 6 次 IPC 与重复解码。

**验证**（临时钩子 + `executeJavaScript`，已删除）

- `Motion.config` 实测读出 `{fast:160, base:220, exit:170, slow:280, shiftX:6, shiftY:6}`，与令牌一致。
- 退出 50ms 采样 `opacity 0.9135` / `translateX(-0.31px)`，符合 ease-in 起步慢。
- 快速连点 4 次（30–40ms 间隔）：终态 `view=chars` / `pane=detail`，无双面板同时显示，
  无 inline 样式残留，`.mo-anim` 为 0，列表 `scrollTop` 保持 120。
- 转场方向日志：`local +1` → `page +1` → `local -1` → `page -1`（前进 / 返回相反）。
- 稳定 key：打标节点在切换后仍存在，条目数不变。
- FLIP：飞行中副本 1 个、`scale 2.0036`，落位与帧 `dx 10 / dy 4 / dh 0 / dw -21`；
  结束后副本 0、立绘透明度复位。
- 用 `Emulation.setEmulatedMedia` 模拟 `prefers-reduced-motion: reduce`：全部时长为 0、
  标签页动画 `none`、切换在 32ms 内完成、无 `.mo-anim`。

---

## D1 — 工程文档分区重构（2026-10-29，仅文档）

**目标**：把原本集中在根 `README.md`（441 行、十个章节）的说明书，按「工作区块」拆成独立文件，
便于单点查阅、分区块维护、按版本追溯改动。

**改动**

| 文件 | 说明 |
| --- | --- |
| `docs/README.md`（新增） | 文档总索引：区块地图、文档明细、按任务快速定位表、写作规范 |
| `docs/00-总览/`（新增 2 篇） | 项目概览与技术栈、进程架构与代码地图 |
| `docs/01-数据层/`（新增 2 篇） | 数据库表结构、初始化迁移与 CRUD |
| `docs/02-主进程与IPC/`（新增 2 篇） | 窗口生命周期与单实例、IPC 清单与图片管理 |
| `docs/03-角色列表与布局/`（新增 2 篇） | 三种布局与卡片交互、搜索与筛选 |
| `docs/04-角色详情与表单/`（新增 2 篇） | 详情视图与标签页、表单与头像裁剪 |
| `docs/05-关系网络/`（新增 1 篇） | SVG 关系图与跳转 |
| `docs/06-故事体系/`（新增 2 篇） | 双轨故事模型与编辑器、Markdown 渲染与安全 |
| `docs/07-导入导出/`（新增 1 篇） | 导入导出格式与流程 |
| `docs/08-主题与设置/`（新增 2 篇） | 主题系统与防闪色、设置面板与配色令牌 |
| `docs/09-构建与运维/`（新增 2 篇） | 启动脚本与自检、故障排查手册 |
| `docs/10-变更记录/CHANGELOG.md`（本文件） | 版本历史 |
| `README.md`（重写） | 由详细说明书改为项目入口：定位、能力、目录、启动、文档导航 |

**设计要点**

- 每个区块文件固定结构：`适用范围` → `实现细节` → `关键函数/契约` → `修改指引` → `本区块改动历史` → `验证方式`。
- 「改动历史」同时存在于两处：区块文件里记录**该区块**的演变，CHANGELOG 记录**每次发布**的全貌。
- 新增「按任务快速定位」表，把「我想改 X」直接映射到文件，降低检索成本。
- 文档内所有契约值（通道名、变量名、键名、颜色、尺寸）写具体字面值，不写「相关配置」。

**验证**

- `find docs -name "*.md" | wc -l` → 20（1 篇索引 + 18 篇区块文档 + 1 篇本 CHANGELOG）。
- 逐篇核对：函数名、通道名、CSS 选择器、变量值均来自当前代码，未凭记忆书写。
- `README.md` 的链接逐条点击可达。

---

## v1.3 — 紧凑网格 + 卡片质感 + 设置面板 + 主题系统（2026-10-29）

**目标**（用户三点需求）

1. 增加紧凑网格，并把卡片质感做得更好；
2. 增加设置功能与入口按钮，把布局切换收进设置；
3. 增加浅色 / 深色 / 跟随系统的主题切换，同样放进设置。

**改动文件**

| 文件 | 改动 |
| --- | --- |
| `theme-init.js`（新增，54 行） | `<head>` 内同步执行的主题预加载：读 `localStorage['clw:theme']` → 解析 → 写 `data-theme` / `data-theme-pref`；监听系统主题变化（仅 system 时重算）；暴露 `window.Theme = { get, resolve, set, current }` |
| `styles.css` | ① `:root` 扩为完整深色令牌表，新增 `html[data-theme="light"]`；② 15 处硬编码色改变量（滚动条、按钮 hover、toast、遮罩、代码块、chip、badge、裁剪画布）；③ 卡片重做：12px 圆角、`::after` 斜向高光、`--shadow-card`、hover `scale(1.055) translateY(-2px)` + 光晕、封面 `scale(1.07)`、阵营角标；④ 新增 `.char-list.compact` 3 列与紧凑态覆盖；⑤ 新增设置面板样式（`.seg` / `.seg-item` / `.layout-card` / `.lc-preview` / `.about-list`）与 `.btn-icon` |
| `index.html` | ① `<head>` 引入 `theme-init.js`；② 移除侧栏 `#layoutSwitch`；③ 工具栏新增 `⚙ #btnSettings`；④ 新增 `#settingsModal`（主题分段 + 布局选择卡 + 关于） |
| `renderer.js` | ① `LAYOUTS = ['list','grid','compact']`，`loadLayout()` 校验三值；② `applyLayout()` 统一处理 `grid`/`compact` 类、侧栏加宽、设置卡选中态；③ `charCardHtml()` 增加阵营标签；④ `renderList()` 由 `isGrid` 改为 `isCards`；⑤ 新增设置模块 `syncSettingsUI / openSettings / closeSettings / setTheme / setLayout` 与全部事件（Esc、遮罩、恢复默认、系统主题变化刷新提示）；⑥ 启动调 `syncSettingsUI()` |
| `story-editor.html` | 引入 `theme-init.js`，编辑器跟随同一主题 |
| `package.json` | 版本 `1.0.0` → `1.3.0`；`check` 纳入 `theme-init.js` |

**设计要点**

- 主题只切 `<html data-theme>`，颜色全部由 CSS 变量派生，避免两套样式表分叉。
- 防闪色：脚本在 `<link rel="stylesheet">` 之前执行，首帧即正确主题。
- 紧凑不等于缩小：仍保持 3:4，通过 3 列 + 隐藏别名/角标/提示 + 姓名居中实现。
- 设置面板复用现有 `.modal-mask` / `.modal` 体系，不引入新浮层机制。
- 顺带修复：关系图 SVG 写死 `#3a4050` / `#cfd4de`，浅色主题下不可读 → 改 `.graph-center` / `.graph-center-text` / `.graph-label` + 变量。

**验证**（运行时 DOM 探测，钩子用后即删）

| 检查项 | 实测 |
| --- | --- |
| 设置面板 | 打开正常，580px，✕ / 完成 / 遮罩 / Esc 四种关闭均生效 |
| 旧开关移除 | `#layoutSwitch` 不存在 |
| 浅色 | `data-theme=light`，body `rgb(238,241,246)`，文字 `rgb(30,36,48)`，侧栏/工具栏 `#ffffff` |
| 深色 | `data-theme=dark`，body `rgb(23,26,33)`，文字 `rgb(232,234,240)` |
| 跟随系统 | `data-theme-pref=system`，解析为 `dark`，提示「跟随系统（当前深色）」 |
| 紧凑 | 3 列、99.77px/列、卡片 100×133（0.75）、别名与角标隐藏、侧栏 336px |
| 网格 | 2 列、阵营标签「青墨坊」可见、6 张卡片 |
| 持久化 | `clw:theme` = light/dark/system，`clw:charLayout` = list/grid/compact 均正确写入 |
| 悬停 | 卡片 `matrix(1.055,0,0,1.055,0,-2.11)`、`z-index:6`、封面 `matrix(1.07,...)` |

---

## v1.2 — 角色列表网格视图（2026-10-29）

**目标**：左侧角色栏除紧凑列表外，可切换为卡片墙；卡片为竖版长方形，封面用立绘，悬停微放大，点击进详情。

**改动文件**

| 文件 | 改动 |
| --- | --- |
| `index.html` | `sidebar-header` 新增 `.header-right` 与 `#layoutSwitch`（`list` ☰ / `grid` ▦），计数徽标移入 |
| `styles.css` | 新增 `.layout-switch` / `.layout-btn`；`.char-list.grid`（2 列、gap 10、`align-content:start`、padding 12）、`.char-card`（`aspect-ratio: 3/4`）、`.char-card-cover/-img/-fallback/-initial/-hint`、`.char-card-info`（底部渐变）、`.char-card-name/-alias`；`.sidebar.grid-mode` 加宽 336px + 过渡；补 `#charsView, #storiesView { flex:1; min-height:0 }` 修复列表内容超高无法滚动 |
| `renderer.js` | 新增 `LAYOUT_KEY` / `loadLayout()` / `saveLayout()` / `applyLayout()`；`renderList()` 拆出 `charItemHtml()` 与 `charCardHtml()`；卡片模式加载「立绘优先、头像兜底」封面，绑定点击与键盘事件；`switchSideView()` 调 `applyLayout()`；启动读 `state.layout` |
| `main.js` | 仅保留 v1.1 的启动兜底；调试钩子未进入正式代码 |

**设计要点**

- `aspect-ratio: 3/4` 实现「长方形」，侧栏宽度变化时比例不变。
- `scale(1.06)` + `z-index: 6` + `transform-origin: center`；容器 `padding: 12px` 防边缘裁切。
- 激活态用 `inset box-shadow` 描边，与列表模式的左侧色条区分。
- 封面优先级 `portrait_path` → `avatar_path` → 首字占位。

**验证**（无截图环境下的运行时探测）

- 卡片 151×201 = 0.750；网格 2 列、gap 10px；侧栏 336px。
- 6 个角色：有立绘用 `portrait.png`，仅头像用 `avatar.png`，无图显示「首字 + 暂无立绘」。
- 悬停 `matrix(1.06,0,0,1.06,0,0)`、`z-index:6`、描边变强调色。
- 点击第 2 张卡片详情同步切换；`clw:charLayout` 正确写入；故事视图下按钮隐藏、侧栏回 280px。

> 侧栏 `☰ / ▦` 已在 v1.3 迁入设置面板，并新增「紧凑」为第三选项。

---

## v1.1 — 启动故障修复与文档加固（2026-10-29）

**故障**：桌面快捷方式双击无反应。

**根因**：`better-sqlite3` 的 `better_sqlite3.node` 被删 → `db.initDatabase()` 抛错 →
异常发生在 `createWindow()` 之前 → 进程无窗口却存活 → 持有单实例锁 →
后续启动均被判为第二实例并静默退出。

**修复**

| 操作 | 结果 |
| --- | --- |
| 结束 3 个无窗口僵尸进程（PID 21664 / 27004 / 3000） | 单实例锁释放 |
| `npm run rebuild` | 失败（本机无 VS C++ 工具链） |
| 从 npmmirror 下载 `better-sqlite3-v11.10.0-electron-v130-win32-x64.tar.gz` 解包 | 成功，二进制恢复 |
| Electron 运行时验证 | 数据库正常：6 角色 / 18 故事 |
| `main.js` 给 `initDatabase()` 加 try/catch + `dialog.showErrorBox` + `app.quit()` | 杜绝「无窗口占锁」 |
| `README.md` 新增「原生模块丢失应急恢复」+ 2 条 FAQ | — |

**验证**：清空实例后直接用桌面 `.lnk` 启动，窗口正常出现（标题「角色资料查询器」，句柄 396268）。

---

## v1.0 — 初版功能基线

角色档案 CRUD；能力 / 武器 / 战斗属性；关系网络 SVG；双轨故事体系（角色小故事 + 独立故事库）；
参与角色（`story_participants`）；头像圆形裁剪；JSON 导入导出；单角色卡导出；旧库自动迁移。

---

## 版本对照

| 版本 | 主题 | 主要文件 |
| --- | --- | --- |
| v1.0 | 功能基线 | 全部 |
| v1.1 | 启动修复 | `main.js`、`README.md` |
| v1.2 | 网格视图 | `index.html`、`styles.css`、`renderer.js` |
| v1.3 | 紧凑 + 质感 + 设置 + 主题 | `theme-init.js`、`styles.css`、`index.html`、`renderer.js`、`story-editor.html`、`package.json` |
| D1 | 文档分区重构 | `docs/**`、`README.md` |
