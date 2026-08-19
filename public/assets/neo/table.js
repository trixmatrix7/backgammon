/* ==========================================================================
   NEO TABLE — the shared engine behind every design
   --------------------------------------------------------------------------
   Each design owns its own markup and CSS. What they all share is this:

     measureBoard()  reads the twelve column centres and the point depth OUT OF
                     THE PICTURE at runtime, so a new board can be dropped in
                     and everything lands on it without a single hand-typed
                     coordinate. This is the part that used to be a week of
                     manual tracing.
     renderBoard()   draws checkers, landing spots, dice and the cube into a
                     layer over the board, all in percentages of the picture.
     makeSFX()       a tiny synth so a design's sound direction is audible
                     without shipping a single audio file.
     wireScreens()   [data-screen] / [data-goto] navigation between the table,
                     the lobby, the scoreline and the payout.
   ========================================================================== */

(function (global) {
  "use strict";

  // ── geometry ─────────────────────────────────────────────────────────────

  /**
   * Find the board's playing grid by looking at the board.
   *
   * The middle band of a backgammon board is always empty, so the pixel at the
   * dead centre is a reliable sample of the GROUND colour. Everything far
   * enough from that colour is a point. One scanline near the top edge — where
   * every point is at full width — gives twelve runs, and their centres are the
   * twelve columns. Row coverage then gives how far the points reach in.
   *
   * Falls back to an even grid if a board is too stylised to read (a wireframe
   * board is mostly ground, for instance), and any design can override.
   */
  function measureBoard(img, override) {
    var w = img.naturalWidth, h = img.naturalHeight;
    var out = { ar: w / h, cols: null, topTip: 0.38, botTip: 0.63, measured: false };
    if (override && override.cols) {
      return Object.assign(out, override, { measured: true });
    }
    try {
      var c = document.createElement("canvas");
      c.width = w; c.height = h;
      var ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);

      var ground = ctx.getImageData(Math.round(w / 2), Math.round(h / 2), 1, 1).data;
      var far = function (d, i) {
        return Math.abs(d[i] - ground[0]) + Math.abs(d[i + 1] - ground[1]) + Math.abs(d[i + 2] - ground[2]) > 70;
      };

      // twelve columns, off one scanline near the top edge
      var line = ctx.getImageData(0, Math.round(h * 0.05), w, 1).data;
      var runs = [], start = -1;
      for (var x = 0; x < w; x++) {
        if (far(line, x * 4)) { if (start < 0) start = x; }
        else if (start >= 0) { runs.push([start, x - 1]); start = -1; }
      }
      if (start >= 0) runs.push([start, w - 1]);
      runs = runs.filter(function (r) { return r[1] - r[0] > w * 0.018; });

      if (runs.length >= 12) {
        // if the divider bar also registered, drop the run nearest the centre
        while (runs.length > 12) {
          var mid = w / 2, worst = 0, dist = Infinity;
          runs.forEach(function (r, i) {
            var d = Math.abs((r[0] + r[1]) / 2 - mid);
            if (d < dist) { dist = d; worst = i; }
          });
          runs.splice(worst, 1);
        }
        out.cols = runs.map(function (r) { return (r[0] + r[1]) / 2 / w; });
        out.measured = true;
      }

      // how far the points reach: the rows where coverage collapses to nothing
      var first = -1, last = -1;
      for (var y = 0; y < h; y += 2) {
        var row = ctx.getImageData(0, y, w, 1).data, n = 0;
        for (var px = 0; px < w; px++) if (far(row, px * 4)) n++;
        if (n / w < 0.07) { if (first < 0) first = y; last = y; }
      }
      if (first > h * 0.2 && last < h * 0.8) {
        out.topTip = first / h;
        out.botTip = last / h;
      }
    } catch (e) {
      /* tainted canvas or an unreadable board — the fallback grid still plays */
    }

    if (!out.cols) {
      // symmetric fallback: two halves of six, a gap in the middle for the bar
      out.cols = [];
      for (var i = 0; i < 6; i++) out.cols.push(0.055 + i * 0.0768);
      for (var j = 0; j < 6; j++) out.cols.push(0.561 + j * 0.0768);
    }
    if (override) Object.assign(out, override);
    return out;
  }

  /** Point number (1..24, from the seated player's view) → its column centre, in %. */
  function colX(geom, n) {
    var i = n <= 6 ? 11 - (6 - n) : n <= 12 ? 12 - n : n - 13;
    return geom.cols[i] * 100;
  }
  var isTop = function (n) { return n >= 13; };

  // ── the pieces ───────────────────────────────────────────────────────────

  var PIP = {
    1: [[50, 50]],
    2: [[28, 28], [72, 72]],
    3: [[26, 26], [50, 50], [74, 74]],
    4: [[28, 28], [72, 28], [28, 72], [72, 72]],
    5: [[26, 26], [74, 26], [50, 50], [26, 74], [74, 74]],
    6: [[30, 24], [70, 24], [30, 50], [70, 50], [30, 76], [70, 76]]
  };
  /** Pips by coordinate, never by a padded grid: percentage padding resolves against the
   *  CONTAINING BLOCK's width, which on a small die means the board's width. */
  function pips(v) {
    return (PIP[v] || PIP[1]).map(function (p) {
      return '<i style="left:' + p[0] + '%;top:' + p[1] + '%"></i>';
    }).join("");
  }

  /**
   * Draw the whole play layer. `pos` is the position on show; `opt.chip` is the
   * checker width as a fraction of the board's width.
   */
  function renderBoard(layer, geom, pos, opt) {
    opt = opt || {};
    var CHIP = opt.chip || 0.066;
    var cw = CHIP * 100;                 // checker width, % of board WIDTH
    var ch = CHIP * geom.ar * 100;       // the same length, % of board HEIGHT
    var h = "";

    function stack(n, count, ink) {
      var x = colX(geom, n), top = isTop(n);
      var room = (top ? geom.topTip : 1 - geom.botTip) * 100;
      var step = Math.min(ch * 0.86, (room - ch * 0.6) / Math.max(count - 1, 1));
      for (var i = 0; i < count; i++) {
        var y = top ? ch * 0.62 + i * step : 100 - ch * 0.62 - i * step;
        var isTopChip = i === count - 1;
        var cls = "chk " + ink +
          (n === pos.sel && isTopChip ? " sel" : "") +
          (pos.can && pos.can.indexOf(n) >= 0 && isTopChip ? " can" : "");
        h += '<span class="' + cls + '" style="left:' + x + "%;top:" + y +
          "%;width:" + cw + "%;z-index:" + (10 + i) + '"></span>';
      }
    }
    Object.keys(pos.w).forEach(function (n) { stack(+n, pos.w[n], "w"); });
    Object.keys(pos.b).forEach(function (n) { stack(+n, pos.b[n], "b"); });

    // the bar, dead centre between the innermost column of each half
    var barX = ((geom.cols[5] + geom.cols[6]) / 2) * 100;
    for (var i = 0; i < (pos.bar && pos.bar.b || 0); i++)
      h += '<span class="chk b on-bar" style="left:' + barX + "%;top:" + (42 - i * ch * 0.9) +
        "%;width:" + cw + '%;z-index:30"></span>';
    for (var j = 0; j < (pos.bar && pos.bar.w || 0); j++)
      h += '<span class="chk w on-bar" style="left:' + barX + "%;top:" + (58 + j * ch * 0.9) +
        "%;width:" + cw + '%;z-index:30"></span>';

    // landing spots — no number on them; the die that pays is in the move tray
    (pos.spots || []).forEach(function (n) {
      var y = isTop(n) ? ch * 0.62 : 100 - ch * 0.62;
      h += '<span class="spot" style="left:' + colX(geom, n) + "%;top:" + y +
        "%;width:" + cw + '%;z-index:8"></span>';
    });

    // the throw, out in the clear band of the roller's right-hand half
    (pos.dice || []).forEach(function (v, k) {
      h += '<span class="die' + (pos.used && pos.used[k] ? " spent" : "") + '" data-die="' + k +
        '" style="left:' + geom.cols[8 + k] * 100 + "%;top:" + (47 + k * 7) +
        "%;width:" + cw * 1.05 + "%;--r:" + (k ? 12 : -9) + 'deg;z-index:40">' + pips(v) + "</span>";
    });

    // the cube, parked on its owner's side of the bar
    if (pos.cube) {
      h += '<span class="cube" style="left:' + barX + "%;top:" +
        (pos.cubeOwner === "foe" ? 12 : 88) + "%;width:" + cw * 1.1 + '%;z-index:40">' + pos.cube + "</span>";
    }
    layer.innerHTML = h;
  }

  /** Roll animation: tumble both dice, then settle. Returns the settled faces. */
  function rollDice(layer, onSettle, sfx) {
    var dice = layer.querySelectorAll("[data-die]");
    var faces = [];
    dice.forEach(function (d, k) {
      var n = 0;
      var iv = setInterval(function () {
        var v = 1 + Math.floor(Math.random() * 6);
        d.innerHTML = pips(v);
        d.style.setProperty("--r", (Math.random() * 44 - 22) + "deg");
        if (++n > 8) {
          clearInterval(iv);
          d.style.setProperty("--r", (k ? 12 : -9) + "deg");
          faces[k] = v;
          if (sfx) sfx.place();
          if (k === dice.length - 1 && onSettle) onSettle(faces);
        }
      }, 55 + k * 14);
    });
    if (sfx) sfx.roll();
  }

  // ── sound ────────────────────────────────────────────────────────────────
  //
  // Synthesised, not sampled. The point is that each design's sound DIRECTION
  // is audible now; the real build swaps in samples with the same envelopes.

  var AC = null;
  function ac() { return (AC = AC || new (global.AudioContext || global.webkitAudioContext)()); }

  function tone(o) {
    var c = ac(), t = c.currentTime + (o.at || 0);
    var osc = c.createOscillator(), g = c.createGain();
    osc.type = o.type || "sine";
    osc.frequency.setValueAtTime(o.f, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + (o.dur || 0.12));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.vol || 0.25, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (o.dur || 0.12));
    osc.connect(g).connect(c.destination);
    osc.start(t); osc.stop(t + (o.dur || 0.12) + 0.03);
  }
  function noise(o) {
    var c = ac(), t = c.currentTime + (o.at || 0), dur = o.dur || 0.09;
    var n = Math.max(1, Math.floor(c.sampleRate * dur));
    var buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, o.decay || 2.2);
    var s = c.createBufferSource(); s.buffer = buf;
    var f = c.createBiquadFilter();
    f.type = o.filter || "bandpass"; f.frequency.value = o.hz || 1800; f.Q.value = o.q || 0.8;
    var g = c.createGain(); g.gain.value = o.vol || 0.22;
    s.connect(f).connect(g).connect(c.destination); s.start(t);
  }

  /**
   * A design's sound set. `voice` picks the character:
   *   ink   — dry, percussive, woodblock and a metal ring   (Neo Gammon)
   *   wood  — soft, warm, a go stone on a wooden board      (Kōen)
   *   data  — short synthetic UI blips and data chirps      (Gridrunner)
   *   pop   — round, bouncy, toy-like                       (Block Party)
   */
  function makeSFX(voice) {
    var V = {
      ink: {
        place: function () { tone({ f: 520, to: 300, type: "triangle", dur: 0.09, vol: 0.26 }); noise({ dur: 0.05, vol: 0.1, hz: 2600 }); },
        roll: function () { for (var i = 0; i < 6; i++) noise({ dur: 0.05, vol: 0.15, at: i * 0.055, hz: 2200 }); tone({ f: 180, to: 120, type: "square", dur: 0.14, vol: 0.12, at: 0.3 }); },
        hit: function () { tone({ f: 120, to: 55, type: "square", dur: 0.2, vol: 0.3 }); tone({ f: 1420, to: 820, dur: 0.3, vol: 0.15, at: 0.02 }); noise({ dur: 0.14, vol: 0.28, hz: 1200 }); },
        win: function () { [0, 2, 4, 7].forEach(function (s, i) { tone({ f: 392 * Math.pow(2, s / 12), type: "triangle", dur: 0.26, vol: 0.2, at: i * 0.075 }); }); }
      },
      wood: {
        place: function () { tone({ f: 300, to: 190, type: "sine", dur: 0.16, vol: 0.26 }); noise({ dur: 0.04, vol: 0.06, hz: 900, decay: 3 }); },
        roll: function () { for (var i = 0; i < 5; i++) noise({ dur: 0.07, vol: 0.1, at: i * 0.07, hz: 700, decay: 3 }); tone({ f: 210, to: 150, type: "sine", dur: 0.22, vol: 0.14, at: 0.34 }); },
        hit: function () { tone({ f: 165, to: 90, type: "sine", dur: 0.3, vol: 0.28 }); tone({ f: 660, to: 440, type: "sine", dur: 0.5, vol: 0.1, at: 0.03 }); },
        win: function () { [0, 4, 7, 12].forEach(function (s, i) { tone({ f: 330 * Math.pow(2, s / 12), type: "sine", dur: 0.5, vol: 0.16, at: i * 0.14 }); }); }
      },
      data: {
        place: function () { tone({ f: 880, to: 1320, type: "square", dur: 0.05, vol: 0.14 }); },
        roll: function () { for (var i = 0; i < 8; i++) tone({ f: 400 + Math.random() * 900, type: "square", dur: 0.03, vol: 0.09, at: i * 0.04 }); },
        hit: function () { tone({ f: 1600, to: 200, type: "sawtooth", dur: 0.18, vol: 0.2 }); noise({ dur: 0.1, vol: 0.16, hz: 3400 }); },
        win: function () { [0, 5, 7, 12, 19].forEach(function (s, i) { tone({ f: 523 * Math.pow(2, s / 12), type: "square", dur: 0.1, vol: 0.13, at: i * 0.07 }); }); }
      },
      pop: {
        place: function () { tone({ f: 260, to: 620, type: "sine", dur: 0.11, vol: 0.3 }); },
        roll: function () { for (var i = 0; i < 5; i++) tone({ f: 200 + i * 60, to: 420 + i * 60, type: "sine", dur: 0.07, vol: 0.14, at: i * 0.06 }); },
        hit: function () { tone({ f: 700, to: 140, type: "sine", dur: 0.24, vol: 0.3 }); tone({ f: 140, to: 70, type: "triangle", dur: 0.3, vol: 0.2, at: 0.02 }); },
        win: function () { [0, 4, 7, 12, 16].forEach(function (s, i) { tone({ f: 392 * Math.pow(2, s / 12), type: "sine", dur: 0.3, vol: 0.2, at: i * 0.09 }); }); }
      }
    };
    return V[voice] || V.ink;
  }

  // ── callouts ─────────────────────────────────────────────────────────────
  //
  // The moment a game beat lands. Deliberately NOT a full-screen flash: a
  // full-screen blowout hides the board at exactly the instant you want to see
  // what just happened to it. This is a contained shape that punches in over
  // the table, reads in a glance, and gets out — so the position stays visible
  // underneath the whole time.
  //
  // kind:  'roll'   the throw, with both faces
  //        'double' a double — the loud one, four moves to spend
  //        'hit'    a checker knocked to the bar
  //        'bear'   a checker borne off
  //        'win'    the game
  var CALL = {
    roll:   { word: "ROLL",     tone: "" },
    double: { word: "DOUBLES!", tone: "hot" },
    hit:    { word: "HIT!",     tone: "hot" },
    bear:   { word: "BORNE OFF", tone: "good" },
    win:    { word: "YOU WIN",  tone: "good" }
  };

  /**
   * Fire a callout inside `host`. `big` is the headline glyph (dice faces, a
   * number); `sub` overrides the default word. Auto-removes itself.
   */
  function callout(host, kind, big, sub) {
    var spec = CALL[kind] || CALL.roll;
    var el = document.createElement("div");
    el.className = "callout k-" + kind + (spec.tone ? " " + spec.tone : "");
    el.innerHTML =
      '<span class="co-burst" aria-hidden="true"></span>' +
      '<span class="co-body">' +
      (big != null ? '<b class="co-big">' + big + "</b>" : "") +
      '<span class="co-word">' + (sub || spec.word) + "</span>" +
      "</span>";
    host.appendChild(el);
    // one frame later so the entry animation actually plays
    requestAnimationFrame(function () { el.classList.add("in"); });
    setTimeout(function () {
      el.classList.remove("in");
      el.classList.add("out");
      setTimeout(function () { el.remove(); }, 320);
    }, kind === "double" || kind === "win" ? 1500 : 1100);
    return el;
  }

  /** Two dice faces as inline pip blocks, for a callout headline. */
  function faceGlyphs(a, b) {
    return '<span class="co-face">' + pips(a) + '</span><span class="co-face">' + pips(b) + "</span>";
  }

  // ── screens ──────────────────────────────────────────────────────────────

  /** Wires `[data-goto="x"]` to show `[data-screen="x"]`, hiding the rest. */
  function wireScreens(root, onChange) {
    var show = function (id) {
      root.querySelectorAll("[data-screen]").forEach(function (s) {
        s.hidden = s.getAttribute("data-screen") !== id;
      });
      root.querySelectorAll("[data-goto]").forEach(function (b) {
        b.setAttribute("aria-current", String(b.getAttribute("data-goto") === id));
      });
      if (onChange) onChange(id);
    };
    root.addEventListener("click", function (e) {
      var b = e.target.closest("[data-goto]");
      if (b) { show(b.getAttribute("data-goto")); }
    });
    return show;
  }

  /** Load an image and hand back its measured geometry. */
  function boot(imgEl, override) {
    return new Promise(function (res) {
      var go = function () { res(measureBoard(imgEl, override)); };
      if (imgEl.complete && imgEl.naturalWidth) go();
      else imgEl.addEventListener("load", go, { once: true });
    });
  }

  global.NeoTable = {
    boot: boot, measureBoard: measureBoard, renderBoard: renderBoard,
    rollDice: rollDice, pips: pips, colX: colX, makeSFX: makeSFX, wireScreens: wireScreens,
    callout: callout, faceGlyphs: faceGlyphs
  };
})(window);
