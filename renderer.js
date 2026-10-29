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

/* 图标：全部引用 index.html 里的 <symbol> 精灵，颜色随 currentColor */
function icon(name, cls) {
  return '<svg class="ico' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
}

/* 图片 URL 缓存：relPath → file:// 地址（地址里已带 ?t=mtime，路径变了地址才变）
 * 目的是避免每次重渲染都为同一张图走一趟 IPC + 磁盘 stat，
 * 也让切换列表时不再发生重复解码（动画期间不做多余的重活）。 */
const imageUrlCache = new Map();
function imageUrl(relPath) {
  if (!relPath) return Promise.resolve(null);
  const hit = imageUrlCache.get(relPath);
  if (hit) return Promise.resolve({ ok: true, data: hit });
  return bridge.getImageUrl(relPath).then(r => {
    if (r && r.ok && r.data) imageUrlCache.set(relPath, r.data);
    return r;
  }).catch(() => null);
}

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
  /* 先回到「已显示但透明」的态，强制回流后再叠加 .show，
     否则 hidden（display:none）与 .show 同帧生效，过渡不会播 */
  el.className = 'toast';
  void el.offsetWidth;
  el.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast hidden'; }, 2800);
}

/* ---------------- 确认弹窗 ---------------- */
let confirmCb = null;
function showConfirm(title, message, onOk) {
  $('#confirmTitle').textContent = title;
  $('#confirmMessage').textContent = message;
  openDialog($('#confirmModal'));
  confirmCb = onOk;
}
function closeConfirm() {
  closeDialog($('#confirmModal'));
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
  pane: 'detail',              // 'detail' = 角色档案页 | 'story' = 独立故事全文页（决定转场方向）
  layout: 'list',              // 'list' = 列表视图 | 'grid' = 网格卡片视图（启动时从 localStorage 恢复）
  currentGlobalStoryId: null,  // 当前打开的独立故事 id
  globalStoryCache: null       // 当前独立故事数据（含参与者）
};

/* 动效控制器（motion.js）；缺失时退化为空实现，保证功能不受影响 */
const Motion = window.Motion || {
  swap: () => Promise.resolve(),
  enter: () => Promise.resolve(),
  flip: () => Promise.resolve(),
  pill: () => ({ place: () => {} }),
  placePills: () => {},
  dialog: (el, opening) => {
    if (el) el.classList.toggle('hidden', !opening);
    return Promise.resolve(true);
  },
  kill: () => {},
  cancelAll: () => {},
  isAnimating: () => false,
  reduced: () => false,
  config: { micro: 0, fast: 0, base: 0, exit: 0, enter: 0 }
};

/* ---------------- 弹窗开合统一入口 ----------------
 * 布局层的唯一真相仍是 .hidden（Esc 判断、遮罩点击都读它），
 * 入场 / 退场动画交给 motion.js 的 dialog()，中途反向不会跳帧。
 */
function openDialog(el) {
  if (!el) return Promise.resolve();
  return Motion.dialog(el, true);
}
function closeDialog(el) {
  if (!el) return Promise.resolve();
  return Motion.dialog(el, false);
}
function isDialogOpen(el) { return !!el && !el.classList.contains('hidden'); }

/* 滑动背板落位：宿主内 .active 变化后调用一次即可。
 * instant = true 用于「宿主刚变为可见」的场合（此时宽度才是真实值，且不该滑动）。 */
function placePill(hostSel, instant) {
  const host = typeof hostSel === 'string' ? $(hostSel) : hostSel;
  const rec = host ? Motion.pill(host) : null;
  if (rec) rec.place({ instant: !!instant });
}

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
    renderDetail(state.currentId, { animate: false }); // 数据刷新，不加动效噪音
    return;
  }
  if (state.characters.length) selectCharacter(state.characters[0].id);
  else showEmptyDetail();
}

async function selectCharacter(id, srcEl) {
  const sameChar = state.currentId === id;
  state.currentId = id;
  renderList();                       // 命中指纹时只切选中态，不重建列表
  const srcImg = srcEl ? $('.char-card-img, .avatar-img', srcEl) : null;
  await renderDetail(id, { animate: !sameChar });

  /* 共享元素：卡片封面 → 详情立绘框。
   * 列表模式的小头像放大 5 倍会糊，所以只在卡片布局下启用；
   * 无立绘（立绘图仍是 hidden）时不做，避免飞向一个空框；
   * state.currentId === id 是为了挡掉「连点后异步返回顺序错乱」的陈旧回调。 */
  if (srcImg && state.view === 'chars' && state.layout !== 'list' && state.currentId === id) {
    Motion.flip('cover-flip', srcImg, $('.portrait-frame'), { requireVisible: $('#portraitImg') });
  }
}

function showEmptyDetail() {
  state.currentId = null;
  setDetailPane('detail');        // 幂等：已在角色页则不做转场
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
const LAYOUT_KEY = 'clw:charLayout';
const LAYOUTS = ['list', 'grid', 'compact'];

/* 布局偏好持久化：列表 / 网格 / 紧凑网格 */
function loadLayout() {
  try {
    const v = localStorage.getItem(LAYOUT_KEY);
    if (LAYOUTS.includes(v)) return v;
  } catch (_) { /* localStorage 不可用时退回默认 */ }
  return 'list';
}

function saveLayout(v) {
  try { localStorage.setItem(LAYOUT_KEY, v); } catch (_) { /* 忽略 */ }
}

/* 应用布局：滚动容器 class、侧栏宽度、设置面板中的选中态 */
function applyLayout() {
  const isCards = state.layout !== 'list' && state.view === 'chars';
  const box = $('#charList');
  box.classList.toggle('grid', isCards && state.layout === 'grid');
  box.classList.toggle('compact', isCards && state.layout === 'compact');
  $('.sidebar').classList.toggle('grid-mode', isCards);
  $$('.layout-card').forEach(b => b.classList.toggle('active', b.dataset.value === state.layout));
  /* 侧栏宽度会随布局在 300⇄352 之间过渡，侧栏标签的滑动背板必须跟着重量一次，
     否则它会停在旧尺寸上（表现为选中块偏移、盖不满标签）。 */
  placePill('#sideTabs', true);
}

/* 列表模式：一行一个（头像 + 姓名/别名） */
function charItemHtml(c) {
  return '<div class="char-item' + (c.id === state.currentId ? ' active' : '') + '" data-id="' + c.id + '">' +
    '<div class="char-avatar">' +
      '<span class="avatar-fallback">' + escapeHtml((c.name || '?').charAt(0)) + '</span>' +
      '<img class="avatar-img hidden" alt="">' +
    '</div>' +
    '<div class="char-item-info">' +
      '<div class="char-item-name">' + escapeHtml(c.name || '未命名') + '</div>' +
      '<div class="char-item-alias">' + escapeHtml(c.alias || '') + '</div>' +
    '</div>' +
  '</div>';
}

/* 卡片模式（网格 / 紧凑）：长方形卡片，封面为角色立绘 */
function charCardHtml(c) {
  const aff = String(c.affiliation || '').trim();
  const showTag = !!aff && aff !== '无' && aff !== '—';
  return '<div class="char-card' + (c.id === state.currentId ? ' active' : '') + '" data-id="' + c.id +
      '" tabindex="0" role="button" aria-label="查看角色 ' + escapeAttr(c.name || '未命名') + '">' +
    '<div class="char-card-cover">' +
      '<div class="char-card-fallback">' +
        '<span class="char-card-initial">' + escapeHtml((c.name || '?').charAt(0)) + '</span>' +
        '<span class="char-card-hint">暂无立绘</span>' +
      '</div>' +
      '<img class="char-card-img hidden" alt="">' +
    '</div>' +
    (showTag ? '<div class="char-card-tag">' + escapeHtml(aff) + '</div>' : '') +
    '<div class="char-card-info">' +
      '<div class="char-card-name">' + escapeHtml(c.name || '未命名') + '</div>' +
      '<div class="char-card-alias">' + escapeHtml(c.alias || '') + '</div>' +
    '</div>' +
  '</div>';
}

/* 上一次渲染的列表指纹：命中时只切换选中态，不重建 DOM。
 * 稳定 key（角色 id）靠它来维持 —— 选中项变化不再引起整列表重建，
 * 于是滚动位置、已解码的图片、正在进行中的过渡都不会被打断。 */
let listFingerprint = '';

/* 指纹 = 布局 + 顺序 + 参与展示的字段；任一变化才需要重建 */
function charListFingerprint(list, isCards) {
  return (isCards ? state.layout : 'list') + '|' + list.map(c => [
    c.id, c.name, c.alias, c.affiliation, c.avatar_path, c.portrait_path, c.updated_at
  ].join('~')).join('§');
}

/* 只更新选中态（配合 CSS 的指示条过渡） */
function syncCharActive(box, isCards) {
  $$(isCards ? '.char-card' : '.char-item', box).forEach(el => {
    const on = Number(el.dataset.id) === state.currentId;
    el.classList.toggle('active', on);
    el.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}

async function renderList() {
  const list = filteredCharacters();
  const box = $('#charList');
  const isCards = state.layout !== 'list';
  $('#charCount').textContent = list.length;
  $('#charListEmpty').classList.toggle('hidden', list.length > 0);
  applyLayout();

  const fingerprint = charListFingerprint(list, isCards);
  if (fingerprint === listFingerprint) {
    syncCharActive(box, isCards);   // 只是换了选中项：原地切 class
    return;
  }
  listFingerprint = fingerprint;

  box.innerHTML = list.map(c => (isCards ? charCardHtml(c) : charItemHtml(c))).join('');

  const items = $$(isCards ? '.char-card' : '.char-item', box);
  // 点击时把触发元素一并传下去，供共享元素动画取封面图的起始矩形
  items.forEach(el => el.addEventListener('click', () => selectCharacter(Number(el.dataset.id), el)));
  // 卡片支持键盘操作（Tab 聚焦 + Enter/Space 进入）
  if (isCards) {
    items.forEach(el => el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectCharacter(Number(el.dataset.id), el); }
    }));
  }

  syncCharActive(box, isCards);

  // 异步加载图片：列表用头像，卡片优先用立绘（封面），没有立绘退回头像
  await Promise.all(items.map(async (el) => {
    const c = state.characters.find(x => x.id === Number(el.dataset.id));
    if (!c) return;
    const relPath = isCards ? (c.portrait_path || c.avatar_path) : c.avatar_path;
    if (!relPath) return;
    const r = await imageUrl(relPath);
    if (!r || !r.ok || !r.data) return;
    const img = $(isCards ? '.char-card-img' : '.avatar-img', el);
    const fb = $(isCards ? '.char-card-fallback' : '.avatar-fallback', el);
    if (!img || !fb) return;
    img.src = r.data;
    img.onload = () => { img.classList.remove('hidden'); fb.classList.add('hidden'); };
  }));
}

/* ---------------- 详情展示 ----------------
 * options.animate === false 时不做内容级进入动效
 * （例如外层详情页刚刚完成转场，避免两层淡入叠加） */
async function renderDetail(id, options) {
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
  // 姓名上方的小标签：种族 · 所属（都没有就整行收起）
  $('#qiRaceText').textContent = [c.race, c.affiliation]
    .map(v => String(v || '').trim())
    .filter(v => v && v !== '无' && v !== '—')
    .join(' · ');
  const pers = String(c.personality || '').split(/[,，]/).map(s => s.trim()).filter(Boolean);
  $('#qiPersonality').innerHTML = pers.map(p => '<span class="chip">' + escapeHtml(p) + '</span>').join('');

  // 立绘
  const pi = $('#portraitImg'), pf = $('#portraitFallback');
  pi.style.opacity = '';            // 兜底：清掉共享元素动画可能遗留的临时透明
  let hasPortrait = false;
  if (c.portrait_path) {
    const ir = await imageUrl(c.portrait_path);
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

  // 详情标签条此刻才真正有尺寸（此前 #detailContent 可能是 hidden），
  // 首次落位用 instant，之后的重算才允许滑动
  placePill('#detailTabs');

  // 内容级进入动效：数据填好之后才播，避免「先闪空再填字」
  if (!options || options.animate !== false) {
    Motion.enter('char-content', $('#detailContent'), { distance: 6, duration: Motion.config.fast });
  }
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

/* 关系图：SVG 径向布局，中心为当前角色，四周为关系对象（按类型着色）
 * 颜色不写死在 SVG 属性里 —— 用 .rel-<类型> 类交给 CSS 变量，
 * 深浅两套主题各自给一档明度，属性上的 fill/stroke 无法引用 var()。 */
function relationGraphHtml(c) {
  const items = [];
  REL_GROUPS.forEach(g => {
    ((c.relationships && c.relationships[g.key]) || []).forEach(it => {
      items.push({ name: it.name || '', kind: g.key });
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
    const kind = ' rel-' + it.kind;
    lines += '<line class="rel-line' + kind + '" x1="' + cx + '" y1="' + cy + '" x2="' + x + '" y2="' + y + '"/>';
    nodes += '<g class="graph-node' + kind + '" data-name="' + escapeAttr(it.name) + '" transform="translate(' + x + ' ' + y + ')">' +
      '<circle r="16"/>' +
      '<text y="5" text-anchor="middle" fill="#fff" font-size="11" font-weight="600">' + escapeHtml((it.name || '?').slice(0, 2)) + '</text>' +
      '</g>' +
      '<text x="' + x + '" y="' + (y + 32) + '" text-anchor="middle" class="graph-label" font-size="11">' + escapeHtml(it.name) + '</text>';
  });
  return '<svg class="relation-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">' +
    '<circle class="graph-center" cx="' + cx + '" cy="' + cy + '" r="24" stroke-width="2"/>' +
    '<text class="graph-center-text" x="' + cx + '" y="' + (cy + 5) + '" text-anchor="middle" font-size="12" font-weight="600">' + escapeHtml((c.name || '?').slice(0, 6)) + '</text>' +
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
          '<button type="button" class="btn btn-small" data-action="up" title="在成长时间线中上移">' + icon('up') + '</button>' +
          '<button type="button" class="btn btn-small" data-action="down" title="在成长时间线中下移">' + icon('down') + '</button>' +
          '<button type="button" class="btn btn-small" data-action="read" title="展开阅读全文">' + icon('book') + '<span>阅读</span></button>' +
          '<button type="button" class="btn btn-small" data-action="edit" title="编辑该故事">' + icon('edit') + '<span>编辑</span></button>' +
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

/* ---------------- 详情区「页面」切换 ----------------
 * #detail（角色档案页）与 #globalStoryDetail（故事全文页）是互斥的两个 section，
 * 统一由这里切换，避免各处零散地加/删 hidden 造成状态错位与方向判断失效。
 * 返回是否真的发生了转场（调用方据此决定要不要再做内容级动效，避免双层淡入）。
 */
const DETAIL_PANE_ORDER = { detail: 0, story: 1 };

function setDetailPane(name) {
  const target = name === 'story' ? 'story' : 'detail';
  if (state.pane === target) return false;                        // 幂等：已在目标页

  const direction = DETAIL_PANE_ORDER[target] > DETAIL_PANE_ORDER[state.pane] ? 1 : -1;
  const outSel = state.pane === 'story' ? '#globalStoryDetail' : '#detail';
  const inSel = target === 'story' ? '#globalStoryDetail' : '#detail';
  state.pane = target;

  Motion.swap('detail-pane', {
    out: $(outSel),
    in: $(inSel),
    kind: 'page',
    direction: direction
  });
  return true;
}

function renderGlobalStoryDetail(story) {
  const justSwitched = setDetailPane('story');
  $('#gsEmptyDetail').classList.add('hidden');
  const card = $('.panel-card', $('#globalStoryDetail'));
  card.classList.remove('hidden');
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

  // 同一「页」内换故事属于局部状态切换：内容淡入即可
  if (!justSwitched) {
    Motion.enter('story-content', card, { distance: 4, duration: Motion.config.fast });
  }
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
    if (state.view !== 'chars') switchSideView('chars');   // 从故事库回到角色视图（侧栏 + 详情一起走转场）
    else setDetailPane('detail');                          // 已在角色视图，只把详情翻回角色页
    selectCharacter(c.id);
    toast('已跳转到「' + c.name + '」');
  }
}

function showGlobalStoryEmpty() {
  state.currentGlobalStoryId = null;
  state.globalStoryCache = null;
  setDetailPane('story');                        // 幂等：已在故事页则什么都不做
  $('.panel-card', $('#globalStoryDetail')).classList.add('hidden');
  $('#gsEmptyDetail').classList.remove('hidden');
}

function switchSideView(view) {
  if (view === state.view) return;               // 幂等：连点同一项不重启动画

  const prevView = state.view;
  state.view = view;
  applyLayout();                                 // 先算布局：侧栏宽度 / 网格列数立即进入过渡

  // 1) 顶部标签选中态：底衬由滑动背板负责，条目只切文字色
  $$('.side-tab').forEach(b => {
    const on = b.dataset.view === view;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  placePill('#sideTabs');

  // 2) 侧栏内容区：淡入 + 水平位移，方向随标签顺序（前进向右、返回向左）
  Motion.swap('sidebar-list', {
    out: $(prevView === 'chars' ? '#charsView' : '#storiesView'),
    in: $(view === 'chars' ? '#charsView' : '#storiesView'),
    kind: 'local',
    direction: view === 'chars' ? -1 : 1
  });

  // 3) 右侧详情区：页面级转场（角色档案 ↔ 故事全文）
  if (view === 'stories') {
    setDetailPane('story');
    renderGlobalStoryList();
    if (state.currentGlobalStoryId) selectGlobalStory(state.currentGlobalStoryId);
    else showGlobalStoryEmpty();
  } else {
    const switched = setDetailPane('detail');
    if (state.currentId) renderDetail(state.currentId, { animate: !switched });
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
  openDialog($('#storyReader'));
}

function closeStoryReader() {
  closeDialog($('#storyReader'));
  readerState = { story: null, character: null };
}

/* ---------------- 标签页切换 ---------------- */
function bindTabSwitching() {
  $$('.tab-btn').forEach(btn => btn.addEventListener('click', () => {
    $$('.tab-btn').forEach(b => {
      const on = b === btn;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + btn.dataset.tab));
    placePill('#detailTabs');   // 背板滑到新标签
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

  openDialog($('#charModal'));
  $('#f_name').focus();
}

function closeCharForm() {
  closeDialog($('#charModal'));
}

/* 动态行编辑 */
function addDynRow(containerSel, inputs) {
  const row = document.createElement('div');
  row.className = 'dyn-row';
  row.innerHTML = inputs.map(i =>
    '<input class="dyn-input ' + (i.cls || '') + '" placeholder="' + escapeAttr(i.placeholder || '') + '" value="' + escapeAttr(i.value == null ? '' : String(i.value)) + '">'
  ).join('') +
  '<button type="button" class="btn btn-small btn-danger-ghost dyn-remove" title="删除该行">' + icon('close') + '</button>';
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
  openDialog($('#cropModal'));
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
  closeDialog($('#cropModal'));
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

/* ---------------- 设置（主题 / 布局 / 动效 / 通透度） ---------------- */
const THEME_LABELS = { light: '浅色', dark: '深色', system: '跟随系统' };

const MOTION_KEY = 'clw:reduceMotion';     // '1' | '0'
const OPACITY_KEY = 'clw:panelOpacity';    // 55–100（整数百分数）
const DEFAULT_OPACITY = 82;

function loadReduceMotion() {
  if (window.Theme && window.Theme.getReduceMotion) return window.Theme.getReduceMotion();
  try { return localStorage.getItem(MOTION_KEY) === '1'; } catch (_) { return false; }
}
function loadPanelOpacity() {
  if (window.Theme && window.Theme.getPanelOpacity) return window.Theme.getPanelOpacity();
  try {
    const n = Number(localStorage.getItem(OPACITY_KEY));
    if (Number.isFinite(n) && n >= 55 && n <= 100) return n;
  } catch (_) { /* 忽略 */ }
  return DEFAULT_OPACITY;
}

/* 面板通透度：只写 --panel-opacity，两个主题的 --panel-bg 都引用它。
 * 持久化交给 theme-init.js（首屏要读同一份值，规则只写一处）。 */
function applyPanelOpacity(v, options) {
  const opts = options || {};
  const n = Math.min(Math.max(Math.round(Number(v) || DEFAULT_OPACITY), 55), 100);
  if (window.Theme && window.Theme.setPanelOpacity) {
    if (opts.persist === false) document.documentElement.style.setProperty('--panel-opacity', String(n / 100));
    else window.Theme.setPanelOpacity(n);
  } else {
    document.documentElement.style.setProperty('--panel-opacity', String(n / 100));
    if (opts.persist !== false) {
      try { localStorage.setItem(OPACITY_KEY, String(n)); } catch (_) { /* 忽略 */ }
    }
  }
  const hint = $('#panelOpacityHint');
  if (hint) hint.textContent = n + '%';
  const range = $('#optPanelOpacity');
  if (range && Number(range.value) !== n) range.value = String(n);
  return n;
}

/* 减少动效：应用内开关，与系统偏好是「或」关系（双闸门） */
function applyReduceMotion(on, options) {
  const opts = options || {};
  const want = !!on;
  if (window.Theme && window.Theme.setReduceMotion) {
    if (opts.persist === false) document.documentElement.classList.toggle('reduce-motion', want);
    else window.Theme.setReduceMotion(want);
  } else {
    document.documentElement.classList.toggle('reduce-motion', want);
    if (opts.persist !== false) {
      try { localStorage.setItem(MOTION_KEY, want ? '1' : '0'); } catch (_) { /* 忽略 */ }
    }
  }
  const cb = $('#optReduceMotion');
  if (cb) cb.checked = want;
  if (want) Motion.cancelAll();   // 关掉正在跑的转场，避免半截停住
  return want;
}

/* 把当前偏好同步到设置面板的选中态与提示文案 */
function syncSettingsUI() {
  const pref = window.Theme ? window.Theme.get() : 'system';
  $$('#segTheme .seg-item').forEach(b => b.classList.toggle('active', b.dataset.value === pref));
  const hint = $('#themeHint');
  if (hint) {
    const actual = window.Theme ? window.Theme.current() : 'light';
    hint.textContent = pref === 'system'
      ? '跟随系统（当前' + (actual === 'light' ? '浅色' : '深色') + '）'
      : '当前' + THEME_LABELS[pref];
  }
  const rm = $('#optReduceMotion');
  if (rm) rm.checked = loadReduceMotion();
  applyPanelOpacity(loadPanelOpacity(), { persist: false });
  applyLayout();   // 同步布局卡片的选中态
}

function openSettings() {
  syncSettingsUI();
  /* 弹窗此刻才 display:flex，之前量到的 offsetWidth 都是 0，
     所以背板必须在 openDialog 之后立刻 instant 落位 */
  openDialog($('#settingsModal'));
  placePill('#segTheme', true);
}

function closeSettings() {
  closeDialog($('#settingsModal'));
}

/* 切换主题：light | dark | system，即时生效并持久化 */
function setTheme(pref) {
  if (!window.Theme) return;
  window.Theme.set(pref);
  syncSettingsUI();
  placePill('#segTheme');
  toast('主题已切换为' + THEME_LABELS[pref]);
}

/* 切换角色列表布局：list | grid | compact */
function setLayout(mode) {
  if (!LAYOUTS.includes(mode)) return;
  if (mode === state.layout) { syncSettingsUI(); return; }
  state.layout = mode;
  saveLayout(mode);
  renderList();
  syncSettingsUI();
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

  // 设置：主题 + 布局 + 动效 + 通透度
  $('#btnSettings').addEventListener('click', openSettings);
  $('#settingsClose').addEventListener('click', closeSettings);
  $('#settingsDone').addEventListener('click', closeSettings);
  $('#settingsModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeSettings(); });
  $('#settingsReset').addEventListener('click', () => {
    setTheme('system');
    setLayout('list');
    applyReduceMotion(false);
    applyPanelOpacity(DEFAULT_OPACITY);
    toast('已恢复默认设置');
  });
  $$('#segTheme .seg-item').forEach(b => b.addEventListener('click', () => setTheme(b.dataset.value)));
  $$('#segLayout .layout-card').forEach(b => b.addEventListener('click', () => setLayout(b.dataset.value)));

  $('#optReduceMotion').addEventListener('change', e => {
    applyReduceMotion(e.target.checked);
    toast(e.target.checked ? '已开启减少动效' : '已恢复完整动效');
  });
  const opacityRange = $('#optPanelOpacity');
  // 拖动时实时改样式但不落盘，松手才写 localStorage（避免每像素一次写入）
  opacityRange.addEventListener('input', e => applyPanelOpacity(e.target.value, { persist: false }));
  opacityRange.addEventListener('change', e => applyPanelOpacity(e.target.value));

  /* ---------------- 折叠区高度动画 ----------------
   * <details> 关闭时会立刻移走内容，高度无法过渡；Chromium 130 也还不支持
   * ::details-content。这里用「点击拦截 → 量高度 → animate → 结束再改 open」，
   * prev ? !prev.opening : !details.open 这一句让「动画中途再点一次」
   * 能从当前高度反向，而不是先跳回原位。
   */
  const foldMotions = new WeakMap();
  // 曲线也只在 CSS 里定义一次（--e-fold），这里读出来用
  const foldEase = getComputedStyle(document.documentElement)
    .getPropertyValue('--e-fold').trim() || 'cubic-bezier(.22,.61,.36,1)';
  document.addEventListener('click', e => {
    const summary = e.target.closest('summary');
    const details = summary && summary.parentElement;
    if (!details || !details.classList.contains('fold')) return;
    if (e.target.closest('button, a, input, select')) return;
    if (Motion.reduced()) return;              // 降级：直接交给原生开关

    e.preventDefault();
    const prev = foldMotions.get(details);
    const opening = prev ? !prev.opening : !details.open;
    const from = details.getBoundingClientRect().height;

    if (prev) prev.animation.cancel();
    details.style.height = '';
    details.open = opening;                    // 先按目标状态量最终高度
    const to = details.getBoundingClientRect().height;
    details.open = true;                       // 动画期间必须展开，否则内容不渲染
    details.style.overflow = 'hidden';

    const animation = details.animate(
      [{ height: from + 'px' }, { height: to + 'px' }],
      { duration: 220, easing: foldEase, fill: 'both' });
    foldMotions.set(details, { animation, opening });
    animation.onfinish = () => {
      if (foldMotions.get(details) && foldMotions.get(details).animation !== animation) return;
      details.open = opening;
      animation.cancel();
      details.style.height = '';
      details.style.overflow = '';
      foldMotions.delete(details);
    };
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('#settingsModal').classList.contains('hidden')) closeSettings();
  });
  // 系统主题变化时刷新设置面板上的提示
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (window.Theme && window.Theme.get() === 'system') syncSettingsUI();
    });
  }
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
  // 「返回角色」：若当前在故事库视图，侧栏与详情一起返回；否则只翻回角色详情页
  $('#btnGSBack').addEventListener('click', () => {
    if (state.view !== 'chars') switchSideView('chars');
    else setDetailPane('detail');
  });
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
  state.layout = loadLayout();   // 恢复上次选择的列表 / 网格 / 紧凑布局
  bindEvents();
  syncSettingsUI();              // 同时应用布局、动效、通透度与设置面板选中态
  placePill('#sideTabs', true);  // 首屏背板落位（此时才是真实宽度，且不该滑动）
  loadCharacters();
});
