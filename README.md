# 角色资料查询器（本地单机桌面软件）

基于 **Electron + SQLite（better-sqlite3）** 的 Windows 本地角色资料管理工具，
支持角色档案的增删改查、独立小故事撰写，以及 JSON 导入导出、关系图可视化、Markdown 故事渲染等扩展功能。

## 功能一览

- **主界面**：顶部工具栏（搜索 / 阵营筛选 / 种族筛选 / 标签筛选 / 新建角色）+ 左侧角色列表（头像 + 姓名）+ 右侧详情页（基础资料 / 能力武装 / 关系网络 / 小故事 四个 Tab）
- **角色详情**：大立绘居中展示 + 右侧「快速印象」信息；四个 Tab 分别展示完整档案、能力与武器卡片、可点击跳转的关系网络（含 SVG 关系图）、关联小故事列表
- **角色管理**：新建 / 编辑弹窗表单（动态行编辑能力、武器、战斗属性、四类关系、元信息），支持上传头像与立绘，删除时确认并连同图片目录、关联故事一起删除
- **小故事**：独立窗口富文本编辑器，支持 Markdown 实时预览、标签、修改与删除，保存后主窗口自动刷新列表
- **搜索筛选**：姓名/别名模糊搜索 + 阵营、种族、标签（从元信息提取）组合筛选
- **加分项**：
  1. JSON 导出 / 导入（含角色图片 base64，可整体迁移）
  2. 关系网络 SVG 可视化（亲属/同伴/敌对/导师学生 四色连线，节点可点击跳转）
  3. 小故事 Markdown 渲染（marked + DOMPurify）
  4. 启动时自动检查并创建 `images/` 目录与 `data/` 数据库目录

## 目录结构

```
.
├── package.json        # 依赖与启动脚本
├── main.js             # 主进程：窗口创建、IPC、图片管理、导入导出
├── database.js         # 数据库封装：建表、增删改查、导入导出
├── preload.js          # 预加载脚本：contextBridge 暴露安全 IPC API
├── index.html          # 主界面结构
├── styles.css          # 全局样式（深色档案风）
├── renderer.js         # 主窗口渲染逻辑
├── markdown.js         # Markdown 渲染工具（marked + DOMPurify 封装）
├── story-editor.html   # 小故事编辑器窗口
├── story-editor.js     # 小故事编辑器逻辑
├── images/             # 角色图片目录（char_{角色ID}/avatar.*、portrait.*），自动创建
└── data/               # SQLite 数据库目录（characters.db），自动创建
```

## 启动步骤

```bash
# 1. 安装依赖（首次）
npm install

# 2.（仅当 better-sqlite3 报 ABI 版本不匹配时执行）
npm run rebuild

# 3. 启动
npm start
```

> 说明：`better-sqlite3` 是原生模块，Electron 的 Node ABI 与系统 Node 不同，
> `@electron/rebuild` 会优先下载对应 Electron 版本的预编译包；若网络环境下载失败，
> 则需要安装 Visual Studio Build Tools（C++ 生成工具）后重新编译。

## 数据与图片存储

- 数据库：`data/characters.db`（SQLite，WAL 模式，外键约束开启）
- 图片：`images/char_{角色ID}/`，每个角色一个子目录，存 `avatar.*`（头像）与 `portrait.*`（立绘）
- 数据库字段中保存的是相对路径；图片不存在时界面自动显示占位符，不会报错

## 常见问题

- **列表为空**：点击右上角「新建角色」建档
- **头像/立绘不显示**：确认 `images/char_{id}/` 下存在对应文件；或重新在编辑弹窗中选择图片保存
- **导入导出**：导出文件含全部角色、故事与（可选）图片；导入为追加模式，不会覆盖已有数据
