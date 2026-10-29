# 05-01 · SVG 关系图与跳转

## 1. 适用范围

| 层 | 位置 |
| --- | --- |
| 结构 | `index.html` → `#tab-relations` 内 `#relationGraph` 与 `#relationGroups` |
| 逻辑 | `renderer.js` → `REL_GROUPS` / `renderRelationsTab()` / `relationGraphHtml()` / `jumpToCharacter()` |
| 样式 | `styles.css` → `.relation-svg` / `.graph-node` / `.graph-label` / `.graph-center` / `.graph-center-text` / `.rel-group` / `.rel-item` / `.rel-link` |

---

## 2. 关系数据结构

```js
relationships = {
  family:     [{ name: '艾琳', description: '姐姐' }],
  companions: [{ name: '凯',   description: '并肩作战' }],
  rivals:     [],
  mentors:    []
}
```

四类由 `REL_GROUPS` 统一驱动（顺序即展示与配色顺序）：

| key | label | 颜色 | 语义 |
| --- | --- | --- | --- |
| `family` | 亲属 | `#4caf7d` 绿 | 血缘与家庭 |
| `companions` | 同伴 | `#5b8def` 蓝 | 队友、挚友 |
| `rivals` | 敌对 | `#e06060` 红 | 宿敌、对手 |
| `mentors` | 导师 / 学生 | `#b07ce0` 紫 | 师生关系（双向） |

关系对象**只存姓名字符串**，不是外键——这是为了支持「关系人尚未建档」的场景（写到一半的设定）。

---

## 3. 布局算法

画布固定 `viewBox="0 0 560 400"`，实际显示宽度 100%（`preserveAspectRatio="xMidYMid meet"`）。

```js
const W = 560, H = 400, cx = W/2, cy = H/2;     // 圆心 (280, 200)
const R = Math.min(W, H) / 2 - 64;              // 半径 = 200 - 64 = 136

items.forEach((it, i) => {
  const ang = (i / items.length) * Math.PI * 2 - Math.PI / 2;
  const x = cx + R * Math.cos(ang);
  const y = cy + R * Math.sin(ang);
});
```

要点：

- **均分角度**：`2π / n`，所有关系点等距分布在圆周上；
- **`- π/2` 起点修正**：从正上方开始排（12 点方向），符合「主角在上、关系在下」的直觉，避免第一个节点落在右侧；
- **半径自适应**：`Math.min(W,H)/2 - 64` 给节点（半径 16）与下方文字（+32px）留出空间；
- **不按类型分组排布**：四类混排后按人均匀分布，避免某一类特别多时把图挤成一侧；
- `toFixed(1)` 控制坐标精度，减少 SVG 字符串长度。

> 关系数量为 0 时直接返回 `<div class="empty-inline">暂无关系数据</div>`，不产出空 SVG。
> 数量很多（如 20+）时节点会变密，但没有做分页或聚类——属已知限制。

---

## 4. 图形构成

```
<svg class="relation-svg" viewBox="0 0 560 400">
  <circle class="graph-center" cx=280 cy=200 r=24 />          中心：当前角色
  <text class="graph-center-text">角色名（前 6 字）</text>
  <line stroke=关系色 stroke-width=1.5 opacity=.5 />            每条：圆心 → 节点
  <g class="graph-node" data-name="姓名" transform="translate(x y)">
    <circle r=16 fill=关系色 opacity=.9 />
    <text fill="#fff" font-size=11>姓名前 2 字</text>
  </g>
  <text class="graph-label" x=x y=y+32>完整姓名</text>
</svg>
```

| 元素 | 规格 | 说明 |
| --- | --- | --- |
| 中心圆 | `r=24`，`fill: var(--graph-center)`，`stroke: var(--accent)` | 用 CSS 变量，随主题变化 |
| 中心文字 | 角色名前 6 字，`fill: var(--text)` | 超长名截断，避免溢出圆外 |
| 连线 | 关系色，`width 1.5`，`opacity .5` | 半透明，不抢节点的视觉 |
| 节点圆 | `r=16`，关系色 `opacity .9` | 悬停时 `r` 变 19（CSS `:hover circle { r: 19 }`） |
| 节点文字 | 姓名前 2 字，白色 | 圆形内空间有限，只放缩写 |
| 节点标签 | 完整姓名，`y+32`，`fill: var(--text-dim)` | `pointer-events: none`，不挡点击 |

**主题适配的坑（v1.3 修过）**：早期中心圆 `fill="#3a4050"`、标签 `fill="#cfd4de"` 写死在 SVG 里，
浅色主题下变成「深灰圆块 + 浅灰字」几乎看不见。现在改为 `.graph-center` / `.graph-center-text` /
`.graph-label` 三个类 + CSS 变量。**新增 SVG 元素时不要写死 fill，用类。**

---

## 5. 点击跳转

```js
function jumpToCharacter(name) {
  const n = String(name).trim().toLowerCase();
  const target = state.characters.find(c =>
    String(c.name||'').trim().toLowerCase() === n ||
    String(c.alias||'').trim().toLowerCase() === n);
  if (target) { selectCharacter(target.id); toast('已跳转到「' + target.name + '」'); }
  else toast('未找到名为「' + name + '」的角色', 'warn');
}
```

- **精确匹配**姓名或别名（忽略大小写与首尾空格），不做模糊匹配——
  关系图里出现「凯」而角色叫「凯尔」时应明确提示找不到，而不是跳到不相干的人；
- 命中 → `selectCharacter(id)`，同时列表高亮与详情刷新；
- 未命中 → **warn 级 toast**，不弹错误框（这是可预期的正常情况）。

### 5.1 事件绑定

`renderRelationsTab()` 渲染后，`bindEvents()` 里通过事件委托绑定：

- `.graph-node` 与 `.rel-link` 都带 `data-name`；
- 点击时取 `dataset.name` 调 `jumpToCharacter()`。

使用委托而非逐节点绑定：关系图每次重绘会重建 DOM，委托只需绑一次（若采用逐元素绑定则需在每次渲染后重新绑）。

### 5.2 关系清单

`#relationGroups` 是 2 列网格（`.relation-groups { grid-template-columns: 1fr 1fr }`），
每组一张 `.rel-group` 面板：标题 + 关系项列表。

每项：`<a class="rel-link" data-name="…">姓名</a>` + 可选描述文字。
空组显示「暂无」，保持四组结构稳定，避免布局跳动。

---

## 6. 已知问题

| 问题 | 影响 | 建议 |
| --- | --- | --- |
| `.rel-link:hover { color: #8fb1ff }` 是硬编码色 | 浅色主题下链接悬停偏浅，对比度不足 | 改为 `var(--accent-hover)` 或新增 `--link-hover` 变量 |
| 关系只存姓名字符串 | 角色改名后关系不同步；同名角色会跳错 | 扩展为 `{ character_id, name }` 双写 |
| 节点过多时重叠 | 15+ 关系时圆上文字互相压 | 半径外扩 / 分层双环 / 按类型分扇区 |
| 无连线箭头与关系类型标注 | 只能靠颜色区分 | 在连线中点加 `<text>` 或用 `marker-end` |

---

## 7. 修改指引

| 需求 | 位置 |
| --- | --- |
| 加第五类关系 | ① `REL_GROUPS` 加 `{key,label}`；② `relationGraphHtml()` 的 `groupMeta` 加颜色；③ `index.html` 加 `#xxxRows` 动态行容器；④ `saveCharForm` 的 `relationships` 加字段；⑤ `styles.css` 若需新色加变量 |
| 改配色 | `groupMeta` 里的四个 hex（关系色是语义色，不随主题变，可保留硬编码） |
| 改画布比例 | `relationGraphHtml()` 的 `W/H` 与 `R` 的 `-64` 留白 |
| 改节点大小 | `<circle r="16">` 与 CSS `.graph-node:hover circle { r: 19 }` |
| 让跳转支持模糊匹配 | `jumpToCharacter()` 里先精确、再 `includes` 兜底，并提示「匹配到相似角色」 |

---

## 8. 本区块改动历史

| 版本 | 变更 |
| --- | --- |
| v1.0 | 手写 SVG 径向图；四类四色；节点与清单点击跳转；未命中 warn 提示 |
| v1.3 | **修复浅色主题下关系图不可读**：中心圆与标签从写死 hex 改为 `.graph-center` / `.graph-center-text` / `.graph-label` + CSS 变量；新增 `--graph-center` 变量（深 `#3a4050` / 浅 `#e4e9f2`） |

---

## 9. 验证方式

```js
// 打开有关系数据的角色
document.querySelector('.tab-btn[data-tab="relations"]').click();
const svg = document.querySelector('#relationGraph svg');
console.log('nodes', svg.querySelectorAll('.graph-node').length);
console.log('lines', svg.querySelectorAll('line').length);        // 应与 nodes 相等
console.log('labels', svg.querySelectorAll('.graph-label').length);

// 浅色主题下中心圆颜色
document.documentElement.setAttribute('data-theme','light');
getComputedStyle(document.querySelector('.graph-center')).fill;   // rgb(228, 233, 242)

// 点击跳转
document.querySelector('.graph-node').dispatchEvent(new MouseEvent('click', {bubbles:true}));
// 命中 → 详情标题变化；未命中 → 出现 warn toast
```
