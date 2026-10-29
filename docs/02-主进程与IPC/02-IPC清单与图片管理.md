# 02-02 · IPC 清单与图片管理

## 1. 约定

### 1.1 返回包

所有 handler 统一经 `wrap(fn)` 包装：

```js
function wrap(fn) {
  try { return { ok: true, data: fn() }; }
  catch (err) { console.error('[IPC error]', err); return { ok: false, error: err.message }; }
}
```

- 渲染层判断方式固定为 `if (!r || !r.ok) { toast(r?.error || '失败', 'error'); return; }`
- 需要用户交互（弹文件框）的 handler 自己 `async` + `try/catch`，但**返回结构保持一致**；
  用户取消时返回 `{ ok:false, canceled:true }`，渲染层据此静默跳过，不弹错误。

### 1.2 通道命名

`域:动作`，域为 `characters` / `stories` / `image` / `dialog` / `data`。
新增通道必须同时改 `main.js`（`ipcMain.handle`）与 `preload.js`（`api` 对象），
并同步本文件第 2 节的表格。

---

## 2. 通道清单（21 个）

| # | 通道 | preload 方法 | 入参 | 出参 `data` | 备注 |
| --- | --- | --- | --- | --- | --- |
| 1 | `characters:list` | `listCharacters()` | — | `Character[]` | 按 `updated_at DESC` |
| 2 | `characters:get` | `getCharacter(id)` | `id` | `Character` | |
| 3 | `characters:create` | `createCharacter(data)` | `{...字段, avatarSrc, portraitSrc, avatarCropData}` | `Character` | 先建行拿到 id，再落盘图片，最后回写路径 |
| 4 | `characters:update` | `updateCharacter(data)` | `{id, ...字段, avatarSrc, portraitSrc, avatarCropData, removeAvatar, removePortrait}` | `Character` | 图片处理优先级见 3.2 |
| 5 | `characters:delete` | `deleteCharacter(id)` | `id` | `true` | DB 级联 + `fs.rmSync(images/char_{id})` |
| 6 | `characters:exportCard` | `exportCharacterCard(id)` | `id` | 文件路径 | 弹保存框，`async` |
| 7 | `stories:list` | `listStories(characterId)` | `characterId` | `Story[]`（含 participants） | |
| 8 | `stories:get` | —（未暴露） | `id` | `Story` | 主进程保留，当前无渲染层调用 |
| 9 | `stories:create` | `createStory(data)` | `{character_id,title,content,tags,participantIds}` | `Story` | 成功后广播 `stories:saved` |
| 10 | `stories:update` | `updateStory(data)` | `{id,...}` | `Story` | 同上广播 |
| 11 | `stories:delete` | `deleteStory(id)` | `id` | `true` | 先查出 `character_id` 再删，用于广播参数 |
| 12 | `stories:reorder` | `reorderStories(cid, ids)` | `{characterId, orderedIds}` | `true` | 只改 `sort_order` |
| 13 | `stories:listGlobal` | `listGlobalStories()` | — | `Story[]` | `character_id IS NULL` |
| 14 | `stories:getGlobal` | `getGlobalStory(id)` | `id` | `Story` | 含 participants |
| 15 | `stories:listParticipated` | `listParticipatedStories(cid)` | `characterId` | `Story[]` | 反向查询 |
| 16 | `stories:openEditor` | `openStoryEditor(payload)` | `{mode, characterId, characterName, story}` | `true` | 打开/复用编辑器窗口 |
| 17 | `stories:getEditorPayload` | `getEditorPayload()` | — | payload | 按 `event.sender` 定位窗口取 `_editorPayload` |
| 18 | `dialog:pickImage` | `pickImage()` | — | `string \| null` | 文件框，取消返回 `null` |
| 19 | `image:getUrl` | `getImageUrl(relPath)` | 相对路径 | `file://...?t=mtime` 或 `null` | 文件不存在返回 `null` |
| 20 | `data:export` | `exportData(options)` | `{includeImages}` | 文件路径 | 弹保存框，`async` |
| 21 | `data:import` | `importData()` | — | `{charCount, storyCount}` | 弹打开框，`async` |

### 2.1 主进程 → 渲染进程事件

| 事件 | 载荷 | 触发时机 | 渲染层处理 |
| --- | --- | --- | --- |
| `stories:saved` | `{characterId, isGlobal}` | 故事创建 / 更新 / 删除后 | 主窗口刷新当前详情的小故事 Tab 或故事库列表 |
| `editor:payload` | 同 `openEditor` 的 payload | 编辑器窗口已存在、被复用时 | 编辑器 `fillForm(payload)` 换内容 |

`preload.js` 对应暴露 `onStoriesSaved(cb)` / `onEditorPayload(cb)`，内部是 `ipcRenderer.on`，
**没有提供移除监听的接口**（当前窗口生命周期内只注册一次，够用）。

---

## 3. 图片管理

图片相关逻辑全在 `main.js`，`database.js` 只负责存路径字符串。

### 3.1 目录与命名

```
images/
└── char_{角色ID}/
    ├── avatar.png | .jpg | .webp | .gif     ← 头像（圆形裁剪后的 PNG，或原图）
    └── portrait.png | .jpg | ...            ← 立绘（不裁剪，原图）
```

- 目录名用角色 id，与 `characters.id` 强绑定；删角色即整目录删除。
- 数据库存**相对路径**（`images/char_3/portrait.png`，路径分隔符统一转 `/`），
  避免项目整体搬家后绝对路径失效。

### 3.2 两个落盘函数

| 函数 | 来源 | 用途 |
| --- | --- | --- |
| `saveImageFromSource(id, slot, srcPath)` | 用户选的本地文件 | 复制文件；用于立绘、以及未裁剪的头像 |
| `saveImageFromDataUrl(id, slot, dataUrl)` | 渲染进程 Canvas 输出 | 解码 base64 写文件；用于裁剪后的头像 |

共同约束：

- 允许扩展名 `png / jpg / jpeg / webp / gif`，`.jpeg` 规范化为 `.jpg`，其余一律拒绝（返回 `''`）。
- 写之前先 `clearImageSlot(id, slot)`：删除该目录下所有 `slot.` 开头的文件，
  **避免 `avatar.png` 换成 `avatar.jpg` 后两张图共存**（读图时按路径取，残留文件会占空间且易混淆）。
- 目录不存在则 `mkdirSync(recursive)`。
- 任何异常/非法输入返回空串而不是抛错——图片是可选字段，不该阻断角色保存。

### 3.3 更新时的图片优先级

`characters:update` 依次判断（后者覆盖前者）：

```
removeAvatar   → 清空槽位文件，avatar_path = ''
removePortrait → 清空槽位文件，portrait_path = ''
avatarCropData → 用 dataURL 写 avatar（裁剪结果优先于原图）
avatarSrc      → 用源文件写 avatar
portraitSrc    → 用源文件写 portrait（立绘不裁剪）
```

最终把 `patch` 与表单字段一起传给 `db.updateCharacter()`，**一次 SQL 更新**完成。

### 3.4 缓存规避

```js
let url = pathToFileURL(abs).href;
url += '?t=' + fs.statSync(abs).mtimeMs;
```

Chromium 会按 URL 缓存 `file://` 资源。头像裁剪始终写同名文件（`avatar.png`），
若 URL 不变，界面上会一直显示旧图。附加 `mtimeMs` 后，每次保存图片 URL 都变，强制重新加载。

**注意**：`image:getUrl` 在文件不存在时返回 `null`，调用方需判空
（`renderList()` / 详情页 / 参与角色卡都有判空分支，无图时显示占位）。

---

## 4. 修改指引

| 需求 | 步骤 |
| --- | --- |
| 新增一个 IPC 能力 | ① `main.js` 写 `ipcMain.handle('域:动作', ...)`，用 `wrap()` 包住；② `preload.js` 加同名方法；③ 本文件第 2 节表格补一行 |
| 支持新图片格式 | 改两处 `allowed` 数组 + `saveImageFromDataUrl` 的正则 + `dialog:pickImage` 的 `filters` |
| 修改图片存储位置 | 改 `database.js` 的 `IMAGES_DIR`，同时清理老数据里的相对路径 |
| 让编辑器支持多开 | `stories:openEditor` 与 `createStoryEditorWindow` 一起改（见 [02-01](01-窗口生命周期与单实例.md)） |

---

## 5. 本区块改动历史

| 版本 | 变更 |
| --- | --- |
| v1.0 | 21 个通道建立；`wrap()` 统一返回包；图片双函数（源文件 / dataURL）落盘 |
| v1.0（迭代） | 新增 `stories:reorder`、`stories:listParticipated`、`stories:getGlobal`、`characters:exportCard` |
| v1.1 | `initDatabase()` 失败兜底（handler 注册前），通道本身未变 |
| v1.3 | 通道未变；`image:getUrl` 的 mtime 机制被主题/卡片复用（同一接口多次调用不计成本） |

---

## 6. 验证方式

```bash
# 检查所有 handler 都已注册
grep -c "ipcMain.handle" main.js          # 应为 21

# 检查 preload 与 main 的通道名一一对应
grep -o "ipcRenderer.invoke('[^']*'" preload.js | sort
grep -o "ipcMain.handle('[^']*'" main.js | sort
```

运行时验证（开发者工具 Console）：

```js
await window.api.listCharacters()          // {ok:true, data:[...]}
await window.api.getImageUrl('images/char_3/portrait.png')  // file:///...?t=169...
await window.api.getCharacter(99999)       // {ok:true, data:null}
```
