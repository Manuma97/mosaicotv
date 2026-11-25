(function () {
  'use strict';

  /* ================= Constantes ================= */
  var K = { ENTER: 13, BACK: 10009, ESC: 27, LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40,
            RED: 403, CH_UP: 427, CH_DOWN: 428, INFO: 457 };
  var STEP = 244;          // ancho de tarjeta (220) + separación (24)
  var ROW_H = 300;         // alto de cada fila
  var CHUNK = 7;           // tarjetas por fila en Favoritos / Búsqueda

  var DEMO_M3U = [
    '#EXTM3U',
    '#EXTINF:-1 group-title="Prueba",Mux Test',
    'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    '#EXTINF:-1 group-title="Prueba",Apple Bipbop',
    'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/bipbop_4x3_variant.m3u8',
    '#EXTINF:-1 group-title="Prueba",Apple Advanced',
    'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8'
  ].join('\n');

  /* ================= Utilidades ================= */
  function $(id) { return document.getElementById(id); }
  function jget(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function jset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function hue(s) { var h = 0; for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) % 360; } return h; }
  function hasAV() { return typeof webapis !== 'undefined' && webapis.avplay; }

  // Android (Capacitor)
  function isNative() { return !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform()); }
  function plug(name) { return (Capacitor.Plugins && Capacitor.Plugins[name]) || Capacitor.registerPlugin(name); }
  function isFavKey(k) { return k === 403 || k === 183 || k === 82 || k === 70; }   // rojo, menú, F
  function isChUp(k) { return k === 427 || k === 166 || k === 33; }
  function isChDown(k) { return k === 428 || k === 167 || k === 34; }

  // OK corto = acción normal; OK mantenido = favorito
  var enterTimer = null, enterLong = false, enterShort = null;
  function enterDown(shortFn, longFn) {
    if (enterTimer || enterLong) return;
    enterShort = shortFn;
    enterTimer = setTimeout(function () { enterTimer = null; enterLong = true; enterShort = null; longFn(); }, 650);
  }
  function enterUp() {
    if (enterTimer) { clearTimeout(enterTimer); enterTimer = null; var f = enterShort; enterShort = null; if (f) f(); }
    enterLong = false;
  }

  var toastTimer = null;
  function toast(msg, ms) {
    var t = $('toast');
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toastTimer);
    if (ms !== 0) { toastTimer = setTimeout(function () { t.classList.remove('on'); }, ms || 2600); }
  }
  function hideToast() { clearTimeout(toastTimer); $('toast').classList.remove('on'); }

  /* ================= Estado ================= */
  var S = {
    channels: [], groups: [], byUrl: {},
    favSet: {}, recent: [],
    view: 'home', area: 'rows', navIdx: 0,
    rows: [], rowEls: [], row: 0, cols: [], query: '',
    playing: false, queue: [], qi: 0,
    settingsOpen: false, setIdx: 0
  };
  var rowsEl, heroEl;
  var NAV = ['home', 'search', 'favs', 'settings'];

  /* ================= M3U ================= */
  function parseM3U(text) {
    var lines = text.split(/\r?\n/), out = [], cur = null, i, l;
    for (i = 0; i < lines.length; i++) {
      l = lines[i].trim();
      if (!l) continue;
      if (l.indexOf('#EXTINF') === 0) {
        cur = {};
        var q = l.lastIndexOf('"');
        var ci = l.indexOf(',', q > -1 ? q : 0);
        cur.title = ci > -1 ? l.slice(ci + 1).trim() : '';
        var re = /([\w-]+)="([^"]*)"/g, m;
        while ((m = re.exec(l))) { cur[m[1]] = m[2]; }
      } else if (l.charAt(0) === '#') {
        if (l.indexOf('#EXTGRP:') === 0 && cur) { cur.grp = l.slice(8).trim(); }
      } else if (cur) {
        out.push({
          name: cur.title || cur['tvg-name'] || 'Canal',
          logo: cur['tvg-logo'] || '',
          group: cur['group-title'] || cur.grp || 'Sin categoría',
          url: l
        });
        cur = null;
      }
    }
    return out;
  }

  function setChannels(chs) {
    var order = [], map = {};
    S.channels = chs; S.byUrl = {};
    chs.forEach(function (c) {
      S.byUrl[c.url] = c;
      if (!map[c.group]) { map[c.group] = { title: c.group, items: [] }; order.push(c.group); }
      map[c.group].items.push(c);
    });
    S.groups = order.map(function (g) { return map[g]; });
    S.view = 'home'; S.navIdx = 0; S.area = 'rows';
    document.body.classList.remove('is-search');
    rebuild(false);
  }

  function fetchText(url, cb) {
    if (isNative()) {
      plug('CapacitorHttp').get({ url: url, responseType: 'text', readTimeout: 60000, connectTimeout: 20000 })
        .then(function (r) {
          if (r.status >= 200 && r.status < 300) {
            cb(null, typeof r.data === 'string' ? r.data : JSON.stringify(r.data));
          } else { cb('Error ' + r.status + ' al descargar la lista'); }
        })
        .catch(function () { cb('No se pudo descargar la lista'); });
      return;
    }
    var x = new XMLHttpRequest();
    x.open('GET', url, true);
    x.timeout = 60000;
    x.onload = function () {
      if (x.status >= 200 && x.status < 300) cb(null, x.responseText);
      else cb('Error ' + x.status + ' al descargar la lista');
    };
    x.onerror = function () { cb('No se pudo descargar la lista'); };
    x.ontimeout = function () { cb('La lista tardó demasiado en descargarse'); };
    x.send();
  }

  function loadPlaylist(url, onFail) {
    toast('Cargando lista…', 0);
    fetchText(url, function (err, text) {
      if (err) { toast(err, 4000); if (onFail) onFail(); return; }
      var chs = parseM3U(text);
      if (!chs.length) { toast('La lista no tiene canales válidos', 4000); if (onFail) onFail(); return; }
      try { localStorage.setItem('mt_url', url); localStorage.setItem('mt_cache', text); } catch (e) {}
      setChannels(chs);
      closeSettings();
      toast(chs.length + ' canales en ' + S.groups.length + ' categorías');
    });
  }

  function loadFallback() {
    var cache = null;
    try { cache = localStorage.getItem('mt_cache'); } catch (e) {}
    var chs = cache ? parseM3U(cache) : [];
    if (chs.length) { setChannels(chs); }
    else { setChannels(parseM3U(DEMO_M3U)); toast('Lista de prueba. Añade la tuya en Ajustes.', 5000); }
  }

  /* ================= Filas ================= */
  function chunk(items, title) {
    var r = [], i;
    for (i = 0; i < items.length; i += CHUNK) { r.push({ title: i === 0 ? title : '', items: items.slice(i, i + CHUNK) }); }
    return r;
  }
  function favItems() { return S.channels.filter(function (c) { return S.favSet[c.url]; }); }

  function buildRows() {
    var rows = [];
    if (S.view === 'home') {
      var rec = S.recent.map(function (u) { return S.byUrl[u]; }).filter(Boolean);
      if (rec.length) rows.push({ title: 'Seguir viendo', items: rec });
      var fav = favItems();
      if (fav.length) rows.push({ title: 'Mis favoritos', items: fav });
      S.groups.forEach(function (g) { rows.push(g); });
    } else if (S.view === 'favs') {
      rows = chunk(favItems(), 'Mis favoritos');
    } else if (S.view === 'search') {
      var q = S.query.trim().toLowerCase();
      if (q) {
        var res = S.channels.filter(function (c) {
          return c.name.toLowerCase().indexOf(q) > -1 || c.group.toLowerCase().indexOf(q) > -1;
        }).slice(0, 140);
        rows = chunk(res, res.length ? 'Resultados' : '');
      }
    }
    return rows;
  }

  function rebuild(keep) {
    var t = null, c = 0;
    if (keep && S.rows[S.row]) { t = S.rows[S.row].title; c = S.cols[S.row] || 0; }
    S.rows = buildRows();
    S.cols = S.rows.map(function () { return 0; });
    S.row = 0;
    if (t !== null) {
      for (var i = 0; i < S.rows.length; i++) {
        if (S.rows[i].title === t) { S.row = i; S.cols[i] = Math.min(c, S.rows[i].items.length - 1); break; }
      }
    }
    render();
  }

  function render() {
    rowsEl.innerHTML = '';
    S.rowEls = [];
    S.rows.forEach(function (r) {
      var el = document.createElement('div'); el.className = 'row';
      var h = document.createElement('h2'); h.textContent = r.title; el.appendChild(h);
      var tr = document.createElement('div'); tr.className = 'track'; el.appendChild(tr);
      rowsEl.appendChild(el);
      S.rowEls.push({ el: el, track: tr, tiles: {} });
    });
    var empty = $('empty');
    if (!S.rows.length) {
      empty.style.display = 'block';
      empty.textContent = S.view === 'favs' ? 'Aún no tienes favoritos. Mantén OK sobre un canal para añadirlo.'
        : S.view === 'search' ? (S.query.trim() ? 'Sin resultados para “' + S.query.trim() + '”.' : 'Escribe el nombre de un canal o de una categoría.')
        : 'No hay canales.';
    } else { empty.style.display = 'none'; }
    applyFocus();
  }

  function makeTile(ch, ri, i) {
    var t = document.createElement('div');
    t.className = 'tile' + (S.favSet[ch.url] ? ' fav' : '');
    t.style.left = (i * STEP) + 'px';
    var h = hue(ch.group);
    t.style.background = 'linear-gradient(150deg,hsl(' + h + ',46%,26%),hsl(' + ((h + 30) % 360) + ',50%,12%))';
    var ini = document.createElement('div'); ini.className = 'ini';
    ini.textContent = (ch.name.replace(/[^A-Za-z0-9ÁÉÍÓÚÑáéíóúñ]/, '').charAt(0) || ch.name.charAt(0) || '·').toUpperCase();
    t.appendChild(ini);
    if (ch.logo) {
      var im = new Image(); im.className = 'logo';
      im.onerror = function () { if (im.parentNode) im.parentNode.removeChild(im); };
      im.src = ch.logo; t.appendChild(im);
    }
    var lb = document.createElement('div'); lb.className = 'label'; lb.textContent = ch.name;
    t.appendChild(lb);
    t.addEventListener('click', function () {
      S.row = ri; S.cols[ri] = i; S.area = 'rows'; applyFocus(); playFromRows();
    });
    return t;
  }

  function ensureWindow(ri) {
    var R = S.rowEls[ri], items = S.rows[ri].items, col = S.cols[ri] || 0;
    var a = Math.max(0, col - 4), b = Math.min(items.length - 1, col + 12), j;
    Object.keys(R.tiles).forEach(function (k) {
      var n = +k;
      if (n < a || n > b) { R.track.removeChild(R.tiles[k]); delete R.tiles[k]; }
    });
    for (j = a; j <= b; j++) {
      if (!R.tiles[j]) { var t = makeTile(items[j], ri, j); R.track.appendChild(t); R.tiles[j] = t; }
    }
    R.track.style.transform = 'translateX(' + (-Math.max(0, col - 1) * STEP) + 'px)';
  }

  function current() {
    var r = S.rows[S.row];
    return r ? r.items[S.cols[S.row] || 0] : null;
  }

  function applyFocus() {
    rowsEl.style.transform = 'translateY(' + (-S.row * ROW_H) + 'px)';
    for (var i = Math.max(0, S.row - 1); i <= Math.min(S.rows.length - 1, S.row + 3); i++) { ensureWindow(i); }
    var old = document.querySelector('.tile.focus');
    if (old) old.classList.remove('focus');
    if (S.area === 'rows' && S.rows.length) {
      var t = S.rowEls[S.row].tiles[S.cols[S.row] || 0];
      if (t) t.classList.add('focus');
    }
    updateHero();
    var btns = document.querySelectorAll('.navbtn');
    for (var n = 0; n < btns.length; n++) {
      btns[n].classList.toggle('focus', S.area === 'nav' && n === S.navIdx);
      btns[n].classList.toggle('active', NAV[n] === S.view);
    }
  }

  function updateHero() {
    var ch = current(), art = $('heroArt');
    if (!ch) {
      $('heroName').textContent = S.view === 'favs' ? 'Favoritos' : S.view === 'search' ? 'Buscar' : 'Mosaico TV';
      $('heroGroup').textContent = ''; art.innerHTML = ''; art.style.visibility = 'hidden';
      return;
    }
    var h = hue(ch.group);
    heroEl.style.setProperty('--h', h);
    $('heroName').textContent = ch.name;
    $('heroGroup').textContent = (S.favSet[ch.url] ? '★ ' : '') + ch.group;
    art.style.visibility = 'visible';
    art.style.background = 'linear-gradient(150deg,hsl(' + h + ',46%,26%),hsl(' + ((h + 30) % 360) + ',50%,12%))';
    art.innerHTML = '';
    var ini = document.createElement('div'); ini.className = 'ini';
    ini.textContent = (ch.name.charAt(0) || '·').toUpperCase(); art.appendChild(ini);
    if (ch.logo) {
      var im = new Image();
      im.onerror = function () { if (im.parentNode) im.parentNode.removeChild(im); };
      im.src = ch.logo; art.appendChild(im);
    }
  }

  /* ================= Favoritos y recientes ================= */
  function toggleFav(ch) {
    if (!ch) return;
    if (S.favSet[ch.url]) { delete S.favSet[ch.url]; toast('Quitado de favoritos', 1500); }
    else { S.favSet[ch.url] = true; toast('Añadido a favoritos', 1500); }
    jset('mt_favs', Object.keys(S.favSet));
  }
  function recordRecent(ch) {
    S.recent = S.recent.filter(function (u) { return u !== ch.url; });
    S.recent.unshift(ch.url);
    S.recent = S.recent.slice(0, 20);
    jset('mt_recent', S.recent);
  }

  /* ================= Navegación superior ================= */
  function activateNav(v) {
    if (v === 'settings') { openSettings(); return; }
    S.view = v;
    S.navIdx = NAV.indexOf(v);
    var isSearch = v === 'search';
    document.body.classList.toggle('is-search', isSearch);
    if (isSearch) { S.query = ''; $('q').value = ''; }
    rebuild(false);
    if (isSearch) { S.area = 'search'; $('q').focus(); }
    else { S.area = S.rows.length ? 'rows' : 'nav'; applyFocus(); }
  }

  function exitApp() {
    try { tizen.application.getCurrentApplication().exit(); } catch (e) {}
    try { if (isNative()) plug('App').exitApp(); } catch (e) {}
  }

  /* ================= Ajustes ================= */
  var SET_IDS = ['setUrl', 'btnLoad', 'btnDemo', 'btnClear', 'btnClose'];
  function openSettings() {
    S.settingsOpen = true; S.setIdx = 1;
    var u = ''; try { u = localStorage.getItem('mt_url') || ''; } catch (e) {}
    $('setUrl').value = u;
    $('settings').classList.add('on');
    setSetFocus();
  }
  function closeSettings() {
    S.settingsOpen = false;
    $('settings').classList.remove('on');
    $('setUrl').blur();
    applyFocus();
  }
  function setSetFocus() {
    SET_IDS.forEach(function (id, i) { $(id).classList.toggle('focus', i === S.setIdx); });
  }
  function settingsAction(id) {
    if (id === 'setUrl') { $('setUrl').focus(); }
    else if (id === 'btnLoad') {
      var u = $('setUrl').value.trim();
      if (!u) { toast('Escribe la dirección de tu lista M3U', 2500); return; }
      loadPlaylist(u);
    }
    else if (id === 'btnDemo') { setChannels(parseM3U(DEMO_M3U)); closeSettings(); toast('Lista de prueba cargada'); }
    else if (id === 'btnClear') {
      S.favSet = {}; S.recent = []; jset('mt_favs', []); jset('mt_recent', []);
      rebuild(false); toast('Favoritos y recientes borrados', 2000);
    }
    else if (id === 'btnClose') { closeSettings(); }
  }
  function settingsKey(e) {
    var k = e.keyCode, input = $('setUrl');
    if (document.activeElement === input) {
      if (k === K.ENTER || k === K.DOWN) { input.blur(); S.setIdx = 1; setSetFocus(); e.preventDefault(); }
      else if (k === K.BACK || k === K.ESC) { input.blur(); e.preventDefault(); }
      return;
    }
    if (k === K.UP) { S.setIdx = Math.max(0, S.setIdx - 1); setSetFocus(); }
    else if (k === K.DOWN) { S.setIdx = Math.min(SET_IDS.length - 1, S.setIdx + 1); setSetFocus(); }
    else if (k === K.LEFT && S.setIdx > 1) { S.setIdx--; setSetFocus(); }
    else if (k === K.RIGHT && S.setIdx >= 1 && S.setIdx < SET_IDS.length - 1) { S.setIdx++; setSetFocus(); }
    else if (k === K.ENTER) { settingsAction(SET_IDS[S.setIdx]); }
    else if (k === K.BACK || k === K.ESC) { closeSettings(); }
    else return;
    e.preventDefault();
  }

  /* ================= Reproductor ================= */
  var video, hls = null, infoTimer = null;

  function spin(on) { $('spin').classList.toggle('on', !!on); }
  function showErr(on) { $('perr').classList.toggle('on', !!on); }
  function showInfo() {
    var p = $('pinfo'); p.classList.remove('hide');
    clearTimeout(infoTimer);
    infoTimer = setTimeout(function () { p.classList.add('hide'); }, 4500);
  }

  function engineStop() {
    if (isNative()) { try { plug('NativePlayer').stop().catch(function () {}); } catch (e) {} }
    if (hasAV()) {
      try { webapis.avplay.stop(); } catch (e) {}
      try { webapis.avplay.close(); } catch (e) {}
    }
    if (hls) { hls.destroy(); hls = null; }
    video.pause(); video.removeAttribute('src'); video.load(); video.style.display = 'none';
  }

  function enginePlay(url) {
    spin(true); showErr(false);
    if (isNative()) {
      plug('NativePlayer').play({ url: url }).catch(function () { spin(false); showErr(true); });
      return;
    }
    if (hasAV()) {
      try {
        var av = webapis.avplay;
        av.open(url);
        av.setDisplayRect(0, 0, 1920, 1080);
        av.setListener({
          onbufferingstart: function () { spin(true); },
          onbufferingcomplete: function () { spin(false); },
          onstreamcompleted: function () {},
          onerror: function () { spin(false); showErr(true); }
        });
        av.prepareAsync(function () { av.play(); spin(false); }, function () { spin(false); showErr(true); });
      } catch (e) { spin(false); showErr(true); }
      return;
    }
    video.style.display = 'block';
    if (/\.m3u8(\?|$)/i.test(url) && window.Hls && Hls.isSupported()) {
      hls = new Hls();
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, function () { video.play(); });
      hls.on(Hls.Events.ERROR, function (ev, d) { if (d.fatal) { spin(false); showErr(true); } });
    } else {
      video.src = url; video.play();
    }
  }

  function playCurrent() {
    var ch = S.queue[S.qi];
    recordRecent(ch);
    $('pnum').textContent = (S.qi + 1);
    $('pname').textContent = ch.name;
    $('pmeta').textContent = ch.group + (S.favSet[ch.url] ? '  ·  ★ favorito' : '');
    showInfo();
    engineStop();
    enginePlay(ch.url);
  }

  function startPlayer(queue, qi) {
    S.playing = true; S.queue = queue; S.qi = qi;
    document.body.classList.add('playing');
    playCurrent();
  }

  function stopPlayer() {
    engineStop();
    spin(false); showErr(false);
    document.body.classList.remove('playing');
    S.playing = false;
    if (S.view === 'home' || S.view === 'favs') { rebuild(true); } else { applyFocus(); }
  }

  function zap(d) {
    var n = S.queue.length;
    if (n < 2) return;
    S.qi = (S.qi + d + n) % n;
    playCurrent();
  }

  function playFromRows() {
    var r = S.rows[S.row];
    if (!r) return;
    startPlayer(r.items, S.cols[S.row] || 0);
  }

  function playerKey(e) {
    var k = e.keyCode;
    if (k === K.BACK || k === K.ESC || k === 8) { stopPlayer(); }
    else if (k === K.UP || isChUp(k)) { zap(1); }
    else if (k === K.DOWN || isChDown(k)) { zap(-1); }
    else if (k === K.ENTER) {
      enterDown(showInfo, function () { toggleFav(S.queue[S.qi]); playInfoRefresh(); });
    }
    else if (k === K.INFO) { showInfo(); }
    else if (isFavKey(k)) { toggleFav(S.queue[S.qi]); playInfoRefresh(); }
    else return;
    e.preventDefault();
  }
  function playInfoRefresh() {
    var ch = S.queue[S.qi];
    $('pmeta').textContent = ch.group + (S.favSet[ch.url] ? '  ·  ★ favorito' : '');
    showInfo();
  }

  /* ================= Teclado general ================= */
  function onKey(e) {
    var k = e.keyCode;
    if (S.playing) { playerKey(e); return; }
    if (S.settingsOpen) { settingsKey(e); return; }

    if (document.activeElement === $('q')) {
      if (k === K.BACK || k === K.ESC) { $('q').blur(); S.area = 'nav'; applyFocus(); e.preventDefault(); }
      else if (k === K.DOWN || k === K.ENTER) {
        $('q').blur(); S.area = S.rows.length ? 'rows' : 'nav'; applyFocus(); e.preventDefault();
      }
      return;
    }

    if (S.area === 'nav') {
      if (k === K.LEFT) { S.navIdx = Math.max(0, S.navIdx - 1); }
      else if (k === K.RIGHT) { S.navIdx = Math.min(NAV.length - 1, S.navIdx + 1); }
      else if (k === K.DOWN) { if (S.rows.length) S.area = 'rows'; }
      else if (k === K.ENTER) { activateNav(NAV[S.navIdx]); e.preventDefault(); return; }
      else if (k === K.BACK || k === K.ESC) { if (S.view !== 'home') { activateNav('home'); } else { exitApp(); } }
      else return;
      applyFocus(); e.preventDefault(); return;
    }

    // Área de filas
    var items = S.rows[S.row] ? S.rows[S.row].items : [];
    if (k === K.LEFT) { if (S.cols[S.row] > 0) S.cols[S.row]--; }
    else if (k === K.RIGHT) { if (S.cols[S.row] < items.length - 1) S.cols[S.row]++; }
    else if (k === K.DOWN) {
      if (S.row < S.rows.length - 1) {
        var c = S.cols[S.row];
        S.row++;
        S.cols[S.row] = Math.min(c, S.rows[S.row].items.length - 1);
      }
    }
    else if (k === K.UP) {
      if (S.row > 0) {
        var c2 = S.cols[S.row];
        S.row--;
        S.cols[S.row] = Math.min(c2, S.rows[S.row].items.length - 1);
      } else { S.area = 'nav'; }
    }
    else if (k === K.ENTER) {
      enterDown(playFromRows, function () { toggleFav(current()); rebuild(true); });
      e.preventDefault(); return;
    }
    else if (isFavKey(k)) { toggleFav(current()); rebuild(true); e.preventDefault(); return; }
    else if (k === K.BACK || k === K.ESC) {
      if (S.view !== 'home') { activateNav('home'); } else { exitApp(); }
    }
    else return;
    applyFocus(); e.preventDefault();
  }

  /* ================= Inicio ================= */
  function init() {
    rowsEl = $('rows'); heroEl = $('hero'); video = $('video');

    try {
      ['ChannelUp', 'ChannelDown', 'ColorF0Red', 'Info'].forEach(function (n) { tizen.tvinputdevice.registerKey(n); });
    } catch (e) {}

    video.addEventListener('playing', function () { spin(false); showErr(false); });
    video.addEventListener('waiting', function () { spin(true); });
    video.addEventListener('error', function () { spin(false); showErr(true); });

    var btns = document.querySelectorAll('.navbtn');
    Array.prototype.forEach.call(btns, function (b, i) {
      b.addEventListener('click', function () { S.navIdx = i; activateNav(b.getAttribute('data-v')); });
    });
    $('q').addEventListener('input', function () { S.query = this.value; rebuild(false); });
    SET_IDS.forEach(function (id, i) {
      $(id).addEventListener('click', function () { S.setIdx = i; setSetFocus(); settingsAction(id); });
    });
    document.addEventListener('keydown', onKey);
    document.addEventListener('keyup', function (e) { if (e.keyCode === K.ENTER) enterUp(); });

    if (isNative()) {
      try {
        plug('App').addListener('backButton', function () {
          onKey({ keyCode: K.BACK, preventDefault: function () {} });
        });
      } catch (e) {}
      try {
        plug('NativePlayer').addListener('state', function (ev) {
          if (!S.playing) return;
          if (ev.state === 'buffering') { spin(true); }
          else if (ev.state === 'ready') { spin(false); showErr(false); }
          else if (ev.state === 'error') { spin(false); showErr(true); }
        });
      } catch (e) {}
    }

    (jget('mt_favs', [])).forEach(function (u) { S.favSet[u] = true; });
    S.recent = jget('mt_recent', []);

    var url = ''; try { url = localStorage.getItem('mt_url') || ''; } catch (e) {}
    if (url) { loadPlaylist(url, loadFallback); }
    else { loadFallback(); }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
