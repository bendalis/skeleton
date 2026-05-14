(function () {
  'use strict';

  var PDFJS_VERSION = '3.11.174';
  var WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + PDFJS_VERSION + '/pdf.worker.min.js';
  var MOBILE_BREAKPOINT = 768;
  var PAGE_CACHE = 6;
  var THUMB_CACHE = 24;

  if (!document.querySelector('meta[name="viewport"]')) {
    var meta = document.createElement('meta');
    meta.name = 'viewport';
    meta.content = 'width=device-width, initial-scale=1';
    document.head.appendChild(meta);
  }

  function ready() {
    var run = function () {
      if (!window.pdfjsLib) { setTimeout(run, 50); return; }
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL;
      var bag = window.__SKELETON__ || {};
      Object.keys(bag).forEach(function (slug) {
        var root = document.querySelector('.skeleton-' + slug);
        if (root && !root.dataset.booted) {
          root.dataset.booted = '1';
          boot(root, bag[slug]);
        }
      });
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run);
    } else {
      run();
    }
  }

  function LRU(cap) {
    var map = new Map();
    return {
      get: function (k) {
        if (!map.has(k)) return null;
        var v = map.get(k);
        map.delete(k); map.set(k, v);
        return v;
      },
      set: function (k, v) {
        if (map.has(k)) map.delete(k);
        map.set(k, v);
        while (map.size > cap) map.delete(map.keys().next().value);
      },
      has: function (k) { return map.has(k); },
      del: function (k) { map.delete(k); }
    };
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var ctx = this, args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function detectLogicalPages(pdf, frontSolo, backSolo) {
    var pdfTotal = pdf.numPages;
    if (pdfTotal === 0) return Promise.resolve([]);
    var dimsP = [];
    for (var i = 1; i <= pdfTotal; i++) {
      (function (n) {
        dimsP.push(pdf.getPage(n).then(function (page) {
          var v = page.getViewport({ scale: 1 });
          return { pdfPage: n, width: v.width, height: v.height };
        }));
      })(i);
    }
    return Promise.all(dimsP).then(function (dims) {
      var refWidth = dims[0].width;
      if (backSolo && dims.length > 1) refWidth = Math.min(refWidth, dims[dims.length - 1].width);
      var slots = [];
      dims.forEach(function (d) {
        var isCover = (d.pdfPage === 1 && frontSolo) || (d.pdfPage === pdfTotal && backSolo);
        if (isCover) {
          slots.push({ pdfPage: d.pdfPage, half: 'full' });
        } else if (d.width >= refWidth * 1.5) {
          slots.push({ pdfPage: d.pdfPage, half: 'left' });
          slots.push({ pdfPage: d.pdfPage, half: 'right' });
        } else {
          slots.push({ pdfPage: d.pdfPage, half: 'full' });
        }
      });
      return slots;
    });
  }

  function buildViews(logicalCount, frontSolo, backSolo, isMobile) {
    var views = [];
    if (isMobile) {
      for (var i = 1; i <= logicalCount; i++) views.push({ type: 'solo', pages: [i] });
      return views;
    }
    var idx = 0;
    if (frontSolo && logicalCount >= 1) {
      views.push({ type: 'solo-front', pages: [1] });
      idx = 1;
    }
    var endIdx = backSolo ? logicalCount - 1 : logicalCount;
    while (idx < endIdx) {
      if (idx + 1 < endIdx) {
        views.push({ type: 'spread', pages: [idx + 1, idx + 2] });
        idx += 2;
      } else {
        views.push({ type: 'solo', pages: [idx + 1] });
        idx++;
      }
    }
    if (backSolo && logicalCount >= 2) {
      views.push({ type: 'solo-back', pages: [logicalCount] });
    }
    return views;
  }

  function alignmentFor(type, isMobile) {
    if (isMobile) return 'center';
    if (type === 'solo-front') return 'right';
    if (type === 'solo-back') return 'left';
    if (type === 'solo') return 'center';
    return 'spread';
  }

  function boot(root, config) {
    var pdfjsLib = window.pdfjsLib;
    var pdf = null;
    var totalPages = 0;
    var logicalPages = [];
    var views = [];
    var index = 0;
    var isMobile = window.innerWidth <= MOBILE_BREAKPOINT;
    var pageCache = LRU(PAGE_CACHE);
    var thumbCache = LRU(THUMB_CACHE);
    var pageQueues = new Map();
    var firstPageViewport = null;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var themeKey = 'skeleton-theme-' + config.slug;
    var themeMode = sessionStorage.getItem(themeKey) || config.theme || 'auto';
    var darkMq = window.matchMedia('(prefers-color-scheme: dark)');

    if (!window.__skeletonAborts) window.__skeletonAborts = {};
    if (window.__skeletonAborts[config.slug]) {
      window.__skeletonAborts[config.slug].abort();
    }
    var abort = new AbortController();
    window.__skeletonAborts[config.slug] = abort;
    var signal = abort.signal;
    var ro = null;

    var stage = root.querySelector('.skeleton-' + config.slug + '__stage');
    var spread = root.querySelector('.skeleton-' + config.slug + '__spread');
    var indicator = root.querySelector('.skeleton-' + config.slug + '__indicator');
    var thumbsToggle = root.querySelector('.skeleton-' + config.slug + '__thumbs-toggle');
    var thumbs = root.querySelector('.skeleton-' + config.slug + '__thumbs');
    var themeBtn = root.querySelector('.skeleton-' + config.slug + '__theme');
    var prevZone = root.querySelector('.skeleton-' + config.slug + '__zone--prev');
    var nextZone = root.querySelector('.skeleton-' + config.slug + '__zone--next');
    var details = root.querySelector('.skeleton-' + config.slug + '__details');
    var tabPages = root.querySelector('.skeleton-' + config.slug + '__tab--pages');
    var tabDetails = root.querySelector('.skeleton-' + config.slug + '__tab--details');
    upgradeMarkup();
    injectRuntimeCss();
    applyTheme();
    initTabs();

    function upgradeMarkup() {
      var sl = config.slug;
      var chrome = root.querySelector('.skeleton-' + sl + '__chrome');
      if (chrome && (!tabPages || !tabDetails)) {
        var tabs = document.createElement('div');
        tabs.className = 'skeleton-' + sl + '__tabs';
        tabs.innerHTML =
          '<button class="skeleton-' + sl + '__tab skeleton-' + sl + '__tab--pages" type="button" role="tab" aria-selected="true">Pages</button>' +
          '<button class="skeleton-' + sl + '__tab skeleton-' + sl + '__tab--details" type="button" role="tab" aria-selected="false">Details</button>';
        var themeEl = chrome.querySelector('.skeleton-' + sl + '__theme');
        if (themeEl && themeEl.nextSibling) chrome.insertBefore(tabs, themeEl.nextSibling);
        else if (themeEl) chrome.appendChild(tabs);
        else chrome.insertBefore(tabs, chrome.firstChild);
        tabPages = tabs.querySelector('.skeleton-' + sl + '__tab--pages');
        tabDetails = tabs.querySelector('.skeleton-' + sl + '__tab--details');
      }
      if (!details) {
        var d = document.createElement('section');
        d.className = 'skeleton-' + sl + '__details';
        d.setAttribute('role', 'tabpanel');
        root.appendChild(d);
        details = d;
      }
      if (!root.getAttribute('data-tab')) root.setAttribute('data-tab', 'pages');
      var detailsUrl = config.detailsUrl || (details && details.getAttribute('data-url'));
      if (detailsUrl && !details.textContent.trim()) {
        fetch(detailsUrl).then(function (r) {
          if (!r.ok) throw new Error('details fetch ' + r.status);
          return r.text();
        }).then(function (html) {
          details.innerHTML = html;
          if (typeof initTabs === 'function') initTabs();
        }).catch(function () { /* silent */ });
      }
    }

    function detailsHasContent() {
      if (!details) return false;
      if (details.textContent.trim()) return true;
      return !!details.querySelector('img,iframe,hr');
    }

    function initTabs() {
      if (!tabPages || !tabDetails) return;
      if (!detailsHasContent()) {
        tabDetails.style.display = 'none';
        setTab('pages');
        return;
      }
      var tabKey = 'skeleton-tab-' + config.slug;
      var saved = sessionStorage.getItem(tabKey);
      setTab(saved === 'details' ? 'details' : 'pages');
    }

    function setTab(tab) {
      root.setAttribute('data-tab', tab);
      if (tabPages) tabPages.setAttribute('aria-selected', tab === 'pages' ? 'true' : 'false');
      if (tabDetails) tabDetails.setAttribute('aria-selected', tab === 'details' ? 'true' : 'false');
      sessionStorage.setItem('skeleton-tab-' + config.slug, tab);
    }

    function injectRuntimeCss() {
      var id = 'skeleton-rt-' + config.slug;
      var existing = document.getElementById(id);
      if (existing) existing.parentNode.removeChild(existing);
      var s = '.skeleton-' + config.slug;
      var styleEl = document.createElement('style');
      styleEl.id = id;
      styleEl.textContent =
        s + '__slot{flex:1;display:flex;align-items:center;justify-content:center;max-height:100%;min-width:0;min-height:0}' +
        s + '__slot canvas{display:block;max-width:100%;max-height:100%;width:auto;height:auto}' +
        s + '__tabs{display:flex;gap:0;align-items:stretch}' +
        s + '__tab{font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;background:transparent;border:none;cursor:pointer;padding:14px 10px;color:var(--muted);min-height:44px;border-bottom:1px solid transparent;margin-bottom:-1px}' +
        s + '__tab[aria-selected="true"]{color:var(--fg);border-bottom-color:currentColor}' +
        s + '__details{display:none;padding:24px 16px;max-width:720px;margin:0 auto;line-height:1.6;color:var(--fg);overflow:auto;flex:1}' +
        s + '[data-tab="details"] ' + s + '__details{display:block}' +
        s + '[data-tab="details"] ' + s + '__stage{display:none}' +
        s + '[data-tab="details"] ' + s + '__thumbs{display:none}' +
        s + '[data-tab="details"] ' + s + '__indicator{visibility:hidden}' +
        s + '__details h2{font-size:18px;font-weight:500;margin:24px 0 8px}' +
        s + '__details h2:first-child{margin-top:0}' +
        s + '__details h3{font-size:16px;font-weight:500;margin:20px 0 6px}' +
        s + '__details h4{font-size:14px;font-weight:500;margin:16px 0 4px}' +
        s + '__details p{margin:0 0 12px}' +
        s + '__details ul,' + s + '__details ol{margin:0 0 12px;padding-left:20px}' +
        s + '__details li{margin-bottom:4px}' +
        s + '__details a{color:var(--accent);text-decoration:underline;text-underline-offset:2px}' +
        s + '__details blockquote{margin:12px 0;padding-left:12px;border-left:1px solid var(--border);color:var(--muted)}' +
        s + '__details code{font-family:"JetBrains Mono",monospace;font-size:0.9em;background:var(--border);padding:1px 4px;border-radius:2px}' +
        s + '__details hr{border:none;border-top:1px solid var(--border);margin:24px 0}' +
        '@media (min-width:769px){' +
        s + '{height:100vh;max-height:100vh;overflow:hidden}' +
        s + '__thumbs-toggle{visibility:hidden;pointer-events:none}' +
        '}';
      document.head.appendChild(styleEl);
    }

    var source = config.pdfData ? { data: config.pdfData } : { url: config.pdfUrl };
    pdfjsLib.getDocument(source).promise.then(function (doc) {
      pdf = doc;
      totalPages = doc.numPages;
      return detectLogicalPages(doc, !!config.frontSolo, !!config.backSolo).then(function (slots) {
        logicalPages = slots;
        return doc.getPage(1).then(function (p) {
          firstPageViewport = p.getViewport({ scale: 1 });
          rebuild();
          installListeners();
          renderCurrent();
          seedThumbnails();
        });
      });
    }).catch(function (err) {
      showError(err && err.message ? err.message : 'Failed to load PDF');
    });

    function showError(msg) {
      spread.innerHTML = '';
      var box = document.createElement('div');
      box.style.padding = '24px';
      box.style.fontSize = '12px';
      box.style.color = 'var(--muted)';
      box.style.fontFamily = '"JetBrains Mono", monospace';
      box.style.letterSpacing = '0.08em';
      box.style.textTransform = 'uppercase';
      box.textContent = 'PDF unavailable: ' + msg;
      spread.appendChild(box);
    }

    function applyTheme() {
      var effective = themeMode === 'auto' ? (darkMq.matches ? 'dark' : 'light') : themeMode;
      root.setAttribute('data-theme', effective);
      if (themeBtn) themeBtn.setAttribute('data-mode', themeMode);
    }

    function cycleTheme() {
      themeMode = themeMode === 'auto' ? 'light' : themeMode === 'light' ? 'dark' : 'auto';
      sessionStorage.setItem(themeKey, themeMode);
      applyTheme();
    }

    function rebuild() {
      isMobile = window.innerWidth <= MOBILE_BREAKPOINT;
      var currentPage = views[index] ? views[index].pages[0] : 1;
      views = buildViews(logicalPages.length, !!config.frontSolo, !!config.backSolo, isMobile);
      index = 0;
      for (var i = 0; i < views.length; i++) {
        if (views[i].pages.indexOf(currentPage) !== -1) { index = i; break; }
      }
    }

    function renderCurrent() {
      var view = views[index];
      if (!view) return;
      spread.setAttribute('data-align', alignmentFor(view.type, isMobile));
      spread.innerHTML = '';
      view.pages.forEach(function (logical) {
        var slot = logicalPages[logical - 1];
        if (!slot) return;
        var slotEl = document.createElement('div');
        slotEl.className = 'skeleton-' + config.slug + '__slot';
        spread.appendChild(slotEl);
        renderSlot(slot, slotEl);
      });
      updateIndicator();
      updateActiveThumb();
      prefetchAdjacent();
    }

    function updateIndicator() {
      if (!indicator) return;
      var view = views[index];
      var page = view ? view.pages[view.pages.length - 1] : 1;
      indicator.textContent = pad(page) + ' · ' + pad(logicalPages.length);
      if (thumbsToggle) {
        thumbsToggle.textContent = 'PAGES';
      }
    }

    function drawSlot(src, slot, slotEl) {
      var canvas = document.createElement('canvas');
      var w, h, sx;
      if (slot.half === 'full') {
        w = src.width; h = src.height; sx = 0;
      } else {
        w = Math.floor(src.width / 2);
        h = src.height;
        sx = slot.half === 'left' ? 0 : src.width - w;
      }
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(src, sx, 0, w, h, 0, 0, w, h);
      slotEl.appendChild(canvas);
    }

    function queuedPageRender(pdfPage, renderFn) {
      var prev = pageQueues.get(pdfPage) || Promise.resolve();
      var next = prev.then(function () {
        return pdf.getPage(pdfPage).then(renderFn);
      });
      pageQueues.set(pdfPage, next.catch(function () {}));
      return next;
    }

    function renderSlot(slot, slotEl) {
      var key = slot.pdfPage;
      if (pageCache.has(key)) {
        drawSlot(pageCache.get(key), slot, slotEl);
        return;
      }
      var slotCount = views[index].pages.length || 1;
      var availableWidth = stage.clientWidth - 32;
      var slotWidth = slotEl.clientWidth || (slotCount > 1 ? (availableWidth - 8) / slotCount : availableWidth);
      var slotHeight = stage.clientHeight - 32;
      var multi = (slot.half === 'full') ? 1 : 2;
      queuedPageRender(slot.pdfPage, function (page) {
        if (pageCache.has(key)) {
          if (stage.contains(slotEl)) {
            slotEl.innerHTML = '';
            drawSlot(pageCache.get(key), slot, slotEl);
          }
          return;
        }
        var v1 = page.getViewport({ scale: 1 });
        var scaleByWidth = (slotWidth * multi * dpr) / v1.width;
        var scaleByHeight = slotHeight > 0 ? (slotHeight * dpr) / v1.height : Infinity;
        var scale = Math.min(scaleByWidth, scaleByHeight);
        var viewport = page.getViewport({ scale: scale });
        var canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        return page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise.then(function () {
          pageCache.set(key, canvas);
          if (stage.contains(slotEl)) {
            slotEl.innerHTML = '';
            drawSlot(canvas, slot, slotEl);
          }
        });
      });
    }

    function prefetchAdjacent() {
      if (!('requestIdleCallback' in window)) return;
      var nextView = views[index + 1];
      if (!nextView) return;
      requestIdleCallback(function () {
        var slotCount = nextView.pages.length;
        var availableWidth = stage.clientWidth - 32;
        var slotWidth = slotCount > 1 ? (availableWidth - 8) / slotCount : availableWidth;
        var slotHeight = stage.clientHeight - 32;
        nextView.pages.forEach(function (logical) {
          var slot = logicalPages[logical - 1];
          if (!slot) return;
          var key = slot.pdfPage;
          if (pageCache.has(key)) return;
          queuedPageRender(slot.pdfPage, function (page) {
            if (pageCache.has(key)) return;
            var v1 = page.getViewport({ scale: 1 });
            var multi = (slot.half === 'full') ? 1 : 2;
            var scaleByWidth = (slotWidth * multi * dpr) / v1.width;
            var scaleByHeight = slotHeight > 0 ? (slotHeight * dpr) / v1.height : Infinity;
            var scale = Math.min(scaleByWidth, scaleByHeight);
            var viewport = page.getViewport({ scale: scale });
            var canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            return page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise.then(function () {
              pageCache.set(key, canvas);
            });
          });
        });
      });
    }

    function seedThumbnails() {
      if (!thumbs) return;
      thumbs.innerHTML = '';
      var thumbW = 60;
      var thumbH = firstPageViewport ? Math.round(thumbW * (firstPageViewport.height / firstPageViewport.width)) : 80;
      for (var i = 1; i <= logicalPages.length; i++) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('data-page', i);
        btn.setAttribute('aria-label', 'Page ' + i);
        var canvas = document.createElement('canvas');
        canvas.width = thumbW;
        canvas.height = thumbH;
        btn.appendChild(canvas);
        var cap = document.createElement('span');
        cap.textContent = pad(i);
        btn.appendChild(cap);
        thumbs.appendChild(btn);
      }
      updateActiveThumb();
      generateThumbsLazy(1);
    }

    function generateThumbsLazy(start) {
      var schedule = window.requestIdleCallback || function (cb) { return setTimeout(cb, 50); };
      schedule(function () {
        var done = 0;
        var p = start;
        function step() {
          if (p > logicalPages.length || done >= 2) {
            if (p <= logicalPages.length) generateThumbsLazy(p);
            return;
          }
          if (thumbCache.has(p)) { done++; p++; step(); return; }
          var logicalIdx = p;
          var slot = logicalPages[logicalIdx - 1];
          var btn = thumbs.querySelector('[data-page="' + logicalIdx + '"]');
          if (!btn) { done++; p++; step(); return; }
          var canvas = btn.querySelector('canvas');
          queuedPageRender(slot.pdfPage, function (page) {
            var v1 = page.getViewport({ scale: 1 });
            var multi = (slot.half === 'full') ? 1 : 2;
            var scale = (60 * multi) / v1.width;
            var viewport = page.getViewport({ scale: scale });
            if (slot.half === 'full') {
              canvas.width = viewport.width;
              canvas.height = viewport.height;
              return page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise.then(function () {
                thumbCache.set(logicalIdx, true);
              });
            }
            var off = document.createElement('canvas');
            off.width = viewport.width;
            off.height = viewport.height;
            return page.render({ canvasContext: off.getContext('2d'), viewport: viewport }).promise.then(function () {
              var halfW = Math.floor(off.width / 2);
              canvas.width = halfW;
              canvas.height = off.height;
              var sx = slot.half === 'left' ? 0 : off.width - halfW;
              canvas.getContext('2d').drawImage(off, sx, 0, halfW, off.height, 0, 0, halfW, off.height);
              thumbCache.set(logicalIdx, true);
            });
          }).then(function () { done++; p++; step(); }, function () { done++; p++; step(); });
        }
        step();
      });
    }

    function updateActiveThumb() {
      if (!thumbs) return;
      var view = views[index];
      if (!view) return;
      var nodes = thumbs.querySelectorAll('button');
      nodes.forEach(function (n) { n.removeAttribute('data-active'); });
      view.pages.forEach(function (pn) {
        var btn = thumbs.querySelector('[data-page="' + pn + '"]');
        if (btn) btn.setAttribute('data-active', 'true');
      });
      var first = thumbs.querySelector('[data-active="true"]');
      if (first) {
        first.scrollIntoView({ inline: 'center', block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
      }
    }

    function go(delta) {
      var next = Math.max(0, Math.min(views.length - 1, index + delta));
      if (next === index) return;
      index = next;
      renderCurrent();
    }

    function jump(pageNum) {
      for (var i = 0; i < views.length; i++) {
        if (views[i].pages.indexOf(pageNum) !== -1) {
          index = i;
          renderCurrent();
          return;
        }
      }
    }

    function installListeners() {
      var opts = { signal: signal };
      var passive = { signal: signal, passive: true };

      if (prevZone) prevZone.addEventListener('click', function () { go(-1); }, opts);
      if (nextZone) nextZone.addEventListener('click', function () { go(1); }, opts);
      if (themeBtn) themeBtn.addEventListener('click', cycleTheme, opts);
      if (thumbsToggle) thumbsToggle.addEventListener('click', function () {
        var open = thumbs.getAttribute('data-open') === 'true';
        thumbs.setAttribute('data-open', open ? 'false' : 'true');
        thumbsToggle.setAttribute('aria-expanded', open ? 'false' : 'true');
      }, opts);
      if (thumbs) thumbs.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-page]');
        if (!btn) return;
        jump(parseInt(btn.getAttribute('data-page'), 10));
      }, opts);

      if (tabPages) tabPages.addEventListener('click', function () { setTab('pages'); }, opts);
      if (tabDetails) tabDetails.addEventListener('click', function () { setTab('details'); }, opts);

      darkMq.addEventListener('change', function () { if (themeMode === 'auto') applyTheme(); }, opts);

      document.addEventListener('keydown', function (e) {
        if (!root.isConnected) return;
        if (!root.matches(':hover') && !root.contains(document.activeElement)) return;
        if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
        else if (e.key === 'Escape' && thumbs && thumbs.getAttribute('data-open') === 'true') {
          thumbs.setAttribute('data-open', 'false');
          if (thumbsToggle) thumbsToggle.setAttribute('aria-expanded', 'false');
        }
      }, opts);

      var startX = 0, startY = 0, moved = false;
      stage.addEventListener('touchstart', function (e) {
        if (!e.touches[0]) return;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        moved = false;
      }, passive);
      stage.addEventListener('touchmove', function (e) {
        if (!e.touches[0]) return;
        var dx = e.touches[0].clientX - startX;
        var dy = e.touches[0].clientY - startY;
        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.5) moved = true;
      }, passive);
      stage.addEventListener('touchend', function (e) {
        if (!moved) return;
        var t = e.changedTouches[0];
        var dx = t.clientX - startX;
        var dy = t.clientY - startY;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          go(dx < 0 ? 1 : -1);
        }
      }, opts);

      ro = new ResizeObserver(debounce(function () {
        var wasMobile = isMobile;
        isMobile = window.innerWidth <= MOBILE_BREAKPOINT;
        if (wasMobile !== isMobile) {
          var currentPage = views[index] ? views[index].pages[0] : 1;
          rebuild();
          jump(currentPage);
        } else {
          pageCache = LRU(PAGE_CACHE);
          renderCurrent();
        }
      }, 150));
      ro.observe(stage);
      signal.addEventListener('abort', function () { if (ro) ro.disconnect(); });
    }
  }

  window.__skeletonReboot = function (slug) {
    var root = document.querySelector('.skeleton-' + slug);
    if (!root) return;
    var bag = window.__SKELETON__ || {};
    if (!bag[slug]) return;
    delete root.dataset.booted;
    root.dataset.booted = '1';
    boot(root, bag[slug]);
  };

  ready();
})();
