'use strict';

/* ============================================================
 * story-editor.js — 小故事编辑器窗口逻辑（story-editor.html）
 * 新建 / 编辑 / 删除小故事，Markdown 实时预览
 * ============================================================ */

const bridge = window.api;
let payload = null;          // 主窗口传入的编辑上下文
let mode = 'edit';           // edit | preview
let isGlobal = false;        // 是否为独立故事（不关联单一角色）
let allCharacters = [];      // 可选参与角色
let selectedParticipants = []; // 已选参与角色

const $ = (sel) => document.querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

let toastTimer = null;
function toast(msg, type = 'info') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast hidden'; }, 2600);
}

function updatePreview() {
  $('#preview').innerHTML = window.MD.render($('#f_content').value);
}

function setMode(m) {
  mode = m;
  const editing = mode === 'edit';
  $('#f_content').classList.toggle('hidden', !editing);
  $('#preview').classList.toggle('hidden', editing);
  $('#btnTogglePreview').textContent = editing ? '预览' : '编辑';
}

/* 用新的 payload 填充表单（初次加载与主窗口复用本窗口时都会调用） */
function fillForm(p) {
  if (!p) return;
  payload = p;
  isGlobal = !!p.isGlobal && !p.characterId;
  const story = (p.mode === 'edit' && p.story) ? p.story : null;
  if (isGlobal) {
    $('#charInfo').textContent = '独立故事（不关联单一角色）';
    $('#modeTitle').textContent = p.mode === 'edit' ? '编辑独立故事' : '撰写独立故事';
  } else {
    $('#charInfo').textContent = p.characterName ? '关联角色：' + p.characterName : '';
    $('#modeTitle').textContent = p.mode === 'edit' ? '编辑小故事' : '撰写新故事';
  }
  $('#f_title').value = story ? story.title || '' : '';
  $('#f_content').value = story ? story.content || '' : '';
  $('#f_tags').value = story ? story.tags || '' : '';
  $('#btnDelete').classList.toggle('hidden', !story);
  // 参与角色（角色小故事与独立故事都支持）
  selectedParticipants = Array.isArray(p.participants) ? p.participants.slice() : [];
  $('#participantSection').classList.remove('hidden');
  renderParticipantOptions();
  renderParticipantChips();
  $('#err').classList.add('hidden');
  $('#editorMain').classList.remove('hidden');
  updatePreview();
}

/* ---------------- 参与角色选择 ---------------- */
async function loadAllCharacters() {
  const r = await bridge.listCharacters();
  allCharacters = (r && r.ok) ? (r.data || []) : [];
  renderParticipantOptions();
}

function renderParticipantOptions() {
  const q = ($('#f_participant_search').value || '').trim().toLowerCase();
  const sel = new Set(selectedParticipants.map(c => c.id));
  const opts = allCharacters.filter(c =>
    !sel.has(c.id) &&
    (!q || String(c.name || '').toLowerCase().includes(q) || String(c.alias || '').toLowerCase().includes(q))
  );
  const box = $('#participantOptions');
  box.innerHTML = opts.length ? opts.map(c =>
    '<button type="button" class="participant-option" data-pid="' + c.id + '">' + escapeHtml(c.name || '未命名') + '</button>'
  ).join('') : '<span class="participant-options-empty">' + (allCharacters.length ? '无匹配角色' : '暂无角色可选（请先在主窗口创建角色）') + '</span>';
  $$('.participant-option', box).forEach(btn => btn.addEventListener('click', () => {
    const c = allCharacters.find(x => x.id === Number(btn.dataset.pid));
    if (c) {
      selectedParticipants.push(c);
      $('#f_participant_search').value = '';
      renderParticipantOptions();
      renderParticipantChips();
    }
  }));
}

function renderParticipantChips() {
  const box = $('#participantChips');
  box.innerHTML = selectedParticipants.length ? selectedParticipants.map(c =>
    '<span class="chip participant-chip-selected">' + escapeHtml(c.name || '未命名') +
      '<button type="button" class="participant-chip-remove" data-pid="' + c.id + '" title="移除">✕</button>' +
    '</span>'
  ).join('') : '<span class="participant-options-empty">（未选择参与角色）</span>';
  $$('.participant-chip-remove', box).forEach(btn => btn.addEventListener('click', () => {
    selectedParticipants = selectedParticipants.filter(c => c.id !== Number(btn.dataset.pid));
    renderParticipantOptions();
    renderParticipantChips();
  }));
}

async function save() {
  const title = $('#f_title').value.trim();
  if (!title) { toast('请填写故事标题', 'warn'); $('#f_title').focus(); return; }
  const data = {
    title,
    content: $('#f_content').value,
    tags: $('#f_tags').value.trim()
  };
  data.participantIds = selectedParticipants.map(c => c.id);
  const btn = $('#btnSave');
  btn.disabled = true;
  try {
    let r;
    if (payload.mode === 'edit' && payload.story) {
      r = await bridge.updateStory(Object.assign({ id: payload.story.id }, data));
    } else {
      r = await bridge.createStory(Object.assign({ character_id: isGlobal ? null : payload.characterId }, data));
    }
    if (r && r.ok) {
      toast('已保存');
      setTimeout(() => window.close(), 500);   // 主窗口已收到 stories:saved 自动刷新
    } else {
      toast((r && r.error) || '保存失败', 'error');
    }
  } finally {
    btn.disabled = false;
  }
}

async function remove() {
  if (!payload || !payload.story) return;
  if (!window.confirm('确定删除这篇小故事吗？')) return;
  const r = await bridge.deleteStory(payload.story.id);
  if (r && r.ok) {
    toast('已删除');
    setTimeout(() => window.close(), 500);
  } else {
    toast((r && r.error) || '删除失败', 'error');
  }
}

async function init() {
  $('#btnTogglePreview').addEventListener('click', () => setMode(mode === 'edit' ? 'preview' : 'edit'));
  $('#btnSave').addEventListener('click', save);
  $('#btnDelete').addEventListener('click', remove);
  $('#btnClose').addEventListener('click', () => window.close());
  $('#f_content').addEventListener('input', updatePreview);
  $('#f_participant_search').addEventListener('input', renderParticipantOptions);
  loadAllCharacters();

  // 主窗口复用本窗口时推送的新 payload
  bridge.onEditorPayload(p => fillForm(p));

  // 初次加载：从主进程读取 payload
  const r = await bridge.getEditorPayload();
  if (r && r.ok && r.data) {
    fillForm(r.data);
  } else {
    $('#err').classList.remove('hidden');
    $('#editorMain').classList.add('hidden');
  }
}

document.addEventListener('DOMContentLoaded', init);
