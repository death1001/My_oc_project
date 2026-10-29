# 01-02 · 初始化、迁移与 CRUD

## 1. 启动初始化链

```
main.js → app.whenReady()
        → db.initDatabase()          ← 有 try/catch，失败弹错误框并 quit
            ├── ensureDirs()         创建 data/ 与 images/
            ├── new Database(DB_PATH)
            ├── pragma WAL / foreign_keys ON
            ├── db.exec(CREATE_SQL)  建表 + 索引（IF NOT EXISTS）
            ├── migrateStoriesNullable()
            └── migrateStoriesSortOrder()
        → registerIpc()
        → createWindow()
```

`getDb()` 是**懒加载兜底**：任何导出函数在未初始化时被调用，会自行 `initDatabase()`。
正常运行路径下数据库已就绪，`getDb()` 只是取缓存引用。

---

## 2. 两个幂等迁移

迁移函数的共同点：**先探测结构，已是最新则直接 return**，因此每次启动都可以无脑调用。

### 2.1 `migrateStoriesNullable()`

- **解决问题**：早期 `stories.character_id` 是 `NOT NULL`，无法表达「独立故事」。
- **探测**：`PRAGMA table_info(stories)`，若 `character_id.notnull !== 1` 说明已可空，跳过。
- **做法**：因 SQLite 不支持 `ALTER COLUMN`，采用「重建表」经典流程：
  `foreign_keys OFF` → `BEGIN` → 建 `stories_new`（可空外键）→ `INSERT ... SELECT` 复制全部行
  → `DROP TABLE stories` → `RENAME` → 重建索引 → `COMMIT`。
- **失败处理**：catch 内 `ROLLBACK` 并重新抛错，由 `initDatabase()` 的调用方（main.js）兜底弹框。
- **收尾**：`finally` 中恢复 `foreign_keys ON`。
- **注意**：该迁移会把新表建成**不含 `sort_order`** 的结构，所以必须紧接着执行第二个迁移补列——
  顺序不可颠倒。

### 2.2 `migrateStoriesSortOrder()`

- **解决问题**：时间线排序需要 `sort_order`。
- **探测**：`PRAGMA table_info(stories)` 是否已存在 `sort_order`。
- **做法**：`ALTER TABLE stories ADD COLUMN sort_order INTEGER DEFAULT 0`（SQLite 支持追加列）。
- **老数据**：全部得到 0，列表按 `sort_order ASC, id ASC` 排序，等价于按创建顺序展示。

---

## 3. 序列化

| 函数 | 方向 | 行为 |
| --- | --- | --- |
| `serializeChar(data)` | 对象 → 行 | 5 个 JSON 字段若不是字符串则 `JSON.stringify`；`age` 为 `''`/`null` 时存 `null`；其余原样 |
| `rowToCharacter(row)` | 行 → 对象 | 5 个 JSON 字段 `parseJSON`；`relationships` 用 `Object.assign` 补齐四个空数组，**保证缺字段时结构完整** |
| `parseJSON(str, fallback)` | — | 解析失败不抛错，返回 fallback |
| `nowStr()` | — | `new Date().toISOString().slice(0,19).replace('T',' ')`，即 UTC 时间字符串 |

> `nowStr()` 用的是 **UTC**（`toISOString`），而建表默认值是 `datetime('now','localtime')`（本地时间）。
> 新数据由代码写入 UTC、老数据或默认值写入本地时间，跨时区比较排序时需留意这个不一致（已知瑕疵，尚未统一）。

---

## 4. 角色 CRUD

| 函数 | 签名 | 行为要点 |
| --- | --- | --- |
| `listCharacters()` | → `Character[]` | `ORDER BY updated_at DESC, id DESC`，全部反序列化 |
| `getCharacter(id)` | → `Character \| null` | 单行查询 |
| `createCharacter(data)` | → `Character` | 先套默认值再 `serializeChar`；`created_at` / `updated_at` 同时写入；返回新记录 |
| `updateCharacter(id, data)` | → `Character` | 只更新 `CHAR_FIELDS` 里出现的键（动态拼 SET）；自动刷新 `updated_at`；无有效字段时直接返回原记录 |
| `deleteCharacter(id)` | → `void` | 仅删 `characters` 行，小故事与参与关系靠外键级联；**图片目录由 `main.js` 负责删除** |

`createCharacter` 的默认值：`abilities: []`、`weapons: []`、`combat_stats: {}`、
`relationships: {family:[],companions:[],rivals:[],mentors:[]}`、`metadata: {}`、两个图片路径 `''`。

---

## 5. 故事 CRUD

| 函数 | 签名 | 行为要点 |
| --- | --- | --- |
| `listStories(characterId)` | → `Story[]` | 按 `sort_order ASC, id ASC`；每条附 `participants` 数组 |
| `getStory(id)` | → `Story \| null` | 裸行，不含参与者 |
| `getStoryWithParticipants(id)` | → `Story \| null` | `getStory` + `participants` |
| `createStory({character_id,title,content,tags,participantIds})` | → `Story` | 角色小故事取 `MAX(sort_order)+1` 追加到末尾；独立故事 `sort_order = 0`；有参与者则写入关联表 |
| `updateStory(id, data)` | → `Story` | 只更新 `title/content/tags`；**`participantIds` 存在时整体覆盖**参与关系 |
| `deleteStory(id)` | → `void` | 参与关系级联删除 |
| `setStoryOrder(characterId, orderedIds)` | → `void` | 按数组下标写 `sort_order`（0,1,2…），`WHERE` 带 `character_id` 防误改他人故事 |
| `listGlobalStories()` | → `Story[]` | `character_id IS NULL`，按更新时间倒序 |
| `listParticipatedStories(characterId)` | → `Story[]` | JOIN 关联表反查该角色参与的独立故事 |

### 参与角色

- `getStoryParticipants(storyId)` → `[{id, name, alias, avatar_path, portrait_path}]`，按姓名排序，
  只取渲染所需的最小字段（参与角色卡要显示立绘）。
- `setStoryParticipants(storyId, ids)` 为**覆盖式**：先 `DELETE` 全部再逐条 `INSERT OR IGNORE`，
  自动忽略非法 id（`<= 0` / 非数字）。

---

## 6. 事务使用

只有 `importAll()` 显式使用 `db.transaction()`（见 [07-导入导出](../07-导入导出/01-导入导出格式与流程.md)）。
其余写操作都是单条语句，靠 SQLite 语句级原子性即可，不需要额外事务。

---

## 7. 修改指引

| 需求 | 步骤 |
| --- | --- |
| 新增角色字段 | ① `CREATE_SQL` 加列；② `CHAR_FIELDS` 加名字；③ `createCharacter` 默认值；④ `rowToCharacter` 若为 JSON 则解析；⑤ 写一条 `ALTER TABLE` 迁移函数并在 `initDatabase()` 调用；⑥ 渲染层表单与详情 |
| 新增故事字段 | 改 `CREATE_SQL` + `migrateXxx` + `createStory` / `updateStory` 的字段列表 |
| 调整排序规则 | `listStories` / `listGlobalStories` 的 `ORDER BY`；`setStoryOrder` 的下标写法 |
| 删除角色时也清图片 | 不要在 `database.js` 里做（数据层不碰 `fs.rmSync`），在 `main.js` 的 `characters:delete` handler 内 |

---

## 8. 本区块改动历史

| 版本 | 变更 |
| --- | --- |
| v1.0 | 建立 `initDatabase` / CRUD / 序列化基线 |
| v1.0（迭代） | 新增 `migrateStoriesNullable`（重建表改可空）与 `migrateStoriesSortOrder`（补列） |
| v1.0（迭代） | 新增 `setStoryOrder`、`listParticipatedStories`、`getStoryParticipants`、`setStoryParticipants` |
| v1.3 | 未改动本区块 |

---

## 9. 验证方式

```bash
ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe -e "
const db=require('./database');
db.initDatabase();
const c=db.createCharacter({name:'__测试__', abilities:[{name:'火球术',level:2}]});
console.log('created', c.id, Array.isArray(c.abilities), c.relationships.family.length);
const s=db.createStory({character_id:c.id, title:'测试故事', content:'# hi'});
console.log('story order', s.sort_order);
console.log('list', db.listStories(c.id).length);
db.deleteStory(s.id); db.deleteCharacter(c.id);
console.log('cleaned');
"
```

预期：`abilities` 读回是数组、`relationships.family` 长度 0、`sort_order` 为当前最大值 +1，
删除后小故事与参与关系一并消失（可用 `select count(*)` 复核）。
