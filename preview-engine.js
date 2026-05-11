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

  function buildViews(total, frontSolo, backSolo, isMobile) {
    var views = [];
    if (isMobile) {
      for (var i = 1; i <= total; i++) views.push({ type: 'solo', pages: [i] });
      return views;
    }
    var start = 1, end = total;
    if (frontSolo && total >= 1) {
      views.push({ type: 'solo-front', pages: [1] });
      start = 2;
    }
    if (backSolo && total >= 2 && total !== start - 1) {
      end = total - 1;
    }
    var p = start;
    while (p + 1 <= end) {
      views.push({ type: 'spread', pages: [p, p + 1] });
      p += 2;
    }
    if (p === end) {
      views.push({ type: 'solo', pages: [p] });
    }
    if (backSolo && total >= 2 && total !== (start - 1)) {
      views.push({ type: 'solo-back', pages: [total] });
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
    var views = [];
    var index = 0;
    var isMobile = window.innerWidth <= MOBILE_BREAKPOINT;
    var pageCache = LRU(PAGE_CACHE);
    var thumbCache = LRU(THUMB_CACHE);
    var inFlightRenders = new Map();
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
    applyTheme();

    var source = config.pdfData ? { data: config.pdfData } : { url: config.pdfUrl };
    pdfjsLib.getDocument(source).promise.then(function (doc) {
      pdf = doc;
      totalPages = doc.numPages;
      return doc.getPage(1).then(function (p) {
        firstPageViewport = p.getViewport({ scale: 1 });
        rebuild();
        installListeners();
        renderCurrent();
        seedThumbnails();
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
      views = buildViews(totalPages, !!config.frontSolo, !!config.backSolo, isMobile);
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
      view.pages.forEach(function (pageNum) {
        var slot = document.createElement('div');
        slot.className = 'skeleton-' + config.slug + '__slot';
        spread.appendChild(slot);
        renderPage(pageNum, slot);
      });
      updateIndicator();
      updateActiveThumb();
      prefetchAdjacent();
    }

    function updateIndicator() {
      if (!indicator) return;
      var view = views[index];
      var page = view ? view.pages[view.pages.length - 1] : 1;
      indicator.textContent = pad(page) + ' · ' + pad(totalPages);
      if (thumbsToggle) {
        thumbsToggle.textContent = 'PAGES ' + pad(page) + '·' + pad(totalPages);
      }
    }

    function renderPage(pageNum, slot) {
      if (pageCache.has(pageNum)) {
        var cached = pageCache.get(pageNum);
        slot.appendChild(cached.cloneNode(true));
        return;
      }
      pdf.getPage(pageNum).then(function (page) {
        if (!stage.contains(slot)) return;
        var slotWidth = slot.clientWidth || (stage.clientWidth / (views[index].pages.length || 1)) - 16;
        var v1 = page.getViewport({ scale: 1 });
        var scale = (slotWidth * dpr) / v1.width;
        var viewport = page.getViewport({ scale: scale });
        var canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = (viewport.width / dpr) + 'px';
        canvas.style.height = (viewport.height / dpr) + 'px';
        var ctx = canvas.getContext('2d');
        var task = page.render({ canvasContext: ctx, viewport: viewport });
        inFlightRenders.set(pageNum, task);
        task.promise.then(function () {
          inFlightRenders.delete(pageNum);
          pageCache.set(pageNum, canvas);
          if (stage.contains(slot)) {
            slot.innerHTML = '';
            slot.appendChild(canvas.cloneNode(true));
            var c2 = slot.querySelector('canvas');
            c2.getContext('2d').drawImage(canvas, 0, 0);
          }
        }).catch(function () {
          inFlightRenders.delete(pageNum);
        });
      });
    }

    function prefetchAdjacent() {
      if (!('requestIdleCallback' in window)) return;
      var nextView = views[index + 1];
      if (!nextView) return;
      requestIdleCallback(function () {
        nextView.pages.forEach(function (pn) {
          if (pageCache.has(pn)) return;
          pdf.getPage(pn).then(function (page) {
            var slotWidth = stage.clientWidth / 2 - 16;
            var v1 = page.getViewport({ scale: 1 });
            var scale = (slotWidth * dpr) / v1.width;
            var viewport = page.getViewport({ scale: scale });
            var canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise.then(function () {
              pageCache.set(pn, canvas);
            }).catch(function () {});
          });
        });
      });
    }

    function seedThumbnails() {
      if (!thumbs) return;
      thumbs.innerHTML = '';
      var thumbW = 60;
      var thumbH = firstPageViewport ? Math.round(thumbW * (firstPageViewport.height / firstPageViewport.width)) : 80;
      for (var i = 1; i <= totalPages; i++) {
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
          if (p > totalPages || done >= 2) {
            if (p <= totalPages) generateThumbsLazy(p);
            return;
          }
          if (thumbCache.has(p)) { done++; p++; step(); return; }
          var pageNum = p;
          pdf.getPage(pageNum).then(function (page) {
            var v1 = page.getViewport({ scale: 1 });
            var scale = 60 / v1.width;
            var viewport = page.getViewport({ scale: scale });
            var btn = thumbs.querySelector('[data-page="' + pageNum + '"]');
            if (!btn) return;
            var canvas = btn.querySelector('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise.then(function () {
              thumbCache.set(pageNum, true);
              done++;
              p++;
              step();
            }).catch(function () { done++; p++; step(); });
          });
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
