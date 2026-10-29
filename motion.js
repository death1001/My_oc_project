'use strict';

/* ============================================================
 * motion.js — 统一动效控制器
 *
 * 设计原则（与 styles.css 的动效语汇一一对应）：
 *  1. 时长、曲线、位移量的唯一来源是 CSS 变量（--mo-*），
 *     本文件不重复定义魔法数字，只在变量缺失时兜底。
 *  2. 一律走 Web Animations API：可精确 cancel、天然不排队；
 *     不手写逐帧，也不用 setTimeout 串时间线。
 *  3. 动效状态与业务状态分离 —— 不读写 characters / stories，
 *     也不持有业务 id，只认 DOM 元素和分组 key。
 *  4. 只动 transform / opacity；will-change 只在进行中挂，结束即摘。
 *  5. 双闸门降级：系统「减少动态效果」或应用内开关任一开启即停。
 *
 * 对外接口（window.Motion）：
 *  - swap(key, { out, in, direction })   互斥面板切换（先出后进，水平 48px）
 *  - enter(key, el, { distance, duration, axis, direction })  单元素进入
 *  - flip(key, sourceImg, frameEl)       共享元素 FLIP
 *  - pill(host).place({ instant })       滑动背板落位（宿主内 .nav-pill + .active）
 *  - placePills(instant)                 重算全部已登记背板
 *  - dialog(el, opening)                 弹窗开合（含中途反向）
 *  - kill(key) / cancelAll()             立即取消
 *  - config / isAnimating(key)
 * ============================================================ */

(function () {
  const root = document.documentElement;

  /* ---------------- 参数读取 ---------------- */
  function readVar(name, fallback) {
    const v = getComputedStyle(root).getPropertyValue(name).trim();
    return v || fallback;
  }
  /* "220ms" / "0.22s" → 数字毫秒 */
  function toMs(v, fallback) {
    const s = String(v).trim();
    const n = parseFloat(s);
    if (!Number.isFinite(n)) return fallback;
    return /ms$/.test(s) ? n : n * 1000;
  }
  function toPx(v, fallback) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  }

  /* 低端设备判定：核心数或内存偏低时降级（只降位移与时长，不改变信息结构） */
  const cores = navigator.hardwareConcurrency || 8;
  const memory = navigator.deviceMemory || 8;
  const lite = cores <= 4 || memory <= 4;
  if (lite) root.classList.add('mo-lite');

  let cfg = buildConfig();

  function buildConfig() {
    return {
      lite: lite,
      micro: toMs(readVar('--mo-dur-micro', '140ms'), 140),   // 悬停变色
      fast: toMs(readVar('--mo-dur-fast', '160ms'), 160),     // 局部状态切换
      base: toMs(readVar('--mo-dur-base', '200ms'), 200),     // 开关 / 弹窗
      exit: toMs(readVar('--mo-dur-exit', '90ms'), 90),       // 面板退场（快出）
      enter: toMs(readVar('--mo-dur-enter', '260ms'), 260),   // 面板入场（慢进）
      shiftX: toPx(readVar('--mo-shift-x', '48px'), 48),
      shiftY: toPx(readVar('--mo-shift-y', '48px'), 48),
      easeOut: readVar('--mo-ease-out', 'cubic-bezier(.2,1.3,.32,1)'),
      easeIn: readVar('--mo-ease-in', 'cubic-bezier(.4,0,1,1)'),
      easeFss: readVar('--mo-ease-fss', 'cubic-bezier(.22,1,.36,1)')
    };
  }

  /* ---------------- 闸门 ----------------
   * 两条闸是「或」关系：系统偏好 || 应用内开关。
   * 只查一处就会出现「设置关了但还在动」。
   */
  const mql = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  function reduced() {
    return (mql && mql.matches) || root.classList.contains('reduce-motion');
  }

  /* 系统偏好变化：重算参数并停掉在跑的动画 */
  if (mql && mql.addEventListener) {
    mql.addEventListener('change', () => {
      cfg = buildConfig();
      cancelAll();
    });
  }

  /* ---------------- 动画分组管理 ----------------
   * 同一 key 视为「同一个可打断的切换通道」：
   * 新一次切换会先 cancel 掉旧的，只有最后发起的那次有权提交 DOM 状态。
   */
  const groups = new Map();

  function run(group, el, frames, options) {
    if (!el) return Promise.resolve();
    if (reduced()) return Promise.resolve();
    const anim = el.animate(frames, options);
    group.animations.add(anim);
    el.classList.add('mo-anim');

    const settle = () => {
      group.animations.delete(anim);
      if (!group.animations.size) el.classList.remove('mo-anim');
      /* 结束后取消 fill，避免终态样式长期占用合成层 */
      try { anim.cancel(); } catch (_) { /* 已结束则忽略 */ }
    };
    anim.finished.then(settle, settle);
    return anim.finished.catch(() => { /* cancel 会 reject，正常路径不抛错 */ });
  }

  function kill(key) {
    const g = groups.get(key);
    if (!g) return;
    Array.from(g.animations).forEach(a => { try { a.cancel(); } catch (_) { /* 忽略 */ } });
    g.animations.clear();
    groups.delete(key);
  }

  function cancelAll() {
    Array.from(groups.keys()).forEach(kill);
  }

  function isAnimating(key) {
    const g = groups.get(key);
    return !!(g && g.animations.size);
  }

  /* ---------------- 滚动位置保持 ----------------
   * display:none 会丢失子树里所有滚动容器的位置；
   * 隐藏前记录、显示后还原，保证切换回来时用户还在原处。
   */
  const scrollMemo = new WeakMap();

  function walk(el, fn) {
    if (!el) return;
    fn(el);
    const nodes = el.querySelectorAll('*');
    for (let i = 0; i < nodes.length; i++) fn(nodes[i]);
  }

  function rememberScroll(el) {
    walk(el, n => { if (n.scrollTop > 0) scrollMemo.set(n, n.scrollTop); });
  }

  function restoreScroll(el) {
    walk(el, n => {
      const v = scrollMemo.get(n);
      if (v) n.scrollTop = v;
    });
  }

  /* 取元素「此刻」的视觉值：被打断后从当前帧接续，而不是闪回基态 */
  function snapshot(el) {
    const cs = getComputedStyle(el);
    const o = parseFloat(cs.opacity);
    return {
      opacity: Number.isFinite(o) ? Math.min(Math.max(o, 0), 1) : 1,
      transform: cs.transform === 'none' ? 'none' : cs.transform
    };
  }

  /* ---------------- 互斥面板切换 ----------------
   * 典型用法：侧栏两个列表（#charsView / #storiesView）、详情区两页
   * （#detail / #globalStoryDetail）—— 它们是 flex 兄弟节点，
   * 必须「先出后进」串行，否则会同时占位导致布局跳动。
   *
   * 位移固定 48px（不用百分比：长内容上百分比会飞出屏幕），
   * 退场 90ms 加速离开，入场 260ms 带回弹落位。
   */
  function swap(key, options) {
    const opts = options || {};
    const outEl = opts.out || null;
    const inEl = opts.in || null;
    const dir = opts.direction === -1 ? -1 : 1;
    const dist = opts.distance != null ? opts.distance : cfg.shiftX;

    if (!outEl && !inEl) return Promise.resolve();

    /* 已经被 display:none 的一侧不必参与动画：跳过退出阶段，
     * 否则连点时会白等一个 90ms 的「空转」把响应拖慢 */
    const outLive = !!(outEl && !outEl.classList.contains('hidden'));
    const inWasHidden = !inEl || inEl.classList.contains('hidden');

    /* 先记录当前视觉值，再取消旧动画（同一任务内新动画立刻接手，中间不产生绘制） */
    const outFrom = outLive ? snapshot(outEl) : null;
    const inFrom = inWasHidden
      ? { opacity: 0, transform: 'translateX(' + (dir * dist) + 'px)' }
      : snapshot(inEl);

    kill(key);

    const group = { animations: new Set() };
    groups.set(key, group);

    if (outLive) rememberScroll(outEl);

    const commit = () => {
      if (outEl) {
        outEl.classList.add('hidden');
        outEl.style.opacity = '';
        outEl.style.transform = '';
      }
      if (inEl) {
        inEl.classList.remove('hidden');
        restoreScroll(inEl);
      }
    };

    /* 减少动效：直接切换，不留任何过渡 */
    if (reduced()) {
      commit();
      return Promise.resolve();
    }

    const outDist = -dir * dist * 0.6;   // 退出位移略小于进入，视觉上更「收」

    let chain = Promise.resolve();
    if (outFrom && cfg.exit > 0) {
      chain = run(group, outEl, [
        { opacity: outFrom.opacity, transform: outFrom.transform },
        { opacity: 0, transform: 'translateX(' + outDist + 'px)' }
      ], { duration: cfg.exit, easing: cfg.easeIn, fill: 'both' });
    }

    return chain.then(() => {
      /* 被更新的一次切换取代了：什么都不做，把 DOM 交给接任者 */
      if (groups.get(key) !== group) return;

      commit();
      if (!inEl || cfg.enter <= 0) return;

      return run(group, inEl, [
        { opacity: inFrom.opacity, transform: inFrom.transform },
        { opacity: 1, transform: 'translateX(0px)' }
      ], { duration: cfg.enter, easing: cfg.easeOut, fill: 'both' });
    });
  }

  /* ---------------- 单元素进入（无退出阶段） ----------------
   * 用于内容区在同一「页」内刷新（切换角色 / 切换独立故事）：
   * 数据已就绪后再播，避免先闪空再填内容。
   */
  function enter(key, el, options) {
    if (!el) return Promise.resolve();
    const opts = options || {};
    kill(key);
    if (reduced()) return Promise.resolve();

    const group = { animations: new Set() };
    groups.set(key, group);

    const dir = opts.direction === -1 ? -1 : 1;
    const axis = opts.axis === 'X' ? 'X' : 'Y';
    const dist = opts.distance != null ? opts.distance : (axis === 'X' ? cfg.shiftX : 6);
    const dur = opts.duration != null ? opts.duration : cfg.fast;

    return run(group, el, [
      { opacity: 0, transform: 'translate' + axis + '(' + (dir * dist) + 'px)' },
      { opacity: 1, transform: 'translate' + axis + '(0px)' }
    ], { duration: dur, easing: cfg.easeOut, fill: 'both' });
  }

  /* ---------------- 滑动背板 ----------------
   * 选中态不是「每项自己亮一下」，而是一块浮起的卡片从旧位置滑到新位置。
   * JS 只写三个值：offsetWidth / offsetHeight / translate3d。
   *
   * 宿主（.nav-pill-host）必须 position:relative 且直接子元素里含 .nav-pill；
   * 条目必须 z-index 高于背板，且选中时不许自己再画一层底 —— 否则会盖住
   * 背板滑过去的瞬间。
   */
  const pillHosts = new Set();

  function pill(host) {
    if (!host) return null;
    const el = host.querySelector('.nav-pill');
    if (!el) return null;

    if (pillHosts.has(host) && host.__pillRec) return host.__pillRec;

    const placed = {
      el: el,
      place: function (opt) {
        const o = opt || {};
        /* 宿主不可见时（弹窗未开 / 面板隐藏）所有 offsetWidth 都是 0，
           此时落位会把背板压成 0×0，必须跳过，等可见后再来一次 */
        if (!host.offsetWidth) return;

        const items = Array.from(host.children).filter(n => n.nodeType === 1 && n !== el);
        const active = items.find(n => n.classList.contains('active'));
        if (!active) { el.classList.remove('on'); return; }

        /* 首次落位不该从旧位置滑过来 */
        const first = !!o.instant || !el.classList.contains('on');
        if (first) { el.classList.add('instant'); el.classList.remove('on'); }

        el.style.width = active.offsetWidth + 'px';
        el.style.height = active.offsetHeight + 'px';
        el.style.transform = 'translate3d(' + active.offsetLeft + 'px,' + active.offsetTop + 'px,0)';
        el.classList.add('on');
        placed._lastW = host.offsetWidth;

        if (first) {
          void el.offsetWidth;   // 强制回流，让 instant 真的生效
          if (o.hold) {
            /* 连续尺寸变化（侧栏宽度过渡 / 窗口拖拽）期间保持 instant，
               停下 220ms 后再把过渡还回来，避免背板在过渡里"追"宿主 */
            clearTimeout(placed._holdTimer);
            placed._holdTimer = setTimeout(() => el.classList.remove('instant'), 220);
          } else {
            requestAnimationFrame(() => el.classList.remove('instant'));
          }
        }
      },
      _holdTimer: null
    };

    host.__pillRec = placed;
    pillHosts.add(host);

    /* 宿主尺寸变化就重新落位。
       这条是必须的：侧栏宽度会随布局在 300⇄352 之间过渡（--t-layout 380ms），
       而 #detailTabs 会随窗口宽度变化 —— 没有这个观察者，
       背板会一直停在「上一次量到的尺寸」，表现为选中块明显偏移、盖不满标签。 */
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => {
        /* 尺寸真的变了才重算：ResizeObserver 注册时也会先回调一次，
           若每次都落位，会把刚播的过渡状态搅乱 */
        if (host.offsetWidth === placed._lastW) return;
        placed.place({ instant: true, hold: true });
      });
      ro.observe(host);
      placed._observer = ro;
    }

    return placed;
  }

  /* 窗口尺寸变化：背板位置会失效，全部瞬间重算（不许滑） */
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => placePills(true), 80);
  });

  function placePills(instant) {
    Array.from(pillHosts).forEach(host => {
      const rec = host.__pillRec;
      if (rec) rec.place({ instant: instant === true });
    });
  }

  /* ---------------- 弹窗开合 ----------------
   * 三个必须照抄的细节：
   *  ① 从「当前实际样子」起步，中途反向也不会跳到固定帧；
   *  ② 关闭过程中 inert，键盘不会钻进正在消失的弹窗；
   *  ③ 用 motion 标识判断是否被新动画接管，晚到的回调不许误关。
   * 时长 / 曲线取规范「弹窗」档：开 220ms 机关动作，关 170ms ease-in。
   */
  const dialogMotions = new WeakMap();

  function dialog(el, opening) {
    if (!el) return Promise.resolve(false);
    const open = !!opening;
    const prev = dialogMotions.get(el);

    if (!open && el.classList.contains('hidden') && !prev) return Promise.resolve(true);
    if (open && !el.classList.contains('hidden') && !prev) return Promise.resolve(true);

    const card = el.querySelector('.modal');
    const reverse = !!prev;
    const current = {
      opacity: getComputedStyle(el).opacity,
      transform: card ? getComputedStyle(card).transform : 'none'
    };
    const from = (reverse || !open)
      ? current
      : { opacity: '0', transform: 'translateY(10px) scale(.985)' };

    if (prev) prev.list.forEach(a => { try { a.cancel(); } catch (_) { /* 忽略 */ } });

    el.classList.remove('hidden');
    el.inert = !open;

    const motion = { opening: open, list: [], finished: null };
    dialogMotions.set(el, motion);

    if (!reduced() && typeof el.animate === 'function') {
      const options = {
        duration: open ? 220 : 170,
        easing: open ? 'cubic-bezier(.2,.8,.2,1)' : 'ease-in',
        fill: 'both'
      };
      motion.list.push(el.animate(
        [{ opacity: from.opacity }, { opacity: open ? 1 : 0 }], options));
      if (card) {
        motion.list.push(card.animate([
          { transform: from.transform },
          { transform: open ? 'translateY(0) scale(1)' : 'translateY(6px) scale(.985)' }
        ], options));
      }
    }

    motion.finished = Promise.allSettled(motion.list.map(a => a.finished)).then(() => {
      if (dialogMotions.get(el) !== motion) return false;   // 已被新动画接管，不要误关
      el.classList.toggle('hidden', !open);
      el.inert = false;
      motion.list.forEach(a => { try { a.cancel(); } catch (_) { /* 忽略 */ } });
      dialogMotions.delete(el);
      el.style.opacity = '';
      if (card) card.style.transform = '';
      return true;
    });

    return motion.finished;
  }

  /* ---------------- 共享元素 FLIP ----------------
   * 卡片封面 → 详情立绘框：
   * 克隆一个背景图层从「卡片封面矩形」飞到「立绘框矩形」，只对克隆体做 transform，
   * 飞行期间把真实立绘设为透明，落位后由克隆体在最后 15% 淡出交棒。
   * 之所以落到「框」而不是「图」：立绘可能是横图（contain 居中显示），
   * 与 3:4 卡片的宽高比不一致，硬套矩形必然拉伸。
   * 任一条件不满足（无立绘 / 未解码 / 尺寸悬殊 / 减少动效）则静默放弃，
   * 由面板自身的淡入兜底。
   */
  function flip(key, sourceImg, frameEl, options) {
    if (!sourceImg || !frameEl) return Promise.resolve();
    if (reduced()) return Promise.resolve();
    if (!sourceImg.complete || !sourceImg.naturalWidth) return Promise.resolve();

    const opts = options || {};
    const visibleEl = opts.requireVisible || frameEl;
    if (visibleEl.classList.contains('hidden')) return Promise.resolve();
    if (frameEl.classList.contains('hidden')) return Promise.resolve();

    const a = sourceImg.getBoundingClientRect();
    const b = frameEl.getBoundingClientRect();
    if (a.width < 8 || a.height < 8 || b.width < 8 || b.height < 8) return Promise.resolve();

    const scale = b.height / a.height;
    /* 缩放过小看不出连贯性，过大等于放大一张缩略图，都会掉质感 —— 放弃 */
    if (scale < 0.6 || scale > 4.5) return Promise.resolve();

    kill(key);
    const group = { animations: new Set() };
    groups.set(key, group);

    const clone = document.createElement('div');
    clone.className = 'mo-flip-clone';
    clone.style.left = a.left + 'px';
    clone.style.top = a.top + 'px';
    clone.style.width = a.width + 'px';
    clone.style.height = a.height + 'px';
    clone.style.backgroundImage = 'url("' + sourceImg.src + '")';
    document.body.appendChild(clone);

    const prevOpacity = visibleEl.style.opacity;
    visibleEl.style.opacity = '0';

    const dx = (b.left + b.width / 2) - (a.left + a.width / 2);
    const dy = (b.top + b.height / 2) - (a.top + a.height / 2);
    const dur = opts.duration || cfg.enter;
    const to = 'translate(' + dx + 'px, ' + dy + 'px) scale(' + scale + ')';

    return run(group, clone, [
      { transform: 'translate(0px, 0px) scale(1)', opacity: 1, easing: cfg.easeFss },
      { transform: to, opacity: 1, offset: 0.85 },
      { transform: to, opacity: 0 }
    ], { duration: dur, easing: 'linear', fill: 'both' }).then(() => {
      clone.remove();
      /* 只有仍属于最新一次 FLIP 才揭晓目标，否则交给接任者收尾 */
      if (groups.get(key) === group) visibleEl.style.opacity = prevOpacity;
    });
  }

  window.Motion = {
    swap: swap,
    enter: enter,
    flip: flip,
    pill: pill,
    placePills: placePills,
    dialog: dialog,
    kill: kill,
    cancelAll: cancelAll,
    isAnimating: isAnimating,
    reduced: reduced,
    get config() { return cfg; }
  };
})();
