'use strict';

/* ============================================================
 * database.js — SQLite 数据库封装
 * 建表、增删改查、导入导出（better-sqlite3，同步 API）
 * ============================================================ */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const APP_ROOT = __dirname;
const DATA_DIR = path.join(APP_ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'characters.db');
const IMAGES_DIR = path.join(APP_ROOT, 'images');

let db = null;

/* 确保数据目录与图片目录存在（启动时自动创建） */
function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

/* ---------- 建表语句 ---------- */
const CREATE_SQL = `
CREATE TABLE IF NOT EXISTS characters (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL DEFAULT '',
  alias         TEXT DEFAULT '',
  age           INTEGER,
  gender        TEXT DEFAULT '',
  race          TEXT DEFAULT '',
  birth_date    TEXT DEFAULT '',
  birth_place   TEXT DEFAULT '',
  affiliation   TEXT DEFAULT '',
  profession    TEXT DEFAULT '',
  personality   TEXT DEFAULT '',
  abilities     TEXT DEFAULT '[]',
  weapons       TEXT DEFAULT '[]',
  combat_stats  TEXT DEFAULT '{}',
  relationships TEXT DEFAULT '{}',
  metadata      TEXT DEFAULT '{}',
  avatar_path   TEXT DEFAULT '',
  portrait_path TEXT DEFAULT '',
  created_at    TEXT DEFAULT (datetime('now','localtime')),
  updated_at    TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS stories (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER,                -- NULL = 独立故事（故事库），非空 = 该角色的专属小故事
  title        TEXT NOT NULL DEFAULT '',
  content      TEXT DEFAULT '',
  tags         TEXT DEFAULT '',
  sort_order   INTEGER DEFAULT 0,      -- 角色小故事的时间线排列顺序（越小越靠前）
  created_at   TEXT DEFAULT (datetime('now','localtime')),
  updated_at   TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

-- 故事参与关系：一个独立故事可关联多个参与角色
CREATE TABLE IF NOT EXISTS story_participants (
  story_id      INTEGER NOT NULL,
  character_id  INTEGER NOT NULL,
  PRIMARY KEY (story_id, character_id),
  FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE,
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_stories_character ON stories(character_id);
CREATE INDEX IF NOT EXISTS idx_story_participants_character ON story_participants(character_id);
`;

/* ---------- 初始化 ---------- */
function initDatabase() {
  ensureDirs();
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(CREATE_SQL);
  migrateStoriesNullable();
  migrateStoriesSortOrder();
  return db;
}

function getDb() {
  if (!db) initDatabase();
  return db;
}

/* 旧库迁移：stories.character_id 由 NOT NULL 改为可空（支持独立故事），数据原样保留 */
function migrateStoriesNullable() {
  if (!db) return;
  const cols = db.prepare('PRAGMA table_info(stories)').all();
  const col = cols.find(c => c.name === 'character_id');
  if (!col || col.notnull !== 1) return; // 已是最新结构
  console.log('[migrate] stories.character_id -> nullable');
  db.pragma('foreign_keys = OFF');
  try {
    const sql = 'BEGIN;' +
      'CREATE TABLE stories_new (' +
      ' id INTEGER PRIMARY KEY AUTOINCREMENT,' +
      ' character_id INTEGER,' +
      ' title TEXT NOT NULL DEFAULT \'\',' +
      ' content TEXT DEFAULT \'\',' +
      ' tags TEXT DEFAULT \'\',' +
      ' created_at TEXT DEFAULT (datetime(\'now\',\'localtime\')),' +
      ' updated_at TEXT DEFAULT (datetime(\'now\',\'localtime\')),' +
      ' FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE' +
      ');' +
      'INSERT INTO stories_new (id, character_id, title, content, tags, created_at, updated_at)' +
      ' SELECT id, character_id, title, content, tags, created_at, updated_at FROM stories;' +
      'DROP TABLE stories;' +
      'ALTER TABLE stories_new RENAME TO stories;' +
      'CREATE INDEX IF NOT EXISTS idx_stories_character ON stories(character_id);' +
      'COMMIT;';
    db.exec(sql);
  } catch (err) {
    console.error('[migrate] 失败，回滚:', err);
    try { db.exec('ROLLBACK'); } catch (_) { /* 忽略 */ }
    throw err;
  } finally {
    db.pragma('foreign_keys = ON');
  }
}



/* 旧库迁移：stories 增加 sort_order 列（角色小故事时间线排序） */
function migrateStoriesSortOrder() {
  if (!db) return;
  const cols = db.prepare('PRAGMA table_info(stories)').all();
  if (cols.find(c => c.name === 'sort_order')) return; // 已存在
  console.log('[migrate] stories.sort_order -> add column');
  db.exec('ALTER TABLE stories ADD COLUMN sort_order INTEGER DEFAULT 0');
}

/* ---------- 工具 ---------- */
function nowStr() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function parseJSON(str, fallback) {
  try { return JSON.parse(str); } catch (_) { return fallback; }
}

const CHAR_FIELDS = [
  'name', 'alias', 'age', 'gender', 'race', 'birth_date', 'birth_place',
  'affiliation', 'profession', 'personality', 'abilities', 'weapons',
  'combat_stats', 'relationships', 'metadata', 'avatar_path', 'portrait_path'
];

/* JSON 字段序列化：对象 -> 字符串，供写入 */
function serializeChar(data) {
  const out = {};
  for (const k of Object.keys(data || {})) {
    if (data[k] === undefined) continue;
    if (['abilities', 'weapons', 'combat_stats', 'relationships', 'metadata'].includes(k) && typeof data[k] !== 'string') {
      out[k] = JSON.stringify(data[k]);
    } else if (k === 'age' && (data[k] === '' || data[k] === null)) {
      out[k] = null;
    } else {
      out[k] = data[k];
    }
  }
  return out;
}

/* 行记录 -> 角色对象（JSON 字段反序列化） */
function rowToCharacter(row) {
  if (!row) return null;
  const c = { ...row };
  c.abilities = parseJSON(row.abilities, []);
  c.weapons = parseJSON(row.weapons, []);
  c.combat_stats = parseJSON(row.combat_stats, {});
  c.relationships = Object.assign(
    { family: [], companions: [], rivals: [], mentors: [] },
    parseJSON(row.relationships, {})
  );
  c.metadata = parseJSON(row.metadata, {});
  return c;
}

/* ---------- 角色 CRUD ---------- */
function listCharacters() {
  return getDb().prepare('SELECT * FROM characters ORDER BY updated_at DESC, id DESC').all().map(rowToCharacter);
}

function getCharacter(id) {
  return rowToCharacter(getDb().prepare('SELECT * FROM characters WHERE id = ?').get(id));
}

function createCharacter(data) {
  const dbx = getDb();
  const now = nowStr();
  const rec = serializeChar(Object.assign({
    name: '', alias: '', age: null, gender: '', race: '', birth_date: '', birth_place: '',
    affiliation: '', profession: '', personality: '',
    abilities: [], weapons: [], combat_stats: {},
    relationships: { family: [], companions: [], rivals: [], mentors: [] },
    metadata: {}, avatar_path: '', portrait_path: ''
  }, data));
  const stmt = dbx.prepare(
    `INSERT INTO characters (${CHAR_FIELDS.join(', ')}, created_at, updated_at)
     VALUES (${CHAR_FIELDS.map(f => '@' + f).join(', ')}, @created_at, @updated_at)`
  );
  const info = stmt.run({ ...rec, created_at: now, updated_at: now });
  return getCharacter(info.lastInsertRowid);
}

function updateCharacter(id, data) {
  const dbx = getDb();
  const fields = Object.keys(data || {}).filter(k => CHAR_FIELDS.includes(k));
  if (!fields.length) return getCharacter(id);
  const rec = serializeChar(data);
  const setClause = fields.map(k => `${k} = @${k}`).join(', ');
  dbx.prepare(`UPDATE characters SET ${setClause}, updated_at = @updated_at WHERE id = @id`)
    .run({ ...rec, id, updated_at: nowStr() });
  return getCharacter(id);
}

function deleteCharacter(id) {
  getDb().prepare('DELETE FROM characters WHERE id = ?').run(id); // stories 级联删除
}

/* ---------- 小故事 CRUD ---------- */
function listStories(characterId) {
  const rows = getDb().prepare('SELECT * FROM stories WHERE character_id = ? ORDER BY sort_order ASC, id ASC').all(characterId);
  return rows.map(s => Object.assign({}, s, { participants: getStoryParticipants(s.id) }));
}

function getStory(id) {
  return getDb().prepare('SELECT * FROM stories WHERE id = ?').get(id) || null;
}

/* 故事的参与角色列表 */
function getStoryParticipants(storyId) {
  return getDb().prepare('SELECT c.id, c.name, c.alias, c.avatar_path, c.portrait_path FROM story_participants sp JOIN characters c ON c.id = sp.character_id WHERE sp.story_id = ? ORDER BY c.name').all(storyId);
}

/* 覆盖式设置参与角色 */
function setStoryParticipants(storyId, characterIds) {
  const dbx = getDb();
  dbx.prepare('DELETE FROM story_participants WHERE story_id = ?').run(storyId);
  const ins = dbx.prepare('INSERT OR IGNORE INTO story_participants (story_id, character_id) VALUES (?, ?)');
  (characterIds || []).forEach(id => {
    const n = Number(id);
    if (n > 0) ins.run(storyId, n);
  });
}

/* 角色小故事时间线重排：orderedIds 为新顺序（第一个 = 最早/最靠前） */
function setStoryOrder(characterId, orderedIds) {
  const dbx = getDb();
  const upd = dbx.prepare('UPDATE stories SET sort_order = ? WHERE id = ? AND character_id = ?');
  (orderedIds || []).forEach((id, i) => upd.run(i, Number(id), Number(characterId)));
}

/* 创建故事：character_id 为空 = 独立故事；participantIds 可附加参与角色 */
function createStory({ character_id, title, content, tags, participantIds }) {
  const dbx = getDb();
  const now = nowStr();
  // 角色小故事：新故事追加到时间线末尾；独立故事排序值固定为 0
  let order = 0;
  if (character_id != null) {
    const row = dbx.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM stories WHERE character_id = ?').get(character_id);
    order = row.next;
  }
  const info = dbx.prepare(
    'INSERT INTO stories (character_id, title, content, tags, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(character_id || null, title || '', content || '', tags || '', order, now, now);
  const id = info.lastInsertRowid;
  if (participantIds && participantIds.length) setStoryParticipants(id, participantIds);
  return getStoryWithParticipants(id);
}

function updateStory(id, data) {
  const dbx = getDb();
  const params = { id, updated_at: nowStr() };
  const sets = [];
  for (const k of ['title', 'content', 'tags']) {
    if (data[k] !== undefined) { sets.push(k + ' = @' + k); params[k] = data[k]; }
  }
  if (sets.length) {
    dbx.prepare('UPDATE stories SET ' + sets.join(', ') + ', updated_at = @updated_at WHERE id = @id').run(params);
  }
  if (data.participantIds) setStoryParticipants(id, data.participantIds);
  return getStoryWithParticipants(id);
}

function deleteStory(id) {
  getDb().prepare('DELETE FROM stories WHERE id = ?').run(id); // 参与关系级联删除
}

/* 独立故事库：全部未关联角色的故事（含参与角色） */
function listGlobalStories() {
  const rows = getDb().prepare("SELECT * FROM stories WHERE character_id IS NULL ORDER BY updated_at DESC, id DESC").all();
  return rows.map(s => Object.assign({}, s, { participants: getStoryParticipants(s.id) }));
}

/* 单个故事 + 参与角色 */
function getStoryWithParticipants(id) {
  const s = getStory(id);
  if (!s) return null;
  return Object.assign({}, s, { participants: getStoryParticipants(id) });
}

/* 某角色参与的故事（独立故事库中的关联项） */
function listParticipatedStories(characterId) {
  return getDb().prepare(
    'SELECT s.* FROM story_participants sp JOIN stories s ON s.id = sp.story_id WHERE sp.character_id = ? ORDER BY s.updated_at DESC, s.id DESC'
  ).all(characterId);
}


/* ---------- 导入 / 导出 ---------- */
function readImageDataUrl(relPath) {
  if (!relPath) return null;
  const abs = path.join(APP_ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  const ext = (path.extname(abs).slice(1) || 'png').toLowerCase().replace('jpeg', 'jpg');
  return `data:image/${ext};base64,${fs.readFileSync(abs).toString('base64')}`;
}

function writeImageDataUrl(dir, slot, dataUrl) {
  const m = /^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/i.exec(String(dataUrl || ''));
  if (!m) return '';
  let ext = m[1].toLowerCase();
  if (ext === 'jpeg') ext = 'jpg';
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${slot}.${ext}`);
  fs.writeFileSync(dest, Buffer.from(m[2], 'base64'));
  return path.relative(APP_ROOT, dest).split(path.sep).join('/');
}

/* 导出全部数据（角色 + 故事），可选内嵌图片 base64 */
function exportAll({ includeImages } = {}) {
  const characters = listCharacters().map(c => {
    const rec = { ...c };
    if (includeImages) {
      rec.avatar_data = readImageDataUrl(c.avatar_path);
      rec.portrait_data = readImageDataUrl(c.portrait_path);
    }
    return rec;
  });
  const stories = getDb().prepare('SELECT * FROM stories ORDER BY COALESCE(character_id, 0), sort_order ASC, id ASC').all().map(s => Object.assign({}, s, {
    participant_ids: getStoryParticipants(s.id).map(p => p.id)
  }));
  return {
    app: '角色资料查询器',
    version: 1,
    exported_at: new Date().toISOString(),
    characters,
    stories
  };
}

/* 导出单个角色卡：角色对象内嵌其全部小故事，便于单独分享 / 投喂给 AI */
function exportCharacterCard(id) {
  const character = getCharacter(id);
  if (!character) return null;
  const stories = listStories(id).map(s => ({
    title: s.title,
    content: s.content,
    tags: s.tags,
    sort_order: s.sort_order,
    created_at: s.created_at,
    updated_at: s.updated_at
  }));
  // 该角色参与的故事（独立故事库中的关联项），便于投喂 AI 时上下文完整
  const participatedStories = listParticipatedStories(id).map(s => ({
    title: s.title,
    content: s.content,
    tags: s.tags,
    created_at: s.created_at,
    updated_at: s.updated_at
  }));
  return {
    app: '角色资料查询器',
    export_type: 'character_card',
    version: 1,
    exported_at: new Date().toISOString(),
    character: Object.assign({}, character, { stories, participated_stories: participatedStories })
  };
}

/* 从 JSON 导入（追加，不覆盖），返回导入数量统计 */
function importAll(data) {
  // 兼容“角色卡”格式：单个角色 + 内嵌 stories + 参与的故事
  if (data && data.export_type === 'character_card' && data.character && !Array.isArray(data.characters)) {
    const c = data.character;
    const nestedStories = Array.isArray(c.stories) ? c.stories.map((s, i) => (Object.assign({}, s, { character_id: c.id, sort_order: s.sort_order != null ? s.sort_order : i }))) : [];
    // 参与的故事：还原为独立故事，并将导入后的角色标记为参与者
    const partStories = Array.isArray(c.participated_stories)
      ? c.participated_stories.map(s => (Object.assign({}, s, { character_id: null, participant_ids: [c.id] })))
      : [];
    const { stories, participated_stories, ...charOnly } = c;
    data = { characters: [charOnly], stories: nestedStories.concat(partStories) };
  }
  const dbx = getDb();
  const result = dbx.transaction(() => {
    let charCount = 0;
    let storyCount = 0;
    const idMap = new Map(); // 旧角色 id -> 新角色 id

    for (const c of (data.characters || [])) {
      const rec = serializeChar(c);
      delete rec.id;
      delete rec.created_at;
      delete rec.updated_at;
      delete rec.avatar_data;
      delete rec.portrait_data;
      const keys = Object.keys(rec).filter(k => CHAR_FIELDS.includes(k));
      if (!keys.length) continue;
      const now = nowStr();
      const info = dbx.prepare(
        `INSERT INTO characters (${keys.join(', ')}, created_at, updated_at)
         VALUES (${keys.map(k => '@' + k).join(', ')}, @_ca, @_ua)`
      ).run({ ...rec, _ca: now, _ua: now });
      const newId = info.lastInsertRowid;
      idMap.set(c.id, newId);

      const dir = path.join(IMAGES_DIR, `char_${newId}`);
      const avatar_path = c.avatar_data ? writeImageDataUrl(dir, 'avatar', c.avatar_data) : '';
      const portrait_path = c.portrait_data ? writeImageDataUrl(dir, 'portrait', c.portrait_data) : '';
      if (avatar_path || portrait_path) {
        dbx.prepare('UPDATE characters SET avatar_path = ?, portrait_path = ? WHERE id = ?').run(avatar_path, portrait_path, newId);
      }
      charCount++;
    }

    for (const s of (data.stories || [])) {
      const cid = s.character_id != null ? idMap.get(s.character_id) : null; // null = 独立故事
      if (s.character_id != null && !cid) continue; // 关联的角色不存在则跳过
      const info = dbx.prepare('INSERT INTO stories (character_id, title, content, tags, sort_order) VALUES (?, ?, ?, ?, ?)')
        .run(cid, s.title || '', s.content || '', s.tags || '', s.sort_order != null ? Number(s.sort_order) : 0);
      // 还原参与角色（旧 id -> 新 id）
      const partIds = (s.participant_ids || []).map(pid => idMap.get(pid)).filter(pid => pid != null);
      if (partIds.length) setStoryParticipants(info.lastInsertRowid, partIds);
      storyCount++;
    }

    return { charCount, storyCount };
  });
  return result();
}

module.exports = {
  APP_ROOT, DATA_DIR, DB_PATH, IMAGES_DIR,
  initDatabase, ensureDirs,
  listCharacters, getCharacter, createCharacter, updateCharacter, deleteCharacter,
  listStories, getStory, createStory, updateStory, deleteStory,
  getStoryParticipants, setStoryParticipants, setStoryOrder,
  listGlobalStories, getStoryWithParticipants, listParticipatedStories,
  exportAll, exportCharacterCard, importAll
};
