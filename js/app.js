(function () {
  "use strict";

  var CFG = window.MAGAZINE || {};
  var PAGES = CFG.pages || [];
  var LINKS = window.MAGAZINE_LINKS || {};
  var A4 = 297 / 210;
  var ARROW_SPACE = 148;
  var STAGE_PAD = 28;

  var els = {
    app: document.getElementById("app"),
    stage: document.getElementById("stage"),
    loader: document.getElementById("loader"),
    loadFill: document.getElementById("load-fill"),
    loadMeta: document.getElementById("load-meta"),
    empty: document.getElementById("empty"),
    error: document.getElementById("error"),
    errorMsg: document.getElementById("error-msg"),
    retry: document.getElementById("btn-retry"),
    reader: document.getElementById("reader"),
    bookShell: document.getElementById("book-shell"),
    book: document.getElementById("book"),
    prev: document.getElementById("btn-prev"),
    next: document.getElementById("btn-next"),
    pageLabel: document.getElementById("page-label"),
    pageTotal: document.getElementById("page-total"),
    pageFill: document.getElementById("page-fill"),
    download: document.getElementById("btn-download"),
    fullscreen: document.getElementById("btn-fullscreen"),
    modal: document.getElementById("link-modal"),
    modalUrl: document.getElementById("modal-url"),
    modalOpen: document.getElementById("modal-open"),
    modalCancel: document.getElementById("modal-cancel")
  };

  var state = {
    count: 0,
    index: 0,
    layout: null,
    pageFlip: null,
    nodes: [],
    promises: [],
    booted: false
  };

  var pendingUrl = null;

  function applyConfig() {
    if (CFG.title) {
      document.title =
        CFG.title + (CFG.subtitle ? " · " + CFG.subtitle : " — Flipbook");
    }
    if (CFG.pdfPath) {
      els.download.href = CFG.pdfPath;
      if (CFG.fileName) els.download.setAttribute("download", CFG.fileName);
    } else {
      els.download.hidden = true;
    }
  }

  function setStatus(pct, text) {
    els.loadFill.style.width =
      Math.round(Math.max(0, Math.min(1, pct)) * 100) + "%";
    if (text) els.loadMeta.textContent = text;
  }

  function show(el) {
    el.hidden = false;
  }

  function hide(el) {
    el.hidden = true;
  }

  function layout() {
    var rect = els.stage.getBoundingClientRect();
    var narrow = rect.width <= 760;
    var availW = Math.max(
      rect.width - STAGE_PAD * 2 - (narrow ? 0 : ARROW_SPACE),
      220
    );
    var availH = Math.max(rect.height - STAGE_PAD * 2, 240);
    var landscape = !narrow && rect.width >= rect.height * 1.02 && availW / 2 >= 210;

    var pageW = landscape
      ? Math.min(availW / 2, availH / A4)
      : Math.min(availW, availH / A4);
    pageW = Math.min(pageW, CFG.maxPageWidth || 560);
    pageW = Math.max(180, Math.round(pageW));

    return {
      landscape: landscape,
      pageW: pageW,
      pageH: Math.round(pageW * A4),
      width: rect.width,
      height: rect.height
    };
  }

  function altFor(i) {
    if (i === 0) return "Cover";
    if (i === state.count - 1) return "Back cover";
    return "Page " + (i + 1);
  }

  function spreadRange(i) {
    if (state.count <= 1) return { from: 0, to: 0 };
    if (i <= 0) return { from: 0, to: 0 };
    var left = i % 2 ? i : i - 1;
    var right = left + 1;
    return {
      from: Math.min(left, state.count - 1),
      to: Math.min(right, state.count - 1)
    };
  }

  function labelFor(i) {
    if (!state.count) return "—";
    if (i <= 0) return "Cover";
    if (i >= state.count - 1) return "Back cover";
    var r = spreadRange(i);
    if (r.from === r.to) return "Page " + (i + 1);
    return "Pages " + (r.from + 1) + "–" + (r.to + 1);
  }

  function soloFor(i) {
    if (!state.layout || !state.layout.landscape || state.count <= 1) return "";
    if (i <= 0) return "right";
    if (i >= state.count - 1) return "left";
    return "";
  }

  function updateChrome() {
    var i = state.index;
    els.pageLabel.textContent = labelFor(i);
    els.pageTotal.textContent = state.count ? state.count + " pages" : "—";
    els.pageFill.style.width =
      (state.count > 1 ? (i / (state.count - 1)) * 100 : 100).toFixed(1) + "%";
    els.prev.disabled = i <= 0;
    els.next.disabled = i >= state.count - 1;
    if (els.book) els.book.setAttribute("data-solo", soloFor(i));
  }

  function addHotspots(div, pagePath) {
    var spots = LINKS[pagePath];
    if (!spots || !spots.length) return;
    spots.forEach(function (s) {
      var a = document.createElement("a");
      a.className = "qr-hotspot";
      a.href = s.url;
      a.setAttribute("aria-label", "Open link: " + s.url);
      a.title = s.url;
      a.style.left = (s.x * 100).toFixed(4) + "%";
      a.style.top = (s.y * 100).toFixed(4) + "%";
      a.style.width = (s.w * 100).toFixed(4) + "%";
      a.style.height = (s.h * 100).toFixed(4) + "%";
      ["pointerdown", "mousedown", "touchstart", "click"].forEach(function (ev) {
        a.addEventListener(ev, function (e) {
          e.stopPropagation();
        });
      });
      a.addEventListener("click", function (e) {
        e.preventDefault();
        openLinkModal(s.url);
      });
      div.appendChild(a);
    });
  }

  function openLinkModal(url) {
    pendingUrl = url;
    els.modalUrl.textContent = url;
    els.modal.hidden = false;
    els.modalOpen.focus();
  }

  function closeLinkModal() {
    els.modal.hidden = true;
    pendingUrl = null;
  }

  function build(startIndex) {
    if (state.pageFlip) {
      try {
        state.pageFlip.destroy();
      } catch (e) {}
      state.pageFlip = null;
    }

    // destroy() removes the container element itself, so always start from a
    // fresh node re-attached to the shell (otherwise the book detaches on rebuild).
    els.bookShell.innerHTML = "";
    var startIdx = Math.max(0, Math.min(startIndex, state.count - 1));
    var book = document.createElement("div");
    book.className = "book";
    book.id = "book";
    // Set before attaching so the solo shift never animates on first paint.
    book.setAttribute("data-solo", soloFor(startIdx));
    els.bookShell.appendChild(book);
    els.book = book;

    var L = state.layout;
    book.style.width = (L.landscape ? L.pageW * 2 : L.pageW) + "px";
    book.style.height = L.pageH + "px";

    var nodes = [];
    var promises = [];
    for (var i = 0; i < state.count; i++) {
      (function (i) {
        var div = document.createElement("div");
        div.className = "fb-page is-loading";
        var img = document.createElement("img");
        img.alt = altFor(i);
        img.decoding = "async";
        div.appendChild(img);

        var resolve;
        promises[i] = new Promise(function (res) {
          resolve = res;
        });
        var settle = function (ok) {
          div.classList.remove("is-loading");
          resolve(ok);
        };
        img.addEventListener("load", function () {
          settle(true);
        });
        img.addEventListener("error", function () {
          settle(false);
        });

        img.src = PAGES[i];
        if (img.complete) settle(img.naturalWidth > 0);

        addHotspots(div, PAGES[i]);
        nodes.push(div);
      })(i);
    }
    state.nodes = nodes;
    state.promises = promises;

    state.pageFlip = new St.PageFlip(book, {
      width: L.pageW,
      height: L.pageH,
      size: "fixed",
      drawShadow: true,
      flippingTime: 480,
      usePortrait: true,
      startZIndex: 0,
      startPage: startIdx,
      autoSize: false,
      maxShadowOpacity: 0.55,
      showCover: true,
      mobileScrollSupport: false,
      swipeDistance: 30,
      useMouseEvents: true,
      disableFlipByClick: false,
      clickEventForward: true
    });

    state.pageFlip.loadFromHTML(nodes);
    state.pageFlip.on("flip", function (e) {
      state.index = e.data;
      updateChrome();
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, "", "#page=" + (state.index + 1));
      }
    });

    state.index = startIdx;
    updateChrome();
  }

  function waitFor(indices, onStep) {
    var done = 0;
    return Promise.all(
      indices.map(function (i) {
        return state.promises[i].then(function (ok) {
          done++;
          if (onStep) onStep(done, indices.length, i);
          return ok;
        });
      })
    );
  }

  function viewIndices() {
    var r = spreadRange(state.index);
    var out = [];
    for (var k = r.from; k <= r.to; k++) out.push(k);
    return out;
  }

  function targetNext() {
    var i = state.index;
    if (!state.layout || !state.layout.landscape || state.count < 3) {
      return Math.min(state.count - 1, i + 1);
    }
    var right = i <= 0 ? 0 : i % 2 ? i + 1 : i;
    return Math.min(state.count - 1, right + 1);
  }

  function targetPrev() {
    var i = state.index;
    if (!state.layout || !state.layout.landscape || state.count < 3) {
      return Math.max(0, i - 1);
    }
    var left = i <= 0 ? 0 : i % 2 ? i : i - 1;
    return Math.max(0, left - 1);
  }

  function go(target) {
    if (!state.pageFlip) return;
    if (target === state.index) return;
    state.pageFlip.turnToPage(target);
  }

  function startIndexFromHash() {
    var match = /page=(\d+)/.exec(window.location.hash || "");
    if (!match) return 0;
    var n = parseInt(match[1], 10);
    if (!n || n < 1) return 0;
    return Math.min(n - 1, state.count - 1);
  }

  function bindControls() {
    els.prev.addEventListener("click", function () {
      go(targetPrev());
    });
    els.next.addEventListener("click", function () {
      go(targetNext());
    });

    document.addEventListener("keydown", function (e) {
      if (!state.booted || e.metaKey || e.ctrlKey || e.altKey) return;
      var tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (!els.modal.hidden) {
        if (e.key === "Escape") {
          e.preventDefault();
          closeLinkModal();
        }
        return;
      }
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault();
        go(targetNext());
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        go(targetPrev());
      } else if (e.key === "Home") {
        e.preventDefault();
        go(0);
      } else if (e.key === "End") {
        e.preventDefault();
        go(state.count - 1);
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        toggleFullscreen();
      }
    });

    els.fullscreen.addEventListener("click", toggleFullscreen);

    els.modalCancel.addEventListener("click", closeLinkModal);
    els.modal.addEventListener("click", function (e) {
      if (e.target === els.modal) closeLinkModal();
    });
    els.modalOpen.addEventListener("click", function () {
      if (pendingUrl) window.open(pendingUrl, "_blank", "noopener,noreferrer");
      closeLinkModal();
    });

    els.retry.addEventListener("click", function () {
      hide(els.error);
      boot();
    });

    var timer = null;
    window.addEventListener("resize", function () {
      if (!state.booted || !state.layout) return;
      clearTimeout(timer);
      timer = setTimeout(function () {
        var next = layout();
        var changed =
          next.landscape !== state.layout.landscape ||
          Math.abs(next.pageW - state.layout.pageW) > 24;
        if (!changed) return;
        var idx = state.index;
        state.layout = next;
        build(idx);
      }, 220);
    });
  }

  function toggleFullscreen() {
    var el = els.app;
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      if (document.exitFullscreen) document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    } else if (el.requestFullscreen) {
      el.requestFullscreen()["catch"](function () {});
    } else if (el.webkitRequestFullscreen) {
      el.webkitRequestFullscreen();
    }
  }

  function boot() {
    state.booted = false;
    hide(els.empty);
    hide(els.error);
    hide(els.reader);

    if (!PAGES.length) {
      hide(els.loader);
      show(els.empty);
      return;
    }

    state.count = PAGES.length;
    state.layout = layout();
    var start = startIndexFromHash();
    setStatus(0.1, "Loading pages…");

    // The book must be laid out while visible: the flip library measures its
    // container at construction time and mispositions pages if it is hidden.
    show(els.reader);
    show(els.loader);
    build(start);

    waitFor(viewIndices(), function (done, total, i) {
      setStatus(
        0.1 + 0.9 * (done / total),
        "Loading page " + (i + 1) + " of " + state.count
      );
    }).then(function (oks) {
      if (oks.every(function (ok) {
        return !ok;
      })) {
        hide(els.reader);
        hide(els.loader);
        els.errorMsg.textContent = "The page images could not be loaded.";
        show(els.error);
        return;
      }
      setStatus(1, "Ready");
      state.booted = true;
      hide(els.loader);
      updateChrome();
    });
  }

  applyConfig();
  bindControls();
  boot();
})();
