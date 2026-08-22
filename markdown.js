'use strict';

/* ============================================================
 * markdown.js — Markdown 渲染工具
 * 动态加载 node_modules 中的 marked（UMD）与 DOMPurify（UMD），
 * 渲染前先用 DOMPurify 消毒，避免注入。
 * 若库加载失败，则退化为纯文本（转义 + 换行），保证可用性。
 * ============================================================ */

(function () {
  const SCRIPT_PATHS = {
    marked: [
      'node_modules/marked/marked.min.js',
      'node_modules/marked/lib/marked.umd.js'
    ],
    dompurify: [
      'node_modules/dompurify/dist/purify.min.js'
    ]
  };

  function loadScript(src) {
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
  }

  async function loadFirst(paths) {
    for (const p of paths) {
      if (await loadScript(p)) return true;
    }
    return false;
  }

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  const MD = {
    ready: false,

    /* 初始化：加载 marked 与 DOMPurify */
    async init() {
      const ok1 = await loadFirst(SCRIPT_PATHS.marked);
      await loadFirst(SCRIPT_PATHS.dompurify);
      this.ready = ok1;
    },

    /* 将 Markdown 源码渲染为安全的 HTML 字符串 */
    render(src) {
      if (!src) return '';
      const markedLib = window.marked;
      if (!markedLib) {
        // 降级：纯文本 + 换行
        return '<p>' + escapeHtml(src).replace(/\n/g, '<br>') + '</p>';
      }
      let html;
      try {
        html = markedLib.parse(String(src), { gfm: true, breaks: true });
      } catch (_) {
        return '<p>' + escapeHtml(src).replace(/\n/g, '<br>') + '</p>';
      }
      if (window.DOMPurify) {
        try { html = window.DOMPurify.sanitize(html); } catch (_) { /* 忽略 */ }
      }
      return html;
    }
  };

  window.MD = MD;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => MD.init());
  } else {
    MD.init();
  }
})();
