'use strict';

/* ============================================================
 * main.js — Electron 主进程
 * 窗口创建、IPC 通信、数据库初始化、图片管理与导入导出
 * ============================================================ */

const { app, BrowserWindow, ipcMain, dialog, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const db = require('./database');

const APP_ROOT = db.APP_ROOT;
const IMAGES_DIR = db.IMAGES_DIR;

let mainWindow = null;      // 主窗口
let storyEditorWin = null;  // 小故事编辑器窗口

/* ---------------- 窗口 ---------------- */

/* 窗口底色 = styles.css 的 --bg。主进程读不到 localStorage 里的主题偏好，
 * 只能按系统深浅取近似值：跟随系统时完全准确，用户手工选反时才有一帧偏差。 */
function shellBg() {
  return nativeTheme.shouldUseDarkColors ? '#18181b' : '#eef3fd';
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 700,
    title: '角色资料查询器',
    autoHideMenuBar: true,
    backgroundColor: shellBg(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

function createStoryEditorWindow(payload) {
  if (storyEditorWin && !storyEditorWin.isDestroyed()) {
    storyEditorWin.webContents.send('editor:payload', payload);
    storyEditorWin.focus();
    return;
  }
  storyEditorWin = new BrowserWindow({
    width: 1060,
    height: 860,
    minWidth: 800,
    minHeight: 640,
    title: '小故事编辑器',
    autoHideMenuBar: true,
    backgroundColor: shellBg(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  storyEditorWin._editorPayload = payload;   // 供渲染进程通过 IPC 读取
  storyEditorWin.loadFile(path.join(__dirname, 'story-editor.html'));
  storyEditorWin.on('closed', () => { storyEditorWin = null; });
}

/* ---------------- 图片工具 ---------------- */

function charImageDir(characterId) {
  return path.join(IMAGES_DIR, `char_${characterId}`);
}

/* 清空某个角色的某个图片槽位（avatar.* / portrait.*） */
function clearImageSlot(characterId, slot) {
  const dir = charImageDir(characterId);
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith(slot + '.')) {
      try { fs.unlinkSync(path.join(dir, f)); } catch (_) { /* 忽略 */ }
    }
  }
}

/* 将用户选择的图片复制到 images/char_{id}/{slot}.{ext}，返回相对路径 */
function saveImageFromSource(characterId, slot, srcPath) {
  if (!srcPath || typeof srcPath !== 'string') return '';
  if (!fs.existsSync(srcPath)) return '';
  const allowed = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
  let ext = path.extname(srcPath).toLowerCase();
  if (!allowed.includes(ext)) return '';
  if (ext === '.jpeg') ext = '.jpg';
  const dir = charImageDir(characterId);
  fs.mkdirSync(dir, { recursive: true });
  clearImageSlot(characterId, slot);
  const dest = path.join(dir, slot + ext);
  fs.copyFileSync(srcPath, dest);
  return path.relative(APP_ROOT, dest).split(path.sep).join('/');
}

/* 将渲染进程裁剪后的头像 dataURL 写入 images/char_{id}/{slot}.{ext}，返回相对路径 */
function saveImageFromDataUrl(characterId, slot, dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return '';
  const m = /^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/i.exec(String(dataUrl || ''));
  if (!m) return '';
  let ext = m[1].toLowerCase();
  if (ext === 'jpeg') ext = 'jpg';
  const dir = charImageDir(characterId);
  fs.mkdirSync(dir, { recursive: true });
  clearImageSlot(characterId, slot);
  const dest = path.join(dir, slot + '.' + ext);
  try {
    fs.writeFileSync(dest, Buffer.from(m[2], 'base64'));
  } catch (err) {
    console.error('[saveImageFromDataUrl]', err);
    return '';
  }
  return path.relative(APP_ROOT, dest).split(path.sep).join('/');
}

/* ---------------- IPC 工具 ---------------- */

/* 统一 try/catch：成功返回 {ok:true, data}，失败返回 {ok:false, error} */
function wrap(fn) {
  try {
    return { ok: true, data: fn() };
  } catch (err) {
    console.error('[IPC error]', err);
    return { ok: false, error: (err && err.message) || String(err) };
  }
}

/* 通知主窗口：故事已变化，需要刷新（characterId 为空 = 独立故事） */
function notifyStoriesSaved(characterId, isGlobal) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('stories:saved', { characterId: characterId || null, isGlobal: !!isGlobal });
  }
}

/* ---------------- IPC 注册 ---------------- */

function registerIpc() {
  // ---- 角色 ----
  ipcMain.handle('characters:list', () => wrap(() => db.listCharacters()));
  ipcMain.handle('characters:get', (_e, id) => wrap(() => db.getCharacter(Number(id))));
  ipcMain.handle('characters:create', (_e, payload) => wrap(() => {
    const { avatarSrc, portraitSrc, avatarCropData, ...data } = payload || {};
    const created = db.createCharacter(data);
    const avatar_path = avatarCropData
      ? saveImageFromDataUrl(created.id, 'avatar', avatarCropData)
      : saveImageFromSource(created.id, 'avatar', avatarSrc);
    const portrait_path = saveImageFromSource(created.id, 'portrait', portraitSrc);
    if (avatar_path || portrait_path) db.updateCharacter(created.id, { avatar_path, portrait_path });
    return db.getCharacter(created.id);
  }));
  ipcMain.handle('characters:update', (_e, payload) => wrap(() => {
    const { id, avatarSrc, portraitSrc, avatarCropData, removeAvatar, removePortrait, ...data } = payload || {};
    const charId = Number(id);
    const patch = {};
    if (removeAvatar) { clearImageSlot(charId, 'avatar'); patch.avatar_path = ''; }
    if (removePortrait) { clearImageSlot(charId, 'portrait'); patch.portrait_path = ''; }
    if (avatarCropData) patch.avatar_path = saveImageFromDataUrl(charId, 'avatar', avatarCropData);
    else if (avatarSrc) patch.avatar_path = saveImageFromSource(charId, 'avatar', avatarSrc);
    if (portraitSrc) patch.portrait_path = saveImageFromSource(charId, 'portrait', portraitSrc);
    db.updateCharacter(charId, { ...data, ...patch });
    return db.getCharacter(charId);
  }));
  ipcMain.handle('characters:delete', (_e, id) => wrap(() => {
    const charId = Number(id);
    db.deleteCharacter(charId);                       // 关联故事自动级联删除
    fs.rmSync(charImageDir(charId), { recursive: true, force: true }); // 删除图片目录
    return true;
  }));

  // ---- 小故事 / 独立故事 ----
  ipcMain.handle('stories:list', (_e, characterId) => wrap(() => db.listStories(Number(characterId))));
  ipcMain.handle('stories:get', (_e, id) => wrap(() => db.getStory(Number(id))));
  ipcMain.handle('stories:create', (_e, data) => wrap(() => {
    const story = db.createStory({
      character_id: data.character_id != null ? Number(data.character_id) : null,
      title: data.title, content: data.content, tags: data.tags,
      participantIds: data.participantIds || []
    });
    notifyStoriesSaved(story.character_id, story.character_id == null);
    return story;
  }));
  ipcMain.handle('stories:update', (_e, data) => wrap(() => {
    const story = db.updateStory(Number(data.id), data);
    notifyStoriesSaved(story.character_id, story.character_id == null);
    return story;
  }));
  ipcMain.handle('stories:delete', (_e, id) => wrap(() => {
    const story = db.getStory(Number(id));
    db.deleteStory(Number(id));
    if (story) notifyStoriesSaved(story.character_id, story.character_id == null);
    return true;
  }));
  ipcMain.handle('stories:reorder', (_e, data) => wrap(() => {
    db.setStoryOrder(Number(data.characterId), data.orderedIds || []);
    return true;
  }));
  ipcMain.handle('stories:listGlobal', () => wrap(() => db.listGlobalStories()));
  ipcMain.handle('stories:getGlobal', (_e, id) => wrap(() => db.getStoryWithParticipants(Number(id))));
  ipcMain.handle('stories:listParticipated', (_e, characterId) => wrap(() => db.listParticipatedStories(Number(characterId))));
  ipcMain.handle('stories:openEditor', (_e, payload) => wrap(() => { createStoryEditorWindow(payload || { mode: 'create' }); return true; }));
  ipcMain.handle('stories:getEditorPayload', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return { ok: true, data: (win && win._editorPayload) || null };
  });

  // ---- 图片 ----
  ipcMain.handle('dialog:pickImage', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: '选择图片',
      properties: ['openFile'],
      filters: [{ name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
    });
    if (r.canceled || !r.filePaths || !r.filePaths.length) return { ok: true, data: null };
    return { ok: true, data: r.filePaths[0] };
  });
  ipcMain.handle('image:getUrl', (_e, relPath) => wrap(() => {
    if (!relPath) return null;
    const abs = path.join(APP_ROOT, relPath);
    if (!fs.existsSync(abs)) return null;
    // 附加文件修改时间戳：同路径文件被覆盖后（如裁剪头像始终写 avatar.png），
    // URL 变化可避免 Chromium 命中旧缓存而显示旧图
    let url = pathToFileURL(abs).href;
    try { url += '?t=' + fs.statSync(abs).mtimeMs; } catch (_) { /* 忽略 */ }
    return url;
  }));

  // ---- 单张角色卡导出（含小故事） ----
  ipcMain.handle('characters:exportCard', async (_e, id) => {
    try {
      const char = db.getCharacter(Number(id));
      if (!char) return { ok: false, error: '角色不存在' };
      const stamp = new Date().toISOString().slice(0, 10);
      const safeName = String(char.name || '角色').replace(/[\\/:*?"<>|]/g, '_');
      const r = await dialog.showSaveDialog(mainWindow, {
        title: '导出角色卡',
        defaultPath: path.join(app.getPath('documents'), `角色卡_${safeName}_${stamp}.json`),
        filters: [{ name: 'JSON 文件', extensions: ['json'] }]
      });
      if (r.canceled || !r.filePath) return { ok: false, canceled: true };
      const data = db.exportCharacterCard(Number(id));
      if (!data) return { ok: false, error: '角色数据不存在' };
      fs.writeFileSync(r.filePath, JSON.stringify(data, null, 2), 'utf-8');
      return { ok: true, data: r.filePath };
    } catch (err) {
      console.error('[exportCard error]', err);
      return { ok: false, error: (err && err.message) || String(err) };
    }
  });

  // ---- 导入 / 导出 ----
  ipcMain.handle('data:export', async (_e, options) => {
    try {
      const includeImages = !!(options && options.includeImages);
      const stamp = new Date().toISOString().slice(0, 10);
      const r = await dialog.showSaveDialog(mainWindow, {
        title: '导出角色数据',
        defaultPath: path.join(app.getPath('documents'), `角色资料导出_${stamp}.json`),
        filters: [{ name: 'JSON 文件', extensions: ['json'] }]
      });
      if (r.canceled || !r.filePath) return { ok: false, canceled: true };
      const data = db.exportAll({ includeImages });
      fs.writeFileSync(r.filePath, JSON.stringify(data, null, 2), 'utf-8');
      return { ok: true, data: r.filePath };
    } catch (err) {
      console.error('[export error]', err);
      return { ok: false, error: (err && err.message) || String(err) };
    }
  });
  ipcMain.handle('data:import', async () => {
    try {
      const r = await dialog.showOpenDialog(mainWindow, {
        title: '导入角色数据',
        properties: ['openFile'],
        filters: [{ name: 'JSON 文件', extensions: ['json'] }]
      });
      if (r.canceled || !r.filePaths || !r.filePaths.length) return { ok: false, canceled: true };
      const raw = fs.readFileSync(r.filePaths[0], 'utf-8');
      let data;
      try { data = JSON.parse(raw); } catch (_) { return { ok: false, error: 'JSON 解析失败，文件格式不正确' }; }
      if (!data || !Array.isArray(data.characters)) return { ok: false, error: '不是有效的角色数据文件（缺少 characters 数组）' };
      const summary = db.importAll(data);
      return { ok: true, data: summary };
    } catch (err) {
      console.error('[import error]', err);
      return { ok: false, error: (err && err.message) || String(err) };
    }
  });
}

/* ---------------- 应用生命周期 ---------------- */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    // 数据库初始化失败时必须显式报错并退出：
    // 否则进程会保持存活但没有任何窗口，同时占着单实例锁，
    // 导致之后每次双击快捷方式都被判定为「第二实例」而静默退出。
    try {
      db.initDatabase();        // 建库建表 + 确保 images/ 目录存在（加分项4）
    } catch (err) {
      console.error('[startup] 数据库初始化失败', err);
      dialog.showErrorBox(
        '启动失败',
        '数据库初始化失败：\n' + ((err && err.message) || String(err)) +
        '\n\n常见原因：better-sqlite3 原生模块缺失或 ABI 不匹配。\n' +
        '请在项目目录执行：npm run rebuild'
      );
      app.quit();
      return;
    }
    registerIpc();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();                 // Windows 平台：关闭全部窗口即退出
  });
}
