/* Gramnetic — content script (bundled from src/ via esbuild).
 * PLAN pipeline: Input Event -> debounce ~350ms -> changed sentence -> RTG_CHECK
 * to background worker (nspell + dictionary-en + grammar rules, all local)
 * -> Result Normalizer (bg side) -> overlay update.
 * This script only detects fields, renders underlines, and shows the suggestion
 * card. It never bundles the dictionary, so page CSPs cannot break checking.
 */
(function () {
  'use strict';

  const { currentSentenceRange } = require('./grammar');

  const CHECK_DELAY = 350; // PLAN section 5

  /* ---------------- state ---------------- */
  let enabled = true;

  const fields = new WeakMap(); // element -> record
  const allRecords = new Set();
  let cardEl = null;
  let activeErr = null; // {rec, err}
  let cardLock = false; // click-pinned vs hover preview
  let hoverTimer = null;

  chrome.storage?.local.get({ enabled: true }, (s) => {
    enabled = s.enabled !== false;
    if (!enabled) clearAllDecorations();
    else allRecords.forEach((rec) => scheduleCheck(rec, 0));
  });
  chrome.storage?.onChanged.addListener((changes) => {
    if (changes.enabled) {
      enabled = changes.enabled.newValue !== false;
      if (!enabled) { hideCard(); clearAllDecorations(); }
      else allRecords.forEach((rec) => scheduleCheck(rec, 0));
    }
  });

  /* ================= FIELD plumbing ================= */

  function getFieldText(el) {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el.value || '';
    return el.innerText ?? el.textContent ?? '';
  }

  function getCaretIndex(el) {
    try {
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el.selectionStart ?? (el.value || '').length;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return getFieldText(el).length;
      const range = sel.getRangeAt(0);
      if (!el.contains(range.startContainer)) return getFieldText(el).length;
      const pre = range.cloneRange();
      pre.selectNodeContents(el);
      pre.setEnd(range.startContainer, range.startOffset);
      return pre.toString().length;
    } catch { return 0; }
  }

  // PLAN section 6: split full text into sentence ranges for batched checking.
  function splitRanges(text) {
    const ranges = [];
    let s = 0;
    const isB = (c) => c === '.' || c === '!' || c === '?' || c === '\n';
    for (let i = 0; i < text.length; i++) {
      if (isB(text[i]) || i === text.length - 1) {
        const e = Math.min(i + 1, text.length);
        if (text.slice(s, e).trim()) ranges.push({ s, e, t: text.slice(s, e) });
        s = i + 1;
      }
    }
    return ranges;
  }

  function scheduleCheck(rec, delay = CHECK_DELAY) {
    if (!enabled) return;
    clearTimeout(rec.timer);
    rec.timer = setTimeout(() => runCheck(rec), delay);
  }

  function runCheck(rec, full = false) {
    const el = rec.el;
    // isConnected (not document.contains): the latter is false for fields
    // inside shadow roots, which would wrongly drop live editors.
    if (!el.isConnected) { allRecords.delete(rec); return; }
    if (!enabled) return;
    const text = getFieldText(el);
    if (text === rec.lastText && !full) { renderField(rec); return; }
    const prevText = rec.lastText;
    rec.lastText = text;
    const runId = ++rec.runSeq;
    // caret + focus: the word being typed is never flagged (checked once complete)
    const caret = getCaretIndex(el);
    let focused = false;
    try {
      focused = el === document.activeElement || (typeof el.matches === 'function' && el.matches(':focus'));
    } catch { focused = false; }

    let ranges;
    let incremental = false;
    if (full || !prevText || Math.abs(text.length - prevText.length) > 400 || (rec.errors.length === 0 && text.length < 2000)) {
      ranges = splitRanges(text);
    } else {
      // incremental: only the sentence around the caret (PLAN section 6)
      const [s, e] = currentSentenceRange(text, Math.min(caret, text.length));
      const t = text.slice(s, e);
      ranges = t.trim() ? [{ s, e, t }] : [];
      incremental = true;
    }
    if (!ranges.length) { rec.errors = []; renderField(rec); return; }
    if (!incremental) rec.errors = []; // full replace; batches append progressively

    // batch so no single message is huge; sent sequentially with stale guards
    const groups = [];
    let cur = [], len = 0;
    for (const r of ranges) {
      cur.push(r); len += r.t.length;
      if (len >= 1500) { groups.push(cur); cur = []; len = 0; }
    }
    if (cur.length) groups.push(cur);
    const covered = incremental ? ranges[0] : null;

    let gi = 0;
    const alive = () => runId === rec.runSeq && el.isConnected;
    const next = () => {
      if (!alive() || gi >= groups.length) return;
      const g = groups[gi++];
      chrome.runtime.sendMessage({ type: 'RTG_CHECK', ranges: g, c: caret, focused }, (res) => {
        if (!alive()) return;
        if (chrome.runtime.lastError || !res || res.pending) {
          rec.timer = setTimeout(() => runCheck(rec), chrome.runtime.lastError ? 1500 : 600);
          return;
        }
        if (rec.lastText !== text) { runCheck(rec); return; } // typed more mid-flight
        if (incremental && covered) {
          rec.errors = rec.errors.filter((er) => er.end <= covered.s || er.start >= covered.e);
          rec.errors.push(...res.errors);
        } else {
          rec.errors.push(...res.errors);
        }
        rec.errors.sort((a, b) => a.start - b.start);
        renderField(rec);
        next();
      });
    };
    next();
  }

  /* ================= TEXTAREA / INPUT overlay ================= */

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Overlay for textarea/input: a transparent sibling positioned exactly over
  // the field shows only the underlines. CRITICAL: the field itself is never
  // moved, wrapped, or reparented — frameworks (React/Vue/Svelte) crash with
  // "insertBefore ... not a child of this node" when their nodes are moved.
  // Only a new sibling is inserted, which reconcilers tolerate.
  const OVERLAY_PROPS = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing',
    'textTransform', 'textIndent', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
    'boxSizing', 'wordSpacing', 'textAlign', 'direction', 'overflowWrap', 'wordBreak'];

  function ensureBackdrop(rec) {
    const el = rec.el;
    if (rec.backdrop && !rec.backdrop.isConnected) rec.backdrop = null; // dropped by a site re-render
    if (!rec.backdrop) {
      if (!el.parentNode) return;
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      const bd = document.createElement('div');
      bd.className = 'rtg-backdrop';
      bd.setAttribute('aria-hidden', 'true');
      for (const p of OVERLAY_PROPS) { try { bd.style[p] = cs[p]; } catch {} }
      // mirror wrapping exactly: wrap="off" textareas scroll horizontally like inputs
      bd.style.whiteSpace = (el.tagName === 'INPUT' || el.getAttribute?.('wrap') === 'off') ? 'pre' : 'pre-wrap';
      bd.style.overflow = 'hidden';
      bd.style.margin = '0';
      bd.style.pointerEvents = 'none';
      el.parentNode.insertBefore(bd, el.nextSibling); // sibling only — field untouched
      el.setAttribute('spellcheck', 'false'); // avoid double native underlines
      rec.backdrop = bd;
      rec.syncScroll = () => { bd.scrollTop = el.scrollTop; bd.scrollLeft = el.scrollLeft; };
      if (!rec.hooked) {
        rec.hooked = true;
        el.addEventListener('scroll', () => { if (rec.syncScroll) rec.syncScroll(); }, { passive: true });
        new ResizeObserver(() => placeBackdrop(rec)).observe(el);
      }
    }
    placeBackdrop(rec);
  }

  function placeBackdrop(rec) {
    const el = rec.el, bd = rec.backdrop;
    if (!bd || !bd.isConnected || !el.isConnected) return;
    let cs;
    try { cs = window.getComputedStyle(el); } catch { return; }
    if (cs.display === 'none' || cs.visibility === 'hidden' || !el.offsetWidth || !el.offsetHeight) {
      bd.style.display = 'none';
      return;
    }
    bd.style.display = 'block';
    if (cs.position === 'fixed') {
      const r = el.getBoundingClientRect();
      bd.style.position = 'fixed';
      bd.style.left = r.left + 'px';
      bd.style.top = r.top + 'px';
      bd.style.width = r.width + 'px';
      bd.style.height = r.height + 'px';
      bd.style.zIndex = '2147483646';
    } else {
      // same offsetParent as the field (shared ancestors) -> exact box match
      bd.style.position = 'absolute';
      bd.style.left = el.offsetLeft + 'px';
      bd.style.top = el.offsetTop + 'px';
      bd.style.width = el.offsetWidth + 'px';
      bd.style.height = el.offsetHeight + 'px';
      const fz = parseInt(cs.zIndex, 10);
      bd.style.zIndex = String(Math.min(Number.isFinite(fz) ? fz + 1 : 3, 2147483647));
    }
    if (rec.syncScroll) rec.syncScroll();
  }

  function renderBackdrop(rec) {
    ensureBackdrop(rec);
    const bd = rec.backdrop;
    if (!bd) return;
    const el = rec.el;
    const text = getFieldText(el);
    if (!rec.errors.length) {
      bd.innerHTML = escapeHtml(text).replace(/\n$/g, '\n ').replace(/\n/g, '<br>') || '<br>';
      return;
    }
    let html = '';
    let pos = 0;
    const sorted = [...rec.errors].sort((a, b) => a.start - b.start);
    for (const err of sorted) {
      if (err.start < pos) continue; // overlap guard
      html += escapeHtml(text.slice(pos, err.start));
      const cls = err.type === 'spelling' ? 'rtg-err-spell' : err.type === 'grammar' ? 'rtg-err-grammar' : 'rtg-err-punct';
      html += `<span class="${cls}" data-err="${err.id}" style="pointer-events:auto;cursor:pointer">${escapeHtml(text.slice(err.start, err.end)) || '?'}</span>`;
      pos = err.end;
    }
    html += escapeHtml(text.slice(pos));
    bd.innerHTML = (html.replace(/\n$/g, '\n ').replace(/\n/g, '<br>') || '<br>');
    if (rec.syncScroll) rec.syncScroll();
  }

  /* ================= contenteditable highlight ================= */

  function saveCaretCE(el) {
    try {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || !el.contains(sel.getRangeAt(0).startContainer)) return null;
      const range = sel.getRangeAt(0);
      const pre = range.cloneRange();
      pre.selectNodeContents(el);
      pre.setEnd(range.startContainer, range.startOffset);
      return pre.toString().length;
    } catch { return null; }
  }

  function restoreCaretCE(el, offset) {
    if (offset == null) return;
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let acc = 0, node;
      while ((node = walker.nextNode())) {
        const len = node.textContent.length;
        if (acc + len >= offset) { range.setStart(node, offset - acc); range.collapse(true); sel.removeAllRanges(); sel.addRange(range); return; }
        acc += len;
      }
      range.selectNodeContents(el); range.collapse(false);
      sel.removeAllRanges(); sel.addRange(range);
    } catch { /* caret restore best-effort */ }
  }

  function unwrapErrors(el) {
    el.querySelectorAll('.rtg-err-spell,.rtg-err-grammar,.rtg-err-punct').forEach((sp) => {
      sp.replaceWith(document.createTextNode(sp.textContent));
    });
    el.normalize();
  }

  function renderContentEditable(rec) {
    const el = rec.el;
    if (rec.composing) return; // skip while IME composing to avoid breaking input
    const caret = saveCaretCE(el);
    unwrapErrors(el);
    if (!rec.errors.length) { if (caret != null) restoreCaretCE(el, caret); return; }

    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let acc = 0, node;
    while ((node = walker.nextNode())) { nodes.push([acc, node]); acc += node.textContent.length; }

    const findPos = (off) => {
      for (const [start, n] of nodes) {
        if (off >= start && off <= start + n.textContent.length) return [n, off - start];
      }
      return null;
    };

    // apply back-to-front so offsets stay valid
    const sorted = [...rec.errors].sort((a, b) => b.start - a.start);
    for (const err of sorted) {
      if (err.start === err.end) continue; // zero-width markers (append-?) have no CE visual
      const a = findPos(err.start), b = findPos(err.end);
      if (!a || !b || a[0] !== b[0]) continue; // skip cross-node errors (next pass catches)
      try {
        const range = document.createRange();
        range.setStart(a[0], a[1]);
        range.setEnd(b[0], b[1]);
        const sp = document.createElement('span');
        sp.className = err.type === 'spelling' ? 'rtg-err-spell' : err.type === 'grammar' ? 'rtg-err-grammar' : 'rtg-err-punct';
        sp.dataset.err = err.id;
        range.surroundContents(sp);
        nodes.length = 0;
        const w2 = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let acc2 = 0, n2;
        while ((n2 = w2.nextNode())) { nodes.push([acc2, n2]); acc2 += n2.textContent.length; }
      } catch { /* overlapping range, skip */ }
    }
    if (caret != null) restoreCaretCE(el, caret);
  }

  function renderField(rec) {
    if (!enabled) return;
    if (rec.kind === 'ce') renderContentEditable(rec);
    else renderBackdrop(rec);
  }

  function clearAllDecorations() {
    allRecords.forEach((rec) => {
      if (rec.kind === 'ce') unwrapErrors(rec.el);
      else if (rec.backdrop) rec.backdrop.innerHTML = '';
    });
  }

  /* ================= suggestion card (PLAN section 9) ================= */

  function ensureCard() {
    if (cardEl && document.contains(cardEl)) return cardEl;
    cardEl = document.createElement('div');
    cardEl.className = 'rtg-card';
    cardEl.style.display = 'none';
    document.documentElement.appendChild(cardEl);
    return cardEl;
  }

  function showCard(x, y, rec, err, lock = false) {
    activeErr = { rec, err };
    cardLock = !!lock;
    const card = ensureCard();
    const isSpell = err.type === 'spelling';
    card.innerHTML = `
      <div class="rtg-card-title"><span class="rtg-dot ${isSpell ? 'red' : 'blue'}"></span>${escapeHtml(isSpell ? 'Spelling mistake' : err.type === 'punctuation' ? 'Punctuation suggestion' : 'Grammar suggestion')}</div>
      ${err.originalText ? `<div class="rtg-card-original">${escapeHtml(err.originalText)}</div>` : ''}
      ${err.suggestions.map((s) => `<button class="rtg-card-suggest" data-sug="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('') || '<div style="color:#71717a">No suggestion</div>'}
      <div class="rtg-card-row">
        <button class="rtg-btn" data-act="ignore">Ignore</button>
        ${isSpell ? '<button class="rtg-btn" data-act="add">Add to dictionary</button>' : ''}
      </div>`;
    card.style.display = 'block';
    const r = card.getBoundingClientRect();
    card.style.left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
    card.style.top = Math.max(8, Math.min(y + 14, window.innerHeight - r.height - 8)) + 'px';

    card.querySelectorAll('[data-sug]').forEach((b) =>
      b.addEventListener('click', () => applyReplacement(activeErr.rec, activeErr.err, b.dataset.sug)));
    const ign = card.querySelector('[data-act="ignore"]');
    if (ign) ign.addEventListener('click', () => ignoreError(activeErr.rec, activeErr.err));
    const add = card.querySelector('[data-act="add"]');
    if (add) add.addEventListener('click', () => addToDictionary(activeErr.rec, activeErr.err));
  }

  function hideCard() { if (cardEl) cardEl.style.display = 'none'; activeErr = null; cardLock = false; }

  function findErr(id) {
    for (const r2 of allRecords) {
      const hit = r2.errors.find((x) => x.id === id);
      if (hit) return { rec: r2, err: hit };
    }
    return null;
  }

  // shadow-safe: events from inside shadow roots retarget to the host
  function errSpanFromEvent(e) {
    const raw = (typeof e.composedPath === 'function' && e.composedPath()[0]) || e.target;
    return raw instanceof Element ? raw.closest('.rtg-err-spell,.rtg-err-grammar,.rtg-err-punct') : null;
  }

  function cancelHoverHide() { if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; } }
  function scheduleHoverHide() {
    cancelHoverHide();
    if (cardLock) return;
    hoverTimer = setTimeout(() => { hideCard(); }, 250);
  }

  function applyReplacement(rec, err, replacement) {
    if (err.appendQuestion) {
      const el = rec.el;
      if (rec.kind === 'ce') insertTextCE(el, err.end, '?');
      else {
        el.value = el.value.slice(0, err.end) + '?' + el.value.slice(err.end);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      hideCard(); runCheck(rec, true); return;
    }
    if (err.insertText != null) {
      const el = rec.el;
      const text = getFieldText(el);
      const pos = Math.min(err.start, text.length);
      if (rec.kind === 'ce') insertTextCE(el, pos, err.insertText);
      else {
        el.value = text.slice(0, pos) + err.insertText + text.slice(pos);
        try { el.setSelectionRange(pos + err.insertText.length, pos + err.insertText.length); } catch {}
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      hideCard(); runCheck(rec, true); return;
    }
    let finalText = replacement;
    if (/^[A-Z]/.test(err.originalText) && /^[a-z]/.test(finalText))
      finalText = finalText[0].toUpperCase() + finalText.slice(1);
    const el = rec.el;
    if (rec.kind === 'ce') {
      replaceTextCE(el, err, finalText);
    } else {
      const v = el.value;
      el.value = v.slice(0, err.start) + finalText + v.slice(err.end);
      const caret = err.start + finalText.length;
      try { el.setSelectionRange(caret, caret); } catch {}
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    hideCard();
    runCheck(rec);
  }

  function replaceTextCE(el, err, finalText) {
    const spans = el.querySelectorAll(`[data-err="${CSS.escape(err.id)}"]`);
    if (spans.length) {
      spans[0].replaceWith(document.createTextNode(finalText));
      el.normalize();
    } else {
      const full = el.innerText ?? el.textContent ?? '';
      el.textContent = full.slice(0, err.start) + finalText + full.slice(err.end);
    }
  }

  function insertTextCE(el, off, ch) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let acc = 0, node;
    while ((node = walker.nextNode())) {
      const len = node.textContent.length;
      if (acc + len >= off) {
        node.textContent = node.textContent.slice(0, off - acc) + ch + node.textContent.slice(off - acc);
        return;
      }
      acc += len;
    }
  }

  function ignoreError(rec, err) {
    const key = (err.originalText || '').toLowerCase();
    if (key) {
      chrome.storage?.local.get({ ignored: [] }, ({ ignored }) => {
        if (!ignored.includes(key)) chrome.storage.local.set({ ignored: [...ignored, key] });
      });
    }
    hideCard();
    runCheck(rec, true);
  }

  function addToDictionary(rec, err) {
    chrome.runtime?.sendMessage({ type: 'RTG_ADD_WORD', word: String(err.originalText || '').toLowerCase().trim() }, () => {
      runCheck(rec, true);
    });
    hideCard();
  }

  /* ================= attach / observe (incl. shadow DOM) ================= */

  const EDITABLE_SEL = "textarea, input, [contenteditable='true'], [contenteditable=''], [role='textbox']";
  const observedRoots = new WeakSet();

  function isEditable(el) {
    if (!(el instanceof HTMLElement)) return null;
    if (el.dataset?.rtgIgnore != null) return null;
    if (el.tagName === 'TEXTAREA') return el.disabled || el.readOnly ? null : 'field';
    if (el.tagName === 'INPUT') {
      const t = (el.type || 'text').toLowerCase();
      if (!['text', 'search', 'url', 'email', ''].includes(t)) return null;
      return el.disabled || el.readOnly ? null : 'field';
    }
    if (el.isContentEditable) return 'ce';
    if (el.getAttribute?.('role') === 'textbox') return 'ce';
    return null;
  }

  function attach(el) {
    if (fields.has(el)) return;
    const kind = isEditable(el);
    if (!kind) return;
    killNativeSpellcheck(el); // ours replace the browser's curly underlines
    const rec = { el, kind, errors: [], timer: null, lastText: null, backdrop: null, composing: false, runSeq: 0 };
    fields.set(el, rec);
    allRecords.add(rec);

    el.addEventListener('input', () => { hideCardIfOutside(el); scheduleCheck(rec); }, { passive: true });
    el.addEventListener('compositionstart', () => { rec.composing = true; });
    el.addEventListener('compositionend', () => { rec.composing = false; scheduleCheck(rec, 50); });
    el.addEventListener('click', () => scheduleCheck(rec, 500)); // caret moved -> sentence may change
    el.addEventListener('keyup', (e) => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) scheduleCheck(rec, 500); });

    scheduleCheck(rec, 600); // initial pass (debounced so page load stays fast)
  }

  // Native curly underlines must never compete with ours: force spellcheck off
  // on attach, on focus, and whenever any script flips it back on.
  function killNativeSpellcheck(el) {
    try {
      if (el.getAttribute?.('spellcheck') !== 'false') el.setAttribute('spellcheck', 'false');
    } catch {}
  }

  function hideCardIfOutside(el) {
    if (activeErr && activeErr.rec.el !== el) hideCard();
  }

  function watchRoot(root) {
    if (observedRoots.has(root)) return;
    observedRoots.add(root);
    try { mo.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['spellcheck'] }); } catch {}
  }

  function pierce(node) {
    // dive into open shadow roots (many rich editors render inside them)
    try {
      const sr = node.shadowRoot;
      if (sr) {
        scan(sr);
        watchRoot(sr);
        sr.querySelectorAll('*').forEach(pierce);
      }
    } catch {}
  }

  function scan(root = document) {
    if (!enabled) return;
    try {
      root.querySelectorAll(EDITABLE_SEL).forEach((el) => { attach(el); pierce(el); });
    } catch {}
  }

  // error-span clicks (pinned card) + hovers (preview card).
  // composedPath: events from inside shadow roots retarget to the host,
  // so e.target alone would miss spans in shadow editors.
  document.addEventListener('click', (e) => {
    const t = errSpanFromEvent(e);
    if (t) {
      e.stopPropagation();
      const found = findErr(t.dataset.err);
      if (found) { cancelHoverHide(); showCard(e.clientX, e.clientY, found.rec, found.err, true); return; }
    } else if (cardEl && !cardEl.contains(e.target)) {
      hideCard();
    }
  }, true);

  // hover an underlined word -> preview card under the word; slide into the
  // card to click Replace/Ignore/Add; moving away dismisses it
  document.addEventListener('mouseover', (e) => {
    if (cardEl && cardEl.contains(e.target)) { cancelHoverHide(); return; } // inside card
    const t = errSpanFromEvent(e);
    if (t) {
      const found = findErr(t.dataset.err);
      if (found) {
        if (!activeErr || activeErr.err.id !== found.err.id) {
          const r = t.getBoundingClientRect();
          showCard(r.left, r.bottom, found.rec, found.err, false);
        } else cancelHoverHide();
        return;
      }
    }
    if (activeErr && !cardLock) scheduleHoverHide();
  }, true);

  document.addEventListener('mouseout', (e) => {
    if (!activeErr || cardLock) return;
    const to = e.relatedTarget;
    if (to instanceof Element && (cardEl?.contains(to) || to.closest?.('.rtg-err-spell,.rtg-err-grammar,.rtg-err-punct'))) return;
    scheduleHoverHide(); // mouseover on the destination re-opens/cancels as needed
  }, true);

  document.addEventListener('focusin', (e) => {
    const rootNode = e.target?.getRootNode?.();
    if (rootNode instanceof ShadowRoot) { scan(rootNode); watchRoot(rootNode); }
    const el = e.target?.closest?.(EDITABLE_SEL);
    if (el) { killNativeSpellcheck(el); attach(el); }
  });

  const mo = new MutationObserver((muts) => {
    for (const mu of muts) {
      if (mu.type === 'attributes') {
        // site flipped spellcheck back on -> force ours to win
        if (mu.target instanceof HTMLElement && mu.target.getAttribute('spellcheck') !== 'false') {
          if (isEditable(mu.target)) killNativeSpellcheck(mu.target);
        }
        continue;
      }
      for (const n of mu.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches?.(EDITABLE_SEL)) attach(n);
        try { n.querySelectorAll?.(EDITABLE_SEL).forEach(attach); } catch {}
        pierce(n);
        try { n.querySelectorAll?.('*').forEach(pierce); } catch {}
      }
    }
    schedulePlaces(); // layout above a field may have shifted: re-seat overlays
  });

  // re-seat all overlays at most once per frame (offset reads force layout)
  let placeQueued = false;
  function schedulePlaces() {
    if (placeQueued) return;
    placeQueued = true;
    const run = () => {
      placeQueued = false;
      allRecords.forEach((rec) => { if (rec.kind !== 'ce' && rec.backdrop) placeBackdrop(rec); });
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 0);
  }

  // popup diagnostics + counts
  chrome.runtime?.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg?.type === 'RTG_PAGE_STATUS' || msg?.type === 'RTG_GET_COUNTS') {
      let spelling = 0, grammar = 0;
      allRecords.forEach((rec) => rec.errors.forEach((e) => (e.type === 'spelling' ? spelling++ : grammar++)));
      sendResponse({ fields: allRecords.size, spelling, grammar });
      return true;
    }
    return false;
  });

  scan();
  try { document.querySelectorAll('*').forEach(pierce); } catch {} // one-time shadow pass
  try { window.addEventListener('resize', schedulePlaces, { passive: true }); } catch {}
  if (document.documentElement) {
    // childList: new editors · attributes: sites flipping spellcheck back on
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['spellcheck'] });
  }
})();
