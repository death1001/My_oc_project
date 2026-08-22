'use strict';

/* ============================================================
 * renderer.js — 主窗口渲染逻辑（index.html）
 * 列表渲染、搜索筛选、详情展示、角色表单、导入导出、关系图
 * ============================================================ */

const bridge = window.api;

/* ---------------- 通用工具 ---------------- */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(s) { return escapeHtml(s); }

/* 绝对路径 -> file:// URL（处理盘符冒号与特殊字符） */
function toFileUrl(p) {
  if (!p) return '';
  const segs = String(p).replace(/\\/g, '/').split('/').map((seg, i) => {
    if (i === 0 && /^[A-Za-z]:$/.test(seg)) return seg; // 保留盘符冒号
    return encodeURIComponent(seg);
  });
  return 'file:///' + segs.join('/');
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

let toastTimer = null;
function toast(msg, type = 'info') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast hidden'; }, 2800);
}

/* ---------------- 确认弹窗 ---------------- */
let confirmCb = null;
function showConfirm(title, message, onOk) {
  $('#confirmTitle').textContent = title;
  $('#confirmMessage').textContent = message;
  $('#confirmModal').classList.remove('hidden');
  confirmCb = onOk;
}
function closeConfirm() {
  $('#confirmModal').classList.add('hidden');
  confirmCb = null;
}

/* ---------------- 状态 ---------------- */
const REL_GROUPS = [
  { key: 'family', label: '亲属' },
  { key: 'companions', label: '同伴' },
  { key: 'rivals', label: '敌对' },
  { key: 'mentors', label: '导师 / 学生' }
];

const state = {
  characters: [],
  currentId: null,
  filters: { q: '', affiliation: '', race: '', tag: '' },
  view: 'chars',               // 'chars' = 角色视图 | 'stories' = 故事库视图
  currentGlobalStoryId: null,  // 当前打开的独立故事 id
  globalStoryCache: null       // 当前独立故事数据（含参与者）
};

let formState = {
  editingId: null, avatarSrc: null, portraitSrc: null,
  avatarCropData: null,
  removeAvatar: false, removePortrait: false
};

/* ---------------- 数据加载 ---------------- */
async function loadCharacters(selectId) {
  const r = await bridge.listCharacters();
  if (!r || !r.ok) { toast((r && r.error) || '加载角色列表失败', 'error'); return; }
  state.characters = r.data || [];
  rebuildFilterOptions();
  renderList();
  if (selectId !== undefined && selectId !== null) {
    if (state.characters.some(c => c.id === selectId)) { selectCharacter(selectId); return; }
  }
  if (state.currentId && state.characters.some(c => c.id === state.currentId)) {
    renderDetail(state.currentId); // 更新后刷新当前角色详情
    return;
  }
  if (state.characters.length) selectCharacter(state.characters[0].id);
  else showEmptyDetail();
}

async function selectCharacter(id) {
  state.currentId = id;
  renderList();
  renderDetail(id);
}

function showEmptyDetail() {
  state.currentId = null;
  $('#detailContent').classList.add('hidden');
  $('#detailEmpty').classList.remove('hidden');
  renderList();
}

/* ---------------- 筛选 ---------------- */
function getTags(c) {
  const t = c && c.metadata ? c.metadata.tags : null;
  if (Array.isArray(t)) return t.map(String);
  if (typeof t === 'string') return t.split(/[,，]/).map(s => s.trim()).filter(Boolean);
  return [];
}

function filteredCharacters() {
  const f = state.filters;
  const q = f.q.trim().toLowerCase();
  return state.characters.filter(c => {
    if (q && !(String(c.name || '').toLowerCase().includes(q) || String(c.alias || '').toLowerCase().includes(q))) return false;
    if (f.affiliation && (c.affiliation || '') !== f.affiliation) return false;
    if (f.race && (c.race || '') !== f.race) return false;
    if (f.tag && !getTags(c).includes(f.tag)) return false;
    return true;
  });
}

function rebuildFilterOptions() {
  const affs = [...new Set(state.characters.map(c => (c.affiliation || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh'));
  const races = [...new Set(state.characters.map(c => (c.race || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh'));
  const tags = [...new Set(state.characters.flatMap(getTags))].sort((a, b) => a.localeCompare(b, 'zh'));
  fillSelect($('#filterAffiliation'), affs, '全部阵营');
  fillSelect($('#filterRace'), races, '全部种族');
  fillSelect($('#filterTag'), tags, '全部标签');
}

function fillSelect(sel, values, allLabel) {
  const key = sel.id === 'filterAffiliation' ? 'affiliation' : sel.id === 'filterRace' ? 'race' : 'tag';
  const keep = state.filters[key] && values.includes(state.filters[key]) ? state.filters[key] : '';
  state.filters[key] = keep;
  sel.innerHTML = '<option value="">' + allLabel + '</option>' +
    values.map(v => '<option value="' + escapeAttr(v) + '"' + (v === keep ? ' selected' : '') + '>' + escapeHtml(v) + '</option>').join('');
}

/* ---------------- 左侧角色列表 ---------------- */
async function renderList() {
  const list = filteredCharacters();
  const box = $('#charList');
  $('#charCount').textContent = list.length;
  $('#charListEmpty').classList.toggle('hidden', list.length > 0);
  box.innerHTML = list.map(c =>
    '<div class="char-item' + (c.id === state.currentId ? ' active' : '') + '" data-id="' + c.id + '">' +
      '<div class="char-avatar">' +
        '<span class="avatar-fallback">' + escapeHtml((c.name || '?').charAt(0)) + '</span>' +
        '<img class="avatar-img hidden" alt="">' +
      '</div>' +
      '<div class="char-item-info">' +
        '<div class="char-item-name">' + escapeHtml(c.name || '未命名') + '</div>' +
        '<div class="char-item-alias">' + escapeHtml(c.alias || '') + '</div>' +
      '</div>' +
    '</div>'
  ).join('');

  const items = $$('.char-item', box);
  items.forEach(el => el.addEventListener('click', () => selectCharacter(Number(el.dataset.id))));

  // 异步加载头像
  await Promise.all(items.map(async (el) => {
    const c = state.characters.find(x => x.id === Number(el.dataset.id));
    if (!c || !c.avatar_path) return;
    const r = await bridge.getImageUrl(c.avatar_path);
    if (!r || !r.ok || !r.data) return;
    const img = $('.avatar-img', el);
    const fb = $('.avatar-fallback', el);
    if (!img || !fb) return;
    img.src = r.data;
    img.onload = () => { img.classList.remove('hidden'); fb.classList.add('hidden'); };
  }));
}

/* ---------------- 详情展示 ---------------- */
async function renderDetail(id) {
  const r = await bridge.getCharacter(id);
  if (!r || !r.ok || !r.data) { toast((r && r.error) || '加载角色详情失败', 'error'); return; }
  const c = r.data;
  $('#detailEmpty').classList.add('hidden');
  $('#detailContent').classList.remove('hidden');

  // 主视觉区（快速印象）
  $('#qiName').textContent = c.name || '未命名';
  $('#qiAlias').textContent = c.alias || '';
  $('#qiGender').textContent = c.gender || '—';
  $('#qiRace').textContent = c.race || '—';
  $('#qiAffiliation').textContent = c.affiliation || '—';
  $('#qiProfession').textContent = c.profession || '—';
  $('#qiWork').textContent = (c.metadata && c.metadata.work) || '—';
  const pers = String(c.personality || '').split(/[,，]/).map(s => s.trim()).filter(Boolean);
  $('#qiPersonality').innerHTML = pers.map(p => '<span class="chip">' + escapeHtml(p) + '</span>').join('');

  // 立绘
  const pi = $('#portraitImg'), pf = $('#portraitFallback');
  let hasPortrait = false;
  if (c.portrait_path) {
    const ir = await bridge.getImageUrl(c.portrait_path);
    if (ir && ir.ok && ir.data) {
      pi.src = ir.data;
      pi.classList.remove('hidden');
      pf.classList.add('hidden');
      hasPortrait = true;
    }
  }
  if (!hasPortrait) {
    pi.classList.add('hidden');
    pf.classList.remove('hidden');
    pf.innerHTML =
      '<div class="pf-initial">' + escapeHtml((c.name || '?').charAt(0)) + '</div>' +
      '<div class="pf-name">' + escapeHtml(c.name || '') + '</div>' +
      '<div class="pf-hint">暂无立绘</div>';
  }

  renderBasicTab(c);
  renderAbilitiesTab(c);
  renderRelationsTab(c);
  renderStoriesTab(c);
  renderParticipatedSection(c);
}

function renderBasicTab(c) {
  const pers = String(c.personality || '').split(/[,，]/).map(s => s.trim()).filter(Boolean).join('、') || '—';
  const rows = [
    ['姓名', c.name || '—'], ['别名 / 称号', c.alias || '—'],
    ['年龄', c.age != null ? String(c.age) : '—'], ['性别', c.gender || '—'],
    ['种族', c.race || '—'], ['出生年月', c.birth_date || '—'],
    ['出生地点', c.birth_place || '—'], ['所属阵营 / 组织', c.affiliation || '—'],
    ['身份 / 职业', c.profession || '—'], ['性格特征', pers],
    ['登场作品', (c.metadata && c.metadata.work) || '—'], ['首次出场', (c.metadata && c.metadata.first_appearance) || '—'],
    ['稀有度', (c.metadata && c.metadata.rarity) || '—'], ['标签', getTags(c).join('、') || '—'],
    ['创建时间', c.created_at || '—'], ['更新时间', c.updated_at || '—']
  ];
  $('#basicInfo').innerHTML = rows.map(([k, v]) =>
    '<div class="info-row"><dt>' + escapeHtml(k) + '</dt><dd>' + escapeHtml(v) + '</dd></div>'
  ).join('');
}

function renderAbilitiesTab(c) {
  const abilities = Array.isArray(c.abilities) ? c.abilities : [];
  const weapons = Array.isArray(c.weapons) ? c.weapons : [];
  $('#abilitiesList').innerHTML = abilities.length ? abilities.map((a, i) =>
    '<div class="card"><div class="card-head">' +
      '<span class="card-title">' + escapeHtml(a.name || ('能力' + (i + 1))) + '</span>' +
      (a.level != null && a.level !== '' ? '<span class="badge level">Lv.' + escapeHtml(String(a.level)) + '</span>' : '') +
    '</div>' +
    '<div class="card-desc">' + escapeHtml(a.description || '') + '</div></div>'
  ).join('') : '<div class="empty-inline">暂无能力数据</div>';

  $('#weaponsList').innerHTML = weapons.length ? weapons.map((w, i) =>
    '<div class="card"><div class="card-head">' +
      '<span class="card-title">' + escapeHtml(w.name || ('武器' + (i + 1))) + '</span>' +
      (w.type ? '<span class="badge type">' + escapeHtml(w.type) + '</span>' : '') +
    '</div>' +
    '<div class="card-desc">' + escapeHtml(w.description || '') + '</div></div>'
  ).join('') : '<div class="empty-inline">暂无武器数据</div>';

  const stats = c.combat_stats || {};
  const entries = Object.entries(stats);
  $('#combatStatsList').innerHTML = entries.length ? entries.map(([k, v]) =>
    '<div class="kv-row"><span class="kv-key">' + escapeHtml(k) + '</span><span class="kv-val">' + escapeHtml(String(v)) + '</span></div>'
  ).join('') : '<div class="empty-inline">暂无战斗属性</div>';
}

function renderRelationsTab(c) {
  $('#relationGraph').innerHTML = relationGraphHtml(c);
  $('#relationGroups').innerHTML = REL_GROUPS.map(g => {
    const items = (c.relationships && c.relationships[g.key]) || [];
    const inner = items.length ? items.map(it =>
      '<div class="rel-item">' +
        '<a class="rel-link" data-name="' + escapeAttr(it.name || '') + '">' + escapeHtml(it.name || '未命名') + '</a>' +
        (it.description ? '<span class="rel-desc">' + escapeHtml(it.description) + '</span>' : '') +
      '</div>'
    ).join('') : '<div class="empty-inline">暂无</div>';
    return '<div class="rel-group"><h4>' + g.label + '</h4>' + inner + '</div>';
  }).join('');
}

/* 关系图：SVG 径向布局，中心为当前角色，四周为关系对象（按类型着色） */
function relationGraphHtml(c) {
  const groupMeta = {
    family: { label: '亲属', color: '#4caf7d' },
    companions: { label: '同伴', color: '#5b8def' },
    rivals: { label: '敌对', color: '#e06060' },
    mentors: { label: '导师/学生', color: '#b07ce0' }
  };
  const items = [];
  REL_GROUPS.forEach(g => {
    ((c.relationships && c.relationships[g.key]) || []).forEach(it => {
      items.push({ name: it.name || '', color: groupMeta[g.key].color });
    });
  });
  if (!items.length) return '<div class="empty-inline">暂无关系数据</div>';

  const W = 560, H = 400, cx = W / 2, cy = H / 2;
  const R = Math.min(W, H) / 2 - 64;
  let lines = '', nodes = '';
  items.forEach((it, i) => {
    const ang = (i / items.length) * Math.PI * 2 - Math.PI / 2;
    const x = +(cx + R * Math.cos(ang)).toFixed(1);
    const y = +(cy + R * Math.sin(ang)).toFixed(1);
    lines += '<line x1="' + cx + '" y1="' + cy + '" x2="' + x + '" y2="' + y + '" stroke="' + it.color + '" stroke-width="1.5" opacity="0.5"/>';
    nodes += '<g class="graph-node" data-name="' + escapeAttr(it.name) + '" transform="translate(' + x + ' ' + y + ')">' +
      '<circle r="16" fill="' + it.color + '" opacity="0.9"/>' +
      '<text y="5" text-anchor="middle" fill="#fff" font-size="11" font-weight="600">' + escapeHtml((it.name || '?').slice(0, 2)) + '</text>' +
      '</g>' +
      '<text x="' + x + '" y="' + (y + 32) + '" text-anchor="middle" class="graph-label" font-size="11" fill="#cfd4de">' + escapeHtml(it.name) + '</text>';
  });
  return '<svg class="relation-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">' +
    '<circle cx="' + cx + '" cy="' + cy + '" r="24" fill="#3a4050" stroke="#5b8def" stroke-width="2"/>' +
    '<text x="' + cx + '" y="' + (cy + 5) + '" text-anchor="middle" fill="#fff" font-size="12" font-weight="600">' + escapeHtml((c.name || '?').slice(0, 6)) + '</text>' +
    lines + nodes + '</svg>';
}

/* 点击关系名称跳转到对应角色（按姓名或别名精确匹配） */
function jumpToCharacter(name) {
  if (!name) return;
  const n = String(name).trim().toLowerCase();
  const target = state.characters.find(c =>
    String(c.name || '').trim().toLowerCase() === n ||
    String(c.alias || '').trim().toLowerCase() === n);
  if (target) { selectCharacter(target.id); toast('已跳转到「' + target.name + '」'); }
  else toast('未找到名为「' + name + '」的角色', 'warn');
}

function renderStoriesTab(c) {
  const box = $('#storiesList');
  bridge.listStories(c.id).then(r => {
    const stories = (r && r.ok) ? (r.data || []) : [];
    $('#storyCount').textContent = stories.length;
    box.innerHTML = stories.length ? stories.map(s => {
      const tags = String(s.tags || '').split(/[,，]/).map(t => t.trim()).filter(Boolean);
      return '<div class="story-card" data-id="' + s.id + '">' +
        '<div class="story-head"><span class="story-title">' + escapeHtml(s.title || '未命名故事') + '</span>' +
        '<span class="story-time">' + escapeHtml(s.updated_at || '') + '</span></div>' +
        (tags.length ? '<div class="chips">' + tags.map(t => '<span class="chip chip-tag">' + escapeHtml(t) + '</span>').join('') + '</div>' : '') +
        '<div class="story-preview md-body">' + window.MD.render(truncateText(s.content || '', 160)) + '</div>' +
        '<div class="story-actions">' +
          '<button type="button" class="btn btn-small" data-action="up" title="在成长时间线中上移">⬆</button>' +
          '<button type="button" class="btn btn-small" data-action="down" title="在成长时间线中下移">⬇</button>' +
          '<button type="button" class="btn btn-small" data-action="read" title="展开阅读全文">📖 阅读</button>' +
          '<button type="button" class="btn btn-small" data-action="edit" title="编辑该故事">✏️ 编辑</button>' +
        '</div>' +
      '</div>';
    }).join('') : '<div class="empty-inline">还没有小故事，点击「撰写新故事」开始记录。</div>';
    $$('.story-card', box).forEach(el => el.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      const s = stories.find(x => x.id === Number(el.dataset.id));
      if (!s) return;
      if (btn) {
        const idx = stories.findIndex(x => x.id === s.id);
        if (btn.dataset.action === 'up') { moveStory(c, stories, idx, -1); return; }
        if (btn.dataset.action === 'down') { moveStory(c, stories, idx, 1); return; }
        if (btn.dataset.action === 'edit') { openStoryEditor('edit', c.id, c.name, s); return; }
        if (btn.dataset.action === 'read') { openStoryReader(s, c); return; }
      }
      openStoryReader(s, c); // 点击卡片任意位置默认展开阅读
    }));
  }).catch(() => {
    box.innerHTML = '<div class="empty-inline">加载小故事失败</div>';
  });
}

/* 角色小故事时间线：上移/下移并持久化顺序 */
async function moveStory(character, stories, index, dir) {
  const j = index + dir;
  if (j < 0 || j >= stories.length) return;
  const arr = stories.slice();
  const t = arr[index]; arr[index] = arr[j]; arr[j] = t;
  const r = await bridge.reorderStories(character.id, arr.map(s => s.id));
  if (r && r.ok) {
    renderStoriesTab(character);
  } else {
    toast((r && r.error) || '排序保存失败', 'error');
  }
}

function truncateText(text, n) {
  if (text.length <= n) return text;
  return text.slice(0, n) + '…';
}

function openStoryEditor(mode, characterId, characterName, story) {
  bridge.openStoryEditor({ mode, characterId, characterName, story: story || null });
}

/* ---------------- 独立故事库（故事视图） ---------------- */
function openGlobalStoryEditor(mode, story) {
  bridge.openStoryEditor({
    mode,
    characterId: null,
    characterName: '',
    isGlobal: true,
    story: story || null,
    participants: story ? (story.participants || []) : []
  });
}

async function renderGlobalStoryList() {
  const r = await bridge.listGlobalStories();
  const stories = (r && r.ok) ? (r.data || []) : [];
  $('#charCount').textContent = stories.length;
  const box = $('#globalStoryList');
  $('#globalStoryEmpty').classList.toggle('hidden', stories.length > 0);
  box.innerHTML = stories.map(s => {
    const parts = (s.participants || []).map(p => p.name).filter(Boolean).join('、');
    return '<div class="story-item' + (s.id === state.currentGlobalStoryId ? ' active' : '') + '" data-id="' + s.id + '">' +
      '<div class="story-item-title">' + escapeHtml(s.title || '未命名故事') + '</div>' +
      '<div class="story-item-meta">' + escapeHtml(s.updated_at || '') +
      (parts ? ' · 参与：' + escapeHtml(parts) : '') + '</div>' +
    '</div>';
  }).join('');
  $$('.story-item', box).forEach(el => el.addEventListener('click', () => selectGlobalStory(Number(el.dataset.id))));
}

async function selectGlobalStory(id) {
  state.currentGlobalStoryId = id;
  const r = await bridge.getGlobalStory(id);
  if (!r || !r.ok || !r.data) { showGlobalStoryEmpty(); return; }
  state.globalStoryCache = r.data;
  renderGlobalStoryDetail(r.data);
  $$('#globalStoryList .story-item').forEach(el => el.classList.toggle('active', Number(el.dataset.id) === id));
}

function renderGlobalStoryDetail(story) {
  $('#detail').classList.add('hidden');
  $('#gsEmptyDetail').classList.add('hidden');
  const card = $('.panel-card', $('#globalStoryDetail'));
  card.classList.remove('hidden');
  $('#globalStoryDetail').classList.remove('hidden');
  $('#gsTitle').textContent = story.title || '未命名故事';
  const tags = String(story.tags || '').split(/[,，]/).map(t => t.trim()).filter(Boolean);
  const metaParts = [];
  if (story.created_at) metaParts.push('创建：' + story.created_at);
  if (story.updated_at) metaParts.push('更新：' + story.updated_at);
  $('#gsMeta').innerHTML =
    (tags.length ? '<div class="chips">' + tags.map(t => '<span class="chip chip-tag">' + escapeHtml(t) + '</span>').join('') + '</div>' : '') +
    (metaParts.length ? '<span class="meta-text">' + metaParts.map(escapeHtml).join('　·　') + '</span>' : '');
  $('#gsContent').innerHTML = window.MD.render(story.content || '（空）');
  // 参与角色（故事末尾）：立绘 + 名字的角色卡
  renderParticipantCards('#gsParticipants', story.participants);
}

/* 渲染参与角色卡（立绘 + 名字），供独立故事详情与阅读弹窗共用 */
function renderParticipantCards(containerSel, participants) {
  const parts = (participants || []).slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh'));
  const box = $(containerSel);
  if (!box) return;
  box.innerHTML =
    '<h3>参与角色（' + parts.length + '）</h3>' +
    (parts.length ? '<div class="participant-cards">' + parts.map(p =>
      '<div class="participant-card" data-id="' + p.id + '" title="点击跳转到该角色">' +
        '<div class="participant-portrait">' +
          '<span class="participant-portrait-fallback">' + escapeHtml(String(p.name || '?').charAt(0)) + '</span>' +
          '<img class="participant-portrait-img hidden" alt="">' +
        '</div>' +
        '<div class="participant-name">' + escapeHtml(p.name || '未命名') + '</div>' +
      '</div>').join('') + '</div>'
    : '<div class="empty-inline">暂无参与角色</div>');
  // 异步加载各参与角色的立绘
  $$(containerSel + ' .participant-card').forEach(card => {
    const c = parts.find(x => x.id === Number(card.dataset.id));
    if (!c || !c.portrait_path) return;
    bridge.getImageUrl(c.portrait_path).then(r => {
      if (!r || !r.ok || !r.data) return;
      const img = $('.participant-portrait-img', card);
      const fb = $('.participant-portrait-fallback', card);
      if (!img || !fb) return;
      img.src = r.data;
      img.onload = () => { img.classList.remove('hidden'); fb.classList.add('hidden'); };
    });
  });
}

/* 按角色 id 跳转到角色档案 */
function jumpToCharacterById(id) {
  const c = state.characters.find(x => x.id === Number(id));
  if (c) {
    switchSideView('chars');
    selectCharacter(c.id);
    toast('已跳转到「' + c.name + '」');
  }
}

function showGlobalStoryEmpty() {
  state.currentGlobalStoryId = null;
  state.globalStoryCache = null;
  $('#globalStoryDetail').classList.remove('hidden');
  $('.panel-card', $('#globalStoryDetail')).classList.add('hidden');
  $('#gsEmptyDetail').classList.remove('hidden');
  $('#detail').classList.add('hidden');
}

function switchSideView(view) {
  state.view = view;
  $$('.side-tab').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('#charsView').classList.toggle('hidden', view !== 'chars');
  $('#storiesView').classList.toggle('hidden', view !== 'stories');
  if (view === 'stories') {
    $('#detail').classList.add('hidden');
    renderGlobalStoryList();
    if (state.currentGlobalStoryId) selectGlobalStory(state.currentGlobalStoryId);
    else showGlobalStoryEmpty();
  } else {
    $('#globalStoryDetail').classList.add('hidden');
    $('#detail').classList.remove('hidden');
    if (state.currentId) renderDetail(state.currentId);
    else showEmptyDetail();
  }
}

/* 某角色参与的故事（展示在角色详情的「小故事」Tab） */
async function renderParticipatedSection(c) {
  const r = await bridge.listParticipatedStories(c.id);
  const stories = (r && r.ok) ? (r.data || []) : [];
  $('#participatedCount').textContent = stories.length;
  const box = $('#participatedList');
  box.innerHTML = stories.length ? stories.map(s => {
    const tags = String(s.tags || '').split(/[,，]/).map(t => t.trim()).filter(Boolean);
    return '<div class="story-card" data-pid="' + s.id + '">' +
      '<div class="story-head"><span class="story-title">' + escapeHtml(s.title || '未命名故事') + '</span>' +
      '<span class="story-time">' + escapeHtml(s.updated_at || '') + '</span></div>' +
      (tags.length ? '<div class="chips">' + tags.map(t => '<span class="chip chip-tag">' + escapeHtml(t) + '</span>').join('') + '</div>' : '') +
      '<div class="story-preview md-body">' + window.MD.render(truncateText(s.content || '', 120)) + '</div>' +
    '</div>';
  }).join('') : '<div class="empty-inline">该角色暂未参与任何独立故事</div>';
  $$('.story-card', box).forEach(el => el.addEventListener('click', () => selectGlobalStory(Number(el.dataset.pid))));
}

/* ---------------- 小故事阅读弹窗 ---------------- */
let readerState = { story: null, character: null };

function openStoryReader(story, character) {
  if (!story) return;
  readerState = { story, character };
  $('#readerTitle').textContent = story.title || '未命名故事';
  $('#readerCharInfo').textContent = character ? '角色：' + character.name : '';
  const tags = String(story.tags || '').split(/[,，]/).map(t => t.trim()).filter(Boolean);
  const metaParts = [];
  if (story.created_at) metaParts.push('创建：' + story.created_at);
  if (story.updated_at) metaParts.push('更新：' + story.updated_at);
  $('#readerMeta').innerHTML =
    (tags.length ? '<div class="chips">' + tags.map(t => '<span class="chip chip-tag">' + escapeHtml(t) + '</span>').join('') + '</div>' : '') +
    (metaParts.length ? '<span>' + metaParts.map(escapeHtml).join('　·　') + '</span>' : '');
  $('#readerContent').innerHTML = window.MD.render(story.content || '（空）');
  // 参与角色（立绘 + 名字）
  renderParticipantCards('#readerParticipants', story.participants);
  $('#storyReader').classList.remove('hidden');
}

function closeStoryReader() {
  $('#storyReader').classList.add('hidden');
  readerState = { story: null, character: null };
}

/* ---------------- 标签页切换 ---------------- */
function bindTabSwitching() {
  $$('.tab-btn').forEach(btn => btn.addEventListener('click', () => {
    $$('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
    $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + btn.dataset.tab));
  }));
}

/* ---------------- 删除角色 ---------------- */
function deleteCurrent() {
  const c = state.characters.find(x => x.id === state.currentId);
  if (!c) return;
  showConfirm('删除角色',
    '确定要删除角色「' + c.name + '」吗？其全部小故事与 images/char_' + c.id + '/ 图片文件将一并删除。',
    async () => {
      const r = await bridge.deleteCharacter(c.id);
      if (r && r.ok) {
        toast('已删除角色「' + c.name + '」');
        const idx = state.characters.findIndex(x => x.id === c.id);
        const next = state.characters[idx + 1] || state.characters[idx - 1] || null;
        state.currentId = null;
        await loadCharacters(next ? next.id : null);
      } else {
        toast((r && r.error) || '删除失败', 'error');
      }
    });
}

/* ---------------- 角色表单 ---------------- */
function openCharForm(character) {
  const editing = !!character;
  formState = { editingId: editing ? character.id : null, avatarSrc: null, portraitSrc: null, avatarCropData: null, removeAvatar: false, removePortrait: false };
  $('#charModalTitle').textContent = editing ? '编辑角色资料' : '新建角色';
  $('#f_name').value = character ? character.name || '' : '';
  $('#f_alias').value = character ? character.alias || '' : '';
  $('#f_age').value = character && character.age != null ? String(character.age) : '';
  $('#f_gender').value = character ? character.gender || '' : '';
  $('#f_race').value = character ? character.race || '' : '';
  $('#f_birth_date').value = character ? character.birth_date || '' : '';
  $('#f_birth_place').value = character ? character.birth_place || '' : '';
  $('#f_affiliation').value = character ? character.affiliation || '' : '';
  $('#f_profession').value = character ? character.profession || '' : '';
  $('#f_personality').value = character ? character.personality || '' : '';
  $('#f_work').value = character && character.metadata ? character.metadata.work || '' : '';
  $('#f_first_appearance').value = character && character.metadata ? character.metadata.first_appearance || '' : '';
  $('#f_rarity').value = character && character.metadata ? character.metadata.rarity || '' : '';
  $('#f_tags').value = getTags(character).join(', ');

  // 清空动态行
  $('#abilitiesRows').innerHTML = '';
  $('#weaponsRows').innerHTML = '';
  $('#combatStatsRows').innerHTML = '';
  REL_GROUPS.forEach(g => { $('#' + g.key + 'Rows').innerHTML = ''; });

  // 能力
  ((character && Array.isArray(character.abilities)) ? character.abilities : []).forEach(a =>
    addDynRow('#abilitiesRows', [
      { cls: 'inp-wide', placeholder: '能力名称', value: a.name },
      { cls: 'inp-wide', placeholder: '描述', value: a.description },
      { cls: 'inp-short', placeholder: '等级', value: a.level }
    ]));
  // 武器
  ((character && Array.isArray(character.weapons)) ? character.weapons : []).forEach(w =>
    addDynRow('#weaponsRows', [
      { cls: 'inp-wide', placeholder: '武器名称', value: w.name },
      { cls: 'inp-short', placeholder: '类型', value: w.type },
      { cls: 'inp-wide', placeholder: '描述', value: w.description }
    ]));
  // 战斗属性
  Object.entries((character && character.combat_stats) || {}).forEach(([k, v]) =>
    addDynRow('#combatStatsRows', [
      { cls: 'inp-short', placeholder: '属性名(如 hp)', value: k },
      { cls: 'inp-short', placeholder: '数值', value: v }
    ]));
  // 关系网络
  REL_GROUPS.forEach(g => {
    const items = (character && character.relationships && character.relationships[g.key]) || [];
    items.forEach(it =>
      addDynRow('#' + g.key + 'Rows', [
        { cls: 'inp-wide', placeholder: '角色名', value: it.name },
        { cls: 'inp-wide', placeholder: '关系说明', value: it.description }
      ]));
  });

  // 图片预览（保留原图路径）
  resetImagePreview('avatar', character ? character.avatar_path : null);
  resetImagePreview('portrait', character ? character.portrait_path : null);

  $('#charModal').classList.remove('hidden');
  $('#f_name').focus();
}

function closeCharForm() {
  $('#charModal').classList.add('hidden');
}

/* 动态行编辑 */
function addDynRow(containerSel, inputs) {
  const row = document.createElement('div');
  row.className = 'dyn-row';
  row.innerHTML = inputs.map(i =>
    '<input class="dyn-input ' + (i.cls || '') + '" placeholder="' + escapeAttr(i.placeholder || '') + '" value="' + escapeAttr(i.value == null ? '' : String(i.value)) + '">'
  ).join('') +
  '<button type="button" class="btn btn-small btn-danger-ghost dyn-remove" title="删除该行">✕</button>';
  $('.dyn-remove', row).addEventListener('click', () => row.remove());
  $(containerSel).appendChild(row);
}

function collectRows(containerSel, fields) {
  return $$('.dyn-row', $(containerSel)).map(row => {
    const obj = {};
    $$('.dyn-input', row).forEach((inp, i) => { obj[fields[i]] = inp.value.trim(); });
    return obj;
  }).filter(o => Object.values(o).some(v => v !== ''));
}

function collectCombatStats() {
  const out = {};
  collectRows('#combatStatsRows', ['key', 'value']).forEach(o => {
    if (!o.key) return;
    const v = o.value;
    out[o.key] = (v !== '' && !isNaN(Number(v))) ? Number(v) : v;
  });
  return out;
}

/* 图片选择 / 移除 / 预览 */
async function pickImageFor(slot) {
  const r = await bridge.pickImage();
  if (!r || !r.ok) { toast((r && r.error) || '选择图片失败', 'error'); return; }
  if (!r.data) return; // 用户取消
  if (slot === 'avatar') {
    // 头像：打开圆形裁剪弹窗（拖动移动 + 滚轮缩放）
    openAvatarCrop(r.data);
    return;
  }
  // 立绘：保持原样，直接预览源图
  formState.portraitSrc = r.data;
  formState.removePortrait = false;
  const box = $('#portraitPreview');
  box.innerHTML = '<img src="' + escapeAttr(toFileUrl(r.data)) + '" alt="">';
  $('[data-remove="portrait"]').classList.remove('hidden');
}

function removeImageFor(slot) {
  if (slot === 'avatar') { formState.avatarSrc = null; formState.avatarCropData = null; formState.removeAvatar = true; }
  else { formState.portraitSrc = null; formState.removePortrait = true; }
  const box = $('#' + slot + 'Preview');
  box.innerHTML = '<span>已移除</span>';
  $('[data-remove="' + slot + '"]').classList.add('hidden');
}

/* ---------------- 头像圆形裁剪 ---------------- */
const CROP_SIZE = 440;    // 画布边长(px)
const CROP_RADIUS = 150;  // 圆形选区半径(px)

let cropState = {
  img: null,        // 原图 Image
  zoom: 1,          // 显示缩放倍率
  offX: 0, offY: 0, // 图片左上角在画布上的坐标
  dragging: false,
  dragStartX: 0, dragStartY: 0,
  dragOffX: 0, dragOffY: 0
};

/* 最小缩放：保证圆形选区完全被图片覆盖 */
function cropMinZoom() {
  const { img } = cropState;
  if (!img) return 1;
  return Math.max((CROP_RADIUS * 2) / img.naturalWidth, (CROP_RADIUS * 2) / img.naturalHeight);
}

/* 把图片位置限制在“圆形选区始终位于图片范围内” */
function clampCrop() {
  const { img } = cropState;
  if (!img) return;
  const cx = CROP_SIZE / 2, cy = CROP_SIZE / 2;
  const imgW = img.naturalWidth * cropState.zoom;
  const imgH = img.naturalHeight * cropState.zoom;
  const minX = cx + CROP_RADIUS - imgW;
  const maxX = cx - CROP_RADIUS;
  const minY = cy + CROP_RADIUS - imgH;
  const maxY = cy - CROP_RADIUS;
  cropState.offX = Math.min(Math.max(cropState.offX, minX), maxX);
  cropState.offY = Math.min(Math.max(cropState.offY, minY), maxY);
}

function drawCrop() {
  const cv = $('#cropCanvas');
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, CROP_SIZE, CROP_SIZE);
  if (!cropState.img) return;
  const imgW = cropState.img.naturalWidth * cropState.zoom;
  const imgH = cropState.img.naturalHeight * cropState.zoom;
  // 画布本身是圆形（CSS border-radius），只画出圆形内的图片
  ctx.save();
  ctx.beginPath();
  ctx.arc(CROP_SIZE / 2, CROP_SIZE / 2, CROP_RADIUS, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(cropState.img, cropState.offX, cropState.offY, imgW, imgH);
  ctx.restore();
  $('#cropZoomLabel').textContent = '缩放 ' + Math.round(cropState.zoom * 100) + '%';
}

/* 打开裁剪弹窗并加载所选图片 */
async function openAvatarCrop(srcPath) {
  const img = new Image();
  img.src = toFileUrl(srcPath);
  try { await img.decode(); } catch (_) { toast('无法读取该图片，请换一张重试', 'error'); return; }
  if (!img.naturalWidth || !img.naturalHeight) { toast('图片无效，无法裁剪', 'error'); return; }
  cropState.img = img;
  resetCrop();
  $('#cropModal').classList.remove('hidden');
}

/* 重置：图片居中、缩放回初始比例 */
function resetCrop() {
  const { img } = cropState;
  if (!img) return;
  const fitZ = Math.min((CROP_SIZE - 20) / img.naturalWidth, (CROP_SIZE - 20) / img.naturalHeight);
  cropState.zoom = Math.max(fitZ, cropMinZoom());
  cropState.offX = (CROP_SIZE - img.naturalWidth * cropState.zoom) / 2;
  cropState.offY = (CROP_SIZE - img.naturalHeight * cropState.zoom) / 2;
  clampCrop();
  drawCrop();
}

function closeCropModal() {
  $('#cropModal').classList.add('hidden');
  cropState.dragging = false;
}

/* 确认：把圆形选区内容输出为圆形 PNG dataURL */
function confirmAvatarCrop() {
  const { img } = cropState;
  if (!img) return;
  const zoom = cropState.zoom;
  const cx = CROP_SIZE / 2, cy = CROP_SIZE / 2;
  const cropPx = (CROP_RADIUS * 2) / zoom;             // 圆形在图片像素中的直径
  const icx = (cx - cropState.offX) / zoom;             // 圆心对应的图片像素坐标
  const icy = (cy - cropState.offY) / zoom;
  const outSide = Math.min(Math.max(Math.round(cropPx), 128), 512);
  const out = document.createElement('canvas');
  out.width = out.height = outSide;
  const octx = out.getContext('2d');
  octx.clearRect(0, 0, outSide, outSide);
  octx.save();
  octx.beginPath();
  octx.arc(outSide / 2, outSide / 2, outSide / 2, 0, Math.PI * 2);
  octx.clip();
  octx.drawImage(img, icx - cropPx / 2, icy - cropPx / 2, cropPx, cropPx, 0, 0, outSide, outSide);
  octx.restore();
  const dataUrl = out.toDataURL('image/png');
  formState.avatarCropData = dataUrl;
  formState.avatarSrc = null;
  formState.removeAvatar = false;
  const box = $('#avatarPreview');
  box.innerHTML = '<img src="' + dataUrl + '" alt="">';
  $('[data-remove="avatar"]').classList.remove('hidden');
  closeCropModal();
  toast('头像已裁剪为圆形，保存角色时生效');
}

/* 画布拖动：移动图片位置 */
function onCropMouseDown(e) {
  if ($('#cropModal').classList.contains('hidden') || !cropState.img) return;
  e.preventDefault();
  cropState.dragging = true;
  cropState.dragStartX = e.clientX;
  cropState.dragStartY = e.clientY;
  cropState.dragOffX = cropState.offX;
  cropState.dragOffY = cropState.offY;
  $('#cropCanvas').classList.add('dragging');
}

function onCropMouseMove(e) {
  if (!cropState.dragging) return;
  cropState.offX = cropState.dragOffX + (e.clientX - cropState.dragStartX);
  cropState.offY = cropState.dragOffY + (e.clientY - cropState.dragStartY);
  clampCrop();
  drawCrop();
}

function onCropMouseUp() {
  if (!cropState.dragging) return;
  cropState.dragging = false;
  $('#cropCanvas').classList.remove('dragging');
}

/* 滚轮缩放：以鼠标位置为中心缩放 */
function onCropWheel(e) {
  if ($('#cropModal').classList.contains('hidden') || !cropState.img) return;
  e.preventDefault();
  const cv = $('#cropCanvas');
  const rect = cv.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  const newZoom = Math.min(Math.max(cropState.zoom * factor, cropMinZoom()), 12);
  if (newZoom === cropState.zoom) return;
  const px = (mx - cropState.offX) / cropState.zoom;
  const py = (my - cropState.offY) / cropState.zoom;
  cropState.zoom = newZoom;
  cropState.offX = mx - px * newZoom;
  cropState.offY = my - py * newZoom;
  clampCrop();
  drawCrop();
}

async function resetImagePreview(slot, relPath) {
  if (slot === 'avatar') { formState.removeAvatar = false; formState.avatarCropData = null; }
  else formState.removePortrait = false;
  const box = $('#' + slot + 'Preview');
  box.innerHTML = '<span>未选择</span>';
  const removeBtn = $('[data-remove="' + slot + '"]');
  removeBtn.classList.add('hidden');
  if (relPath) {
    const r = await bridge.getImageUrl(relPath);
    if (r && r.ok && r.data) {
      box.innerHTML = '<img src="' + escapeAttr(r.data) + '" alt="">';
      removeBtn.classList.remove('hidden');
    }
  }
}

/* 保存角色表单 */
async function saveCharForm() {
  const name = $('#f_name').value.trim();
  if (!name) { toast('请填写姓名', 'warn'); $('#f_name').focus(); return; }
  const data = {
    name,
    alias: $('#f_alias').value.trim(),
    age: $('#f_age').value === '' ? null : Number($('#f_age').value),
    gender: $('#f_gender').value.trim(),
    race: $('#f_race').value.trim(),
    birth_date: $('#f_birth_date').value.trim(),
    birth_place: $('#f_birth_place').value.trim(),
    affiliation: $('#f_affiliation').value.trim(),
    profession: $('#f_profession').value.trim(),
    personality: $('#f_personality').value.trim(),
    abilities: collectRows('#abilitiesRows', ['name', 'description', 'level']),
    weapons: collectRows('#weaponsRows', ['name', 'type', 'description']),
    combat_stats: collectCombatStats(),
    relationships: {
      family: collectRows('#familyRows', ['name', 'description']),
      companions: collectRows('#companionsRows', ['name', 'description']),
      rivals: collectRows('#rivalsRows', ['name', 'description']),
      mentors: collectRows('#mentorsRows', ['name', 'description'])
    },
    metadata: {
      work: $('#f_work').value.trim(),
      first_appearance: $('#f_first_appearance').value.trim(),
      rarity: $('#f_rarity').value.trim(),
      tags: $('#f_tags').value.split(/[,，]/).map(s => s.trim()).filter(Boolean)
    }
  };
  const btn = $('#charModalSave');
  btn.disabled = true;
  try {
    let r;
    if (formState.editingId) {
      r = await bridge.updateCharacter(Object.assign({ id: formState.editingId }, data, {
        avatarCropData: formState.avatarCropData, portraitSrc: formState.portraitSrc,
        removeAvatar: formState.removeAvatar, removePortrait: formState.removePortrait
      }));
    } else {
      r = await bridge.createCharacter(Object.assign({}, data, {
        avatarCropData: formState.avatarCropData, portraitSrc: formState.portraitSrc
      }));
    }
    if (r && r.ok) {
      const editing = !!formState.editingId;
      closeCharForm();
      toast(editing ? '角色资料已保存' : '角色「' + name + '」已创建');
      await loadCharacters(r.data.id);
    } else {
      toast((r && r.error) || '保存失败', 'error');
    }
  } finally {
    btn.disabled = false;
  }
}

/* ---------------- 导入 / 导出 ---------------- */
/* 导出当前角色的单张角色卡（含其全部小故事） */
async function exportCurrentCard() {
  const c = state.characters.find(x => x.id === state.currentId);
  if (!c) { toast('请先选择一个角色', 'warn'); return; }
  const r = await bridge.exportCharacterCard(c.id);
  if (r && r.ok) toast('角色卡已导出：' + r.data);
  else if (!(r && r.canceled)) toast((r && r.error) || '导出失败', 'error');
}

async function exportData() {
  if (!state.characters.length) { toast('当前没有可导出的角色', 'warn'); return; }
  showConfirm('导出角色数据',
    '将把全部角色（含小故事、头像/立绘图片 base64）导出为一个 JSON 文件。\n确定继续？',
    async () => {
      const r = await bridge.exportData({ includeImages: true });
      if (r && r.ok) toast('导出成功：' + r.data);
      else if (!(r && r.canceled)) toast((r && r.error) || '导出失败', 'error');
    });
}

async function importData() {
  showConfirm('导入角色数据',
    '将从 JSON 文件导入角色与小故事（追加到当前库中，不覆盖现有数据）。\n确定继续？',
    async () => {
      const r = await bridge.importData();
      if (r && r.ok) {
        toast('导入成功：角色 ' + r.data.charCount + ' 个，故事 ' + r.data.storyCount + ' 篇');
        state.currentId = null;
        await loadCharacters();
      } else if (!(r && r.canceled)) {
        toast((r && r.error) || '导入失败', 'error');
      }
    });
}

/* ---------------- 事件绑定 ---------------- */
function bindEvents() {
  bindTabSwitching();

  // 搜索 / 筛选
  $('#searchInput').addEventListener('input', debounce(e => { state.filters.q = e.target.value; renderList(); }, 180));
  $('#filterAffiliation').addEventListener('change', e => { state.filters.affiliation = e.target.value; renderList(); });
  $('#filterRace').addEventListener('change', e => { state.filters.race = e.target.value; renderList(); });
  $('#filterTag').addEventListener('change', e => { state.filters.tag = e.target.value; renderList(); });

  // 侧边栏 角色/故事 视图切换
  $$('.side-tab').forEach(btn => btn.addEventListener('click', () => switchSideView(btn.dataset.view)));
  $('#btnNewGlobalStory').addEventListener('click', () => openGlobalStoryEditor('create', null));
  $('#btnNewGlobalStory2').addEventListener('click', () => openGlobalStoryEditor('create', null));

  // 顶部按钮
  $('#btnNew').addEventListener('click', () => openCharForm(null));
  $('#btnExport').addEventListener('click', exportData);
  $('#btnImport').addEventListener('click', importData);

  // 详情区按钮
  $('#btnEdit').addEventListener('click', () => {
    const c = state.characters.find(x => x.id === state.currentId);
    if (c) openCharForm(c);
  });
  $('#btnDelete').addEventListener('click', deleteCurrent);
  $('#btnExportCard').addEventListener('click', exportCurrentCard);
  $('#btnNewStory').addEventListener('click', () => {
    const c = state.characters.find(x => x.id === state.currentId);
    if (c) openStoryEditor('create', c.id, c.name, null);
  });

  // 独立故事详情视图
  $('#btnGSBack').addEventListener('click', () => switchSideView('chars'));
  $('#btnGSEdit').addEventListener('click', () => {
    const s = state.globalStoryCache;
    if (s) openGlobalStoryEditor('edit', s);
  });
  $('#btnGSDelete').addEventListener('click', () => {
    const s = state.globalStoryCache;
    if (!s) return;
    showConfirm('删除独立故事', '确定删除独立故事「' + s.title + '」吗？此操作不可恢复。', async () => {
      const r = await bridge.deleteStory(s.id);
      if (r && r.ok) {
        toast('故事已删除');
        renderGlobalStoryList();
        showGlobalStoryEmpty();
      } else {
        toast((r && r.error) || '删除失败', 'error');
      }
    });
  });
  // 参与角色点击 -> 跳转到对应角色（独立故事详情 + 阅读弹窗）
  $('#gsParticipants').addEventListener('click', e => {
    const card = e.target.closest('.participant-card');
    if (card) jumpToCharacterById(card.dataset.id);
  });
  $('#storyReader').addEventListener('click', e => {
    const card = e.target.closest('.participant-card');
    if (card) jumpToCharacterById(card.dataset.id);
  });

  // 小故事阅读弹窗
  $('#readerClose').addEventListener('click', closeStoryReader);
  $('#readerCloseBtn').addEventListener('click', closeStoryReader);
  $('#storyReader').addEventListener('click', e => { if (e.target === e.currentTarget) closeStoryReader(); });
  $('#readerEdit').addEventListener('click', () => {
    const rs = readerState;
    if (rs.story && rs.character) {
      closeStoryReader();
      openStoryEditor('edit', rs.character.id, rs.character.name, rs.story);
    }
  });
  $('#readerDelete').addEventListener('click', () => {
    const rs = readerState;
    if (!rs.story) return;
    showConfirm('删除小故事', '确定删除小故事「' + rs.story.title + '」吗？此操作不可恢复。', async () => {
      const r = await bridge.deleteStory(rs.story.id);
      if (r && r.ok) {
        toast('故事已删除');
        const c = state.characters.find(x => x.id === (rs.character && rs.character.id));
        if (c) renderStoriesTab(c);
        closeStoryReader();
      } else {
        toast((r && r.error) || '删除失败', 'error');
      }
    });
  });

  // 角色表单弹窗
  $('#charModalClose').addEventListener('click', closeCharForm);
  $('#charModalCancel').addEventListener('click', closeCharForm);
  // 注意：角色表单弹窗不绑定“点击遮罩外部关闭”，避免误触丢失未保存的编辑内容
  $('#charModalSave').addEventListener('click', saveCharForm);

  // 动态行添加
  $('#btnAddAbility').addEventListener('click', () => addDynRow('#abilitiesRows', [
    { cls: 'inp-wide', placeholder: '能力名称', value: '' },
    { cls: 'inp-wide', placeholder: '描述', value: '' },
    { cls: 'inp-short', placeholder: '等级(Lv)', value: '' }
  ]));
  $('#btnAddWeapon').addEventListener('click', () => addDynRow('#weaponsRows', [
    { cls: 'inp-wide', placeholder: '武器名称', value: '' },
    { cls: 'inp-short', placeholder: '类型', value: '' },
    { cls: 'inp-wide', placeholder: '描述', value: '' }
  ]));
  $('#btnAddCombatStat').addEventListener('click', () => addDynRow('#combatStatsRows', [
    { cls: 'inp-short', placeholder: '属性名(如 hp)', value: '' },
    { cls: 'inp-short', placeholder: '数值', value: '' }
  ]));
  $$('[data-add-rel]').forEach(btn => btn.addEventListener('click', () =>
    addDynRow('#' + btn.dataset.addRel + 'Rows', [
      { cls: 'inp-wide', placeholder: '角色名', value: '' },
      { cls: 'inp-wide', placeholder: '关系说明', value: '' }
    ])));

  // 图片选择 / 移除
  $$('[data-pick]').forEach(btn => btn.addEventListener('click', () => pickImageFor(btn.dataset.pick)));
  $$('[data-remove]').forEach(btn => btn.addEventListener('click', () => removeImageFor(btn.dataset.remove)));

  // 头像裁剪弹窗
  $('#cropCancel').addEventListener('click', closeCropModal);
  $('#cropClose').addEventListener('click', closeCropModal);
  $('#cropReset').addEventListener('click', resetCrop);
  $('#cropConfirm').addEventListener('click', confirmAvatarCrop);
  $('#cropModal').addEventListener('mousedown', e => { if (e.target === e.currentTarget) closeCropModal(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('#cropModal').classList.contains('hidden')) closeCropModal();
  });
  const cropCanvas = $('#cropCanvas');
  cropCanvas.addEventListener('mousedown', onCropMouseDown);
  window.addEventListener('mousemove', onCropMouseMove);
  window.addEventListener('mouseup', onCropMouseUp);
  cropCanvas.addEventListener('wheel', onCropWheel, { passive: false });

  // 确认弹窗
  $('#confirmOk').addEventListener('click', () => { const cb = confirmCb; closeConfirm(); if (cb) cb(); });
  $('#confirmCancel').addEventListener('click', closeConfirm);
  $('#confirmModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeConfirm(); });

  // 关系链接 / 关系图节点点击跳转
  $('#tab-relations').addEventListener('click', e => {
    const link = e.target.closest('.rel-link');
    if (link) { jumpToCharacter(link.dataset.name); return; }
    const node = e.target.closest('.graph-node');
    if (node) jumpToCharacter(node.dataset.name);
  });

  // 故事保存/删除后刷新对应视图
  bridge.onStoriesSaved(d => {
    if (!d) return;
    if (d.isGlobal) {
      renderGlobalStoryList();
      const c = state.characters.find(x => x.id === state.currentId);
      if (c && state.view === 'chars') renderParticipatedSection(c);
      if (state.view === 'stories' && state.currentGlobalStoryId) selectGlobalStory(state.currentGlobalStoryId);
      toast('故事已保存');
    } else if (d.characterId != null) {
      if (d.characterId === state.currentId) {
        const c = state.characters.find(x => x.id === d.characterId);
        if (c) { renderStoriesTab(c); renderParticipatedSection(c); }
      }
      toast('小故事已保存');
    }
  });
}

/* ---------------- 启动 ---------------- */
document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  loadCharacters();
});
