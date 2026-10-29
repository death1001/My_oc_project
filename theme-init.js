'use strict';

/* ============================================================
 * theme-init.js — 首屏偏好预加载
 *
 * 必须在样式表之前同步执行：先把 data-theme / reduce-motion /
 * --panel-opacity 算好再让 CSS 生效，避免首屏先按默认值渲染再切换（闪屏）。
 *
 * 三份偏好共用本文件（都在 <head> 里读取，DOMContentLoaded 之前生效）：
 *   clw:theme         'light' | 'dark' | 'system'（默认 system）
 *   clw:reduceMotion  '1' | '0'                    —— 应用内「减少动效」开关
 *   clw:panelOpacity  55–100（整数百分数）          —— 面板通透度
 * ============================================================ */

(function () {
  const THEME_KEY = 'clw:theme';
  const MOTION_KEY = 'clw:reduceMotion';
  const OPACITY_KEY = 'clw:panelOpacity';
  const DEFAULT_OPACITY = 82;

  const root = document.documentElement;
  const mql = window.matchMedia('(prefers-color-scheme: dark)');

  function read(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, value); } catch (_) { /* localStorage 不可用时忽略 */ }
  }

  /* ---------------- 主题 ---------------- */
  function getPref() {
    const v = read(THEME_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
    return 'system';
  }

  function resolve(pref) {
    return pref === 'system' ? (mql.matches ? 'dark' : 'light') : pref;
  }

  function apply(pref) {
    const p = pref || getPref();
    const actual = resolve(p);
    root.setAttribute('data-theme', actual);
    root.setAttribute('data-theme-pref', p);
    return actual;
  }

  /* ---------------- 减少动效 ----------------
   * 只挂 class；具体的 .01ms 归零规则在 styles.css 的「闸 1」里。
   * 与系统偏好是「或」关系，motion.js 里同样两头都查。
   */
  function getReduceMotion() {
    return read(MOTION_KEY) === '1';
  }

  function applyReduceMotion(on) {
    root.classList.toggle('reduce-motion', !!on);
    return !!on;
  }

  /* ---------------- 面板通透度 ---------------- */
  function getPanelOpacity() {
    const n = Number(read(OPACITY_KEY));
    return (Number.isFinite(n) && n >= 55 && n <= 100) ? n : DEFAULT_OPACITY;
  }

  function applyPanelOpacity(v) {
    const n = Math.min(Math.max(Math.round(Number(v) || DEFAULT_OPACITY), 55), 100);
    root.style.setProperty('--panel-opacity', String(n / 100));
    return n;
  }

  /* ---------------- 首屏立即生效 ---------------- */
  apply();
  applyReduceMotion(getReduceMotion());
  applyPanelOpacity(getPanelOpacity());

  /* 选择「跟随系统」时，系统主题变化要实时跟随 */
  const onSchemeChange = () => { if (getPref() === 'system') apply('system'); };
  if (mql.addEventListener) mql.addEventListener('change', onSchemeChange);
  else if (mql.addListener) mql.addListener(onSchemeChange);

  window.Theme = {
    get: getPref,
    resolve: resolve,
    /* 保存并应用，返回实际生效的主题（'light' | 'dark'） */
    set: function (pref) {
      write(THEME_KEY, pref);
      return apply(pref);
    },
    /* 当前实际生效的主题 */
    current: function () { return root.getAttribute('data-theme'); },

    /* 首屏级偏好（设置面板的初始值也从这里取，避免两处解析规则不一致） */
    getReduceMotion: getReduceMotion,
    setReduceMotion: function (on) {
      write(MOTION_KEY, on ? '1' : '0');
      return applyReduceMotion(on);
    },
    getPanelOpacity: getPanelOpacity,
    setPanelOpacity: function (v) {
      const n = applyPanelOpacity(v);
      write(OPACITY_KEY, String(n));
      return n;
    }
  };
})();
