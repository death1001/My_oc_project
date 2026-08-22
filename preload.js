'use strict';

/* ============================================================
 * preload.js — 预加载脚本
 * 通过 contextBridge 向渲染进程暴露安全的 IPC API
 * ============================================================ */

const { contextBridge, ipcRenderer } = require('electron');

const api = {
  // 角色
  listCharacters: () => ipcRenderer.invoke('characters:list'),
  getCharacter: (id) => ipcRenderer.invoke('characters:get', id),
  createCharacter: (data) => ipcRenderer.invoke('characters:create', data),
  updateCharacter: (data) => ipcRenderer.invoke('characters:update', data),
  deleteCharacter: (id) => ipcRenderer.invoke('characters:delete', id),

  // 小故事 / 独立故事
  listStories: (characterId) => ipcRenderer.invoke('stories:list', characterId),
  createStory: (data) => ipcRenderer.invoke('stories:create', data),
  updateStory: (data) => ipcRenderer.invoke('stories:update', data),
  deleteStory: (id) => ipcRenderer.invoke('stories:delete', id),
  listGlobalStories: () => ipcRenderer.invoke('stories:listGlobal'),
  reorderStories: (characterId, orderedIds) => ipcRenderer.invoke('stories:reorder', { characterId, orderedIds }),
  getGlobalStory: (id) => ipcRenderer.invoke('stories:getGlobal', id),
  listParticipatedStories: (characterId) => ipcRenderer.invoke('stories:listParticipated', characterId),
  openStoryEditor: (payload) => ipcRenderer.invoke('stories:openEditor', payload),
  getEditorPayload: () => ipcRenderer.invoke('stories:getEditorPayload'),

  // 图片
  pickImage: () => ipcRenderer.invoke('dialog:pickImage'),
  getImageUrl: (relPath) => ipcRenderer.invoke('image:getUrl', relPath),

  // 导入 / 导出
  exportData: (options) => ipcRenderer.invoke('data:export', options),
  exportCharacterCard: (id) => ipcRenderer.invoke('characters:exportCard', id),
  importData: () => ipcRenderer.invoke('data:import'),

  // 事件
  onStoriesSaved: (cb) => { ipcRenderer.on('stories:saved', (_e, d) => cb(d)); },
  onEditorPayload: (cb) => { ipcRenderer.on('editor:payload', (_e, d) => cb(d)); }
};

contextBridge.exposeInMainWorld('api', api);
