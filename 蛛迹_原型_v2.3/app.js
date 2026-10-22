/* 蛛迹 · 野外蛛形动物采集记录
 * 单页离线应用（PWA）：语音/文字指令 + 定位 + 天气 + 名录 + 编号 + 统计 + 导出
 * 数据保存在本机 localStorage；照片保存在 IndexedDB。
 */
(function () {
  'use strict';

  const APP_VERSION = '2.3.0';
  const KEY = 'zhuji.state.v1';
  const PHOTO_DB = 'zhuji.photos';
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const DATA_META = window.ZHUJI_TAXONOMY_META || { version: '', counts: {} };

  function normalizeTaxon(t) {
    return {
      grp: normalizeGroup(t.grp),
      f: t.f || '', fl: t.fl || '',
      g: t.g || '', gl: t.gl || '',
      s: t.s || '', sl: t.sl || '',
      a: Array.isArray(t.a) ? t.a.slice() : []
    };
  }

  const DATA_TAXONOMY = (Array.isArray(window.ZHUJI_TAXONOMY) ? window.ZHUJI_TAXONOMY : []).map(normalizeTaxon);
  const SAMPLE_TAXONOMY = [
    { grp: '蜘蛛', f: '园蛛科', fl: 'Araneidae', g: '金蛛属', gl: 'Argiope', s: '横纹金蛛', sl: 'Argiope bruennichi', a: ['金蛛'] },
    { grp: '蜘蛛', f: '跳蛛科', fl: 'Salticidae', g: '猎蛛属', gl: 'Evarcha', s: '白斑猎蛛', sl: 'Evarcha albaria', a: [] },
    { grp: '蜘蛛', f: '蟹蛛科', fl: 'Thomisidae', g: '伊氏蛛属', gl: 'Ebrechtella', s: '三突伊氏蛛', sl: 'Ebrechtella tricuspidata', a: [] }
  ];
  const TAXONOMY_SEED = DATA_TAXONOMY.length ? DATA_TAXONOMY : SAMPLE_TAXONOMY.map(normalizeTaxon);

  const WCODE = {
    0: '晴', 1: '晴间多云', 2: '多云', 3: '阴', 45: '雾', 48: '雾凇',
    51: '毛毛雨', 53: '毛毛雨', 55: '毛毛雨', 56: '冻毛毛雨', 57: '冻毛毛雨',
    61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '冻雨',
    71: '小雪', 73: '中雪', 75: '大雪', 77: '米雪',
    80: '阵雨', 81: '阵雨', 82: '强阵雨', 85: '阵雪', 86: '阵雪',
    95: '雷阵雨', 96: '雷阵雨伴冰雹', 99: '雷暴'
  };

  const DEFAULT_HABITATS = ['阔叶林', '针叶林', '混交林', '灌丛', '草地', '农田', '落叶层', '腐木/倒木', '树皮/树干', '石下', '岩壁', '洞穴', '土壤', '水边/湿地', '建筑', '其他'];
  const DEFAULT_METHODS = ['手捡', '扫网', '振落', '筛落叶', 'Berlese 漏斗', '陷阱杯', '马氏网', '灯诱', '诱罐', '直接观察', '翻石/倒木', '夜采', '拍照记录', '其他'];
  const SEXES = ['', '雌性', '雄性', '亚成体', '幼体', '若蛛'];

  function habitatOptions() {
    const a = state.settings.habitats;
    return Array.isArray(a) && a.length ? a : DEFAULT_HABITATS;
  }
  function methodOptions() {
    const a = state.settings.methods;
    return Array.isArray(a) && a.length ? a : DEFAULT_METHODS;
  }
  function normalizeGroup(g) { return String(g || '蜘蛛').replace(/目$/, ''); }
  function groupLabel(g) { return String(g || '蜘蛛').endsWith('目') ? String(g) : String(g || '蜘蛛') + '目'; }

  /* ============================================================
   * 工具
   * ============================================================ */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  function pad(n, w) { return String(n).padStart(w, '0'); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function todayStr(d) {
    const x = d || new Date();
    return x.getFullYear() + '-' + pad(x.getMonth() + 1, 2) + '-' + pad(x.getDate(), 2);
  }
  function nowHM() {
    const d = new Date();
    return pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function numOrNull(v) {
    if (v === '' || v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function norm(s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/[\s\u3000·・,，。.、;；:：()（）\[\]【】'"“”‘’\-—_/]/g, '');
  }
  function fmtCoord(lat, lon) {
    if (lat == null || lon == null) return '—';
    return lat.toFixed(5) + ', ' + lon.toFixed(5);
  }
  function speak(text) {
    if (!state.settings.announce || !('speechSynthesis' in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN';
      u.rate = 1.05;
      window.speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
  }

  let toastTimer = null;
  function toast(msg, actionLabel, action) {
    const wrap = $('#toast'), m = $('#toastMsg'), b = $('#toastAction');
    if (!wrap || !m || !b) return;
    m.textContent = msg;
    clearTimeout(toastTimer);
    if (actionLabel && typeof action === 'function') {
      b.hidden = false;
      b.textContent = actionLabel;
      b.onclick = function () {
        b.hidden = true; wrap.hidden = true; clearTimeout(toastTimer);
        try { action(); } catch (e) { /* ignore */ }
      };
    } else {
      b.hidden = true; b.onclick = null;
    }
    wrap.hidden = false;
    toastTimer = setTimeout(function () { wrap.hidden = true; }, actionLabel ? 8000 : 3200);
  }

  function download(filename, text, mime) {    const bom = (mime && mime.indexOf('json') !== -1) ? '' : '\ufeff';
    const blob = new Blob([bom + text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  /* ============================================================
   * 状态
   * ============================================================ */
  function defaultState() {
    return {
      version: 2,
      settings: {
        collector: '', site: '',
        voice: true, announce: true,
        weatherOnline: true, photo: true,
        codeWithDate: true,
        noPrefix: 'HBUARA#', noYear: '2026', noNext: '799',
        habitats: [], methods: [], dayNotes: {},
        habitat: '', method: '',
        familyCodes: {},
        manualTemp: '', manualHum: '',
        manualLat: '', manualLon: '', manualAlt: '',
        customTaxonomy: false,
        taxonomyDataVersion: DATA_META.version || ''
      },
      taxonomy: TAXONOMY_SEED.map(x => normalizeTaxon(x)),
      records: [],
      session: { active: false, start: null, date: null }
    };
  }

  function loadState() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { raw = null; }
    const d = defaultState();
    if (!raw || typeof raw !== 'object') return d;
    const s = {
      version: 2,
      settings: Object.assign({}, d.settings, (raw.settings && typeof raw.settings === 'object') ? raw.settings : {}),
      taxonomy: d.taxonomy,
      records: Array.isArray(raw.records) ? raw.records.map(normalizeRecord) : [],
      session: Object.assign({}, d.session, (raw.session && typeof raw.session === 'object') ? raw.session : {})
    };
    const oldTax = Array.isArray(raw.taxonomy) ? raw.taxonomy : [];
    const keepCustom = !!(raw.settings && raw.settings.customTaxonomy) || oldTax.length > 50;
    if (keepCustom && oldTax.length) s.taxonomy = oldTax.map(normalizeTaxon);
    if (!s.settings.familyCodes || typeof s.settings.familyCodes !== 'object') s.settings.familyCodes = {};
    s.settings.taxonomyDataVersion = DATA_META.version || s.settings.taxonomyDataVersion || '';
    return s;
  }

  let state = loadState();
  let currentTab = 'collect';
  let saveWarned = false;
  function saveState() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      if (!saveWarned) {
        saveWarned = true;
        toast('本机存储空间不足，建议先导出备份并清理旧照片');
      }
    }
  }

  /* ============================================================
   * 照片（IndexedDB）
   * ============================================================ */
  let dbPromise = null;
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((res, rej) => {
      if (!('indexedDB' in window)) { rej(new Error('no idb')); return; }
      const r = indexedDB.open(PHOTO_DB, 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('photos')) r.result.createObjectStore('photos'); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbPromise;
  }
  async function photoPut(id, data) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction('photos', 'readwrite');
      tx.objectStore('photos').put(data, id);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  }
  async function photoGet(id) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction('photos', 'readonly');
      const rq = tx.objectStore('photos').get(id);
      rq.onsuccess = () => res(rq.result || null);
      rq.onerror = () => rej(rq.error);
    });
  }
  async function photoDel(id) {
    try {
      const db = await openDB();
      const tx = db.transaction('photos', 'readwrite');
      tx.objectStore('photos').delete(id);
    } catch (e) { /* ignore */ }
  }
  function compressImage(file, maxW, quality) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onerror = rej;
      fr.onload = () => {
        const img = new Image();
        img.onerror = rej;
        img.onload = () => {
          const max = maxW || 1000;
          let w = img.width, h = img.height;
          const k = Math.min(1, max / Math.max(w, h));
          w = Math.round(w * k); h = Math.round(h * k);
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(img, 0, 0, w, h);
          res(cv.toDataURL('image/jpeg', quality || 0.72));
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  function hydratePhotos(root) {
    $$('img[data-photo]', root || document).forEach(img => {
      const id = img.getAttribute('data-photo');
      if (!id) return;
      photoGet(id).then(d => { if (d) img.src = d; }).catch(() => {});
    });
  }

  /* ============================================================
   * 环境：定位 / 海拔 / 天气
   * ============================================================ */
  const geo = { lat: null, lon: null, alt: null, acc: null, demAlt: null, status: 'idle', ts: 0, watch: null, lastCtx: 0, lowTried: false };
  const weather = { temp: null, hum: null, code: null, text: '', ts: 0, source: '' };

  function hasCoords() {
    return (geo.lat != null && geo.lon != null) || (numOrNull(state.settings.manualLat) != null && numOrNull(state.settings.manualLon) != null);
  }
  function coords() {
    if (geo.lat != null && geo.lon != null) return { lat: geo.lat, lon: geo.lon, source: 'gps' };
    const la = numOrNull(state.settings.manualLat), lo = numOrNull(state.settings.manualLon);
    if (la != null && lo != null) return { lat: la, lon: lo, source: 'manual' };
    return null;
  }
  function currentEnv() {
    const c = coords();
    const alt = geo.demAlt != null ? geo.demAlt : (geo.alt != null ? geo.alt : numOrNull(state.settings.manualAlt));
    let temp = weather.temp, hum = weather.hum, wtext = weather.text;
    if (temp == null) temp = numOrNull(state.settings.manualTemp);
    if (hum == null) hum = numOrNull(state.settings.manualHum);
    if (!wtext) wtext = temp != null ? '手动记录' : '';
    return {
      lat: c ? c.lat : null,
      lon: c ? c.lon : null,
      alt: alt,
      acc: geo.acc,
      weatherText: wtext || '—',
      temp: temp,
      hum: hum,
      coordSource: c ? c.source : ''
    };
  }

  function startGeo(low) {
    if (!('geolocation' in navigator)) { geo.status = 'unsupported'; renderEnv(); return; }
    geo.status = 'locating';
    renderEnv();
    if (geo.watch != null) { try { navigator.geolocation.clearWatch(geo.watch); } catch (e) {} }
    geo.watch = navigator.geolocation.watchPosition(pos => {
      const c = pos.coords;
      const moved = (geo.lat == null || Math.abs(geo.lat - c.latitude) > 0.002 || Math.abs(geo.lon - c.longitude) > 0.002);
      geo.lat = c.latitude; geo.lon = c.longitude;
      geo.alt = (c.altitude != null && isFinite(c.altitude)) ? c.altitude : null;
      geo.acc = c.accuracy;
      geo.status = 'ok';
      geo.ts = Date.now();
      if (moved) { geo.demAlt = null; weather.ts = 0; }
      renderEnv();
      renderHeader();
      const t = Date.now();
      if (t - geo.lastCtx > 5 * 60 * 1000) { geo.lastCtx = t; fetchElevation(); refreshWeather(); }
    }, err => {
      geo.status = (err && err.code === 1) ? 'denied' : 'error';
      geo.errCode = err && err.code;
      renderEnv(); renderHeader();
      if (err && err.code !== 1 && !geo.lowTried && !low) {
        geo.lowTried = true;
        setTimeout(function () { startGeo(true); }, 400);
      }
    }, low
      ? { enableHighAccuracy: false, maximumAge: 60000, timeout: 15000 }
      : { enableHighAccuracy: true, maximumAge: 4000, timeout: 25000 });
  }

  async function fetchJSON(url, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms || 8000);
    try {
      const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
      if (!r.ok) throw new Error('http ' + r.status);
      return await r.json();
    } finally { clearTimeout(timer); }
  }

  async function fetchElevation() {
    const c = coords();
    if (!c || !state.settings.weatherOnline) return;
    try {
      const j = await fetchJSON('https://api.open-meteo.com/v1/elevation?latitude=' + c.lat.toFixed(4) + '&longitude=' + c.lon.toFixed(4), 7000);
      if (j && Array.isArray(j.elevation) && typeof j.elevation[0] === 'number') {
        geo.demAlt = Math.round(j.elevation[0]);
        renderEnv();
      }
    } catch (e) { /* 离线时用 GPS 海拔或手填 */ }
  }

  async function refreshWeather(force) {
    const c = coords();
    if (!c) return;
    if (!state.settings.weatherOnline) {
      weather.temp = null; weather.hum = null; weather.text = ''; weather.ts = 0;
      renderEnv(); renderHeader(); return;
    }
    if (!force && weather.ts && Date.now() - weather.ts < 12 * 60 * 1000) return;
    try {
      const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + c.lat.toFixed(3) + '&longitude=' + c.lon.toFixed(3) +
        '&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto&wind_speed_unit=ms';
      const j = await fetchJSON(url, 8000);
      const cur = j && j.current;
      if (cur) {
        weather.temp = (cur.temperature_2m != null) ? Math.round(cur.temperature_2m * 10) / 10 : null;
        weather.hum = (cur.relative_humidity_2m != null) ? Math.round(cur.relative_humidity_2m) : null;
        weather.code = cur.weather_code;
        weather.text = WCODE[cur.weather_code] || '天气';
        weather.ts = Date.now();
        weather.source = 'online';
      }
    } catch (e) {
      weather.source = 'fail';
      if (!weather.ts) { weather.text = ''; }
    }
    renderEnv(); renderHeader();
  }

  /* ============================================================
   * 名录匹配
   * ============================================================ */
  let TAX_INDEX = [];
  function familyLabel(t) { return t.f || t.fl || '未定科'; }
  function genusLabel(t) { return t.g || t.gl || ''; }
  function speciesLabel(t) { return t.s || t.sl || ''; }
  function taxonLevel(t) { return t.sl ? 'species' : (t.gl ? 'genus' : 'family'); }
  function isDetermined(name) { return !!name && name !== '待鉴定' && name !== 'sp.' && name !== 'sp'; }

  function buildTaxIndex() {
    const arr = [];
    state.taxonomy.forEach(t => {
      const add = (name, level) => {
        const k = norm(name);
        if (k) arr.push({ t: t, level: level, name: name, key: k });
      };
      if (t.s) add(t.s, 'species');
      if (t.sl) add(t.sl, 'species');
      if (t.sl) add(t.sl.split(' ')[0], 'genus');
      if (t.g) {
        add(t.g, 'genus');
        if (!t.g.endsWith('属')) add(t.g + '属', 'genus');
      }
      if (t.gl) add(t.gl, 'genus');
      if (t.f) add(t.f, 'family');
      if (t.fl) add(t.fl, 'family');
      (t.a || []).forEach(a => add(a, t.sl ? 'species' : (t.gl ? 'genus' : 'family')));
    });
    arr.sort((a, b) => b.key.length - a.key.length);
    TAX_INDEX = arr;
  }

  function findMatch(text) {
    const s = norm(text);
    if (!s) return null;
    for (const it of TAX_INDEX) { if (s.indexOf(it.key) !== -1) return it; }
    let best = null;
    state.taxonomy.forEach(t => {
      const names = [];
      if (t.g) names.push(t.g.replace(/属$/, ''));
      if (t.gl) names.push(t.gl);
      names.forEach(n => {
        if (n && s.indexOf(norm(n)) !== -1) {
          if (!best || norm(n).length > norm(best.name).length) best = { t: t, level: 'genus', name: n };
        }
      });
    });
    return best;
  }

  function entryToItem(t, level) {
    level = level || taxonLevel(t);
    const item = {
      grp: normalizeGroup(t.grp),
      family: familyLabel(t), familyLatin: t.fl || '',
      genus: t.gl ? (t.g || t.gl) : '', genusLatin: t.gl || '',
      species: '', latin: '', level: level
    };
    if (level === 'species') {
      item.species = t.s || t.sl || '';
      item.latin = t.sl || '';
    } else if (level === 'genus') {
      item.species = 'sp.';
      item.latin = t.gl || '';
    } else {
      item.species = 'sp.';
      item.latin = t.fl || '';
    }
    return item;
  }

  function displayName(r) {
    if (isDetermined(r.species)) return r.species;
    if (r.genus) return r.genus + ' sp.';
    return (r.family || '未定科') + ' sp.';
  }

  function taxonSummaryLabel(r) {
    const fam = r.family || '';
    if (r.level === 'family' || (r.species === 'sp.' && !r.genus)) return fam + ' sp.';
    if (r.level === 'genus' || (r.species === 'sp.' && r.genus)) return [fam, (r.genus || '') + ' sp.'].filter(Boolean).join(' / ');
    return [fam, r.genus, r.species].filter(Boolean).join(' / ');
  }

  function recordToItem(r) {
    return {
      grp: r.grp || '蜘蛛',
      family: r.family || '', familyLatin: r.familyLatin || '',
      genus: r.genus || '', genusLatin: r.genusLatin || '',
      species: r.species || '', latin: r.latin || '', level: r.level || 'species'
    };
  }

  /* ============================================================
   * 中文数字 / 语音解析
   * ============================================================ */
  function cn2num(s) {
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    const map = { '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
    let total = 0, num = 0;
    for (const ch of s) {
      if (map[ch] != null) num = map[ch];
      else if (ch === '十') { total += (num || 1) * 10; num = 0; }
      else if (ch === '百') { total += (num || 1) * 100; num = 0; }
    }
    return (total + num) || 1;
  }
  function parseSegment(seg) {
    let s = norm(seg);
    if (!s) return null;
    let qty = 1, sex = '';
    const qm = s.match(/(\d{1,3}|[零〇一二两三四五六七八九十百]{1,4})(头|只|个|条|号|尾|匹)/);
    if (qm) {
      qty = Math.max(1, Math.min(999, cn2num(qm[1])));
      s = s.replace(qm[0], '');
    }
    const sm = s.match(/(雄性|雌性|公|母|亚成体|成体|幼体|若蛛)/);
    if (sm) {
      sex = sm[1] === '公' ? '雄性' : (sm[1] === '母' ? '雌性' : sm[1]);
      s = s.replace(sm[0], '');
    }
    s = s.replace(/(记录一下|记录|采集到|采到|发现|观察到|这里有|有|共|大约|大概|一只|两只)/g, '');
    if (!s) return null;
    const hit = findMatch(s);
    if (!hit) return null;
    return { item: entryToItem(hit.t, hit.level), qty: qty, sex: sex, raw: seg };
  }
  function parseUtterance(text) {
    const t = String(text || '').replace(/\s+/g, '').replace(/[。！？!?…]/g, '');
    if (!t) return { cmd: 'none' };
    if (!state.session.active && /(开始|开工|启动)/.test(t)) return { cmd: 'start' };
    if (/(结束|收工|停止|完成)(采集|记录|工作)?/.test(t) && t.length <= 12) return { cmd: 'end' };
    if (/(统计|汇总|报数|总结)/.test(t) && t.length <= 10) return { cmd: 'stats' };
    if (/(撤销|删掉|删除)(上一条|刚才|最后一条)?/.test(t) && t.length <= 10) return { cmd: 'undo' };
    const segs = t.split(/[，,；;、]|还有|以及/).map(x => x.trim()).filter(Boolean);
    const items = [];
    segs.forEach(sg => {
      const p = parseSegment(sg);
      if (p) items.push(p);
    });
    if (items.length) return { cmd: 'record', items: items };
    return { cmd: 'unknown', text: t };
  }

  /* ============================================================
   * 编号
   * ============================================================ */
  function noPrefix() { return state.settings.noPrefix || 'HBUARA#'; }
  function noYear() { return state.settings.noYear || String(new Date().getFullYear()); }
  function formatNo(n) { return noPrefix() + noYear() + '-' + pad(n, 3); }
  function currentNoNum() {
    const n = parseInt(state.settings.noNext, 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }
  function nextNo() {
    const n = currentNoNum();
    return { code: noPrefix() + noYear(), seq: n, num: n, no: formatNo(n) };
  }
  /* ============================================================
   * 记录
   * ============================================================ */
  let lastBatch = [];
  let undoHandler = null;

  function buildRecord(item, date) {
    const env = currentEnv();
    const n = nextNo();
    return {
      id: uid(), no: n.no, code: n.code, seq: n.seq,
      date: date, time: nowHM(), createdAt: Date.now(),
      grp: item.grp || '蜘蛛',
      family: item.family, familyLatin: item.familyLatin || '',
      genus: item.genus || '', genusLatin: item.genusLatin || '',
      species: item.species || '', latin: item.latin || '', level: item.level || 'species',
      qty: item.qty || 1, sex: item.sex || '',
      nFemale: item.nFemale || 0, nMale: item.nMale || 0, nSub: item.nSub || 0, nJuv: item.nJuv || 0, nUnk: item.nUnk || 0,
      lat: env.lat, lon: env.lon, alt: env.alt, acc: env.acc,
      weather: env.weatherText || '', temp: env.temp, hum: env.hum,
      habitat: state.settings.habitat || '', method: state.settings.method || '',
      photoId: '', note: '', collector: state.settings.collector || '', site: state.settings.site || ''
    };
  }

  function commitRecords(items, opts) {
    opts = opts || {};
    if (!items || !items.length) return [];
    const date = (state.session.active && state.session.date) ? state.session.date : todayStr();
    const ids = [];
    items.forEach(it => {
      const rec = buildRecord(it.item || it, date);
      if (it.qty) {
        const q = it.qty;
        rec.qty = q;
        const c = emptyCounts();
        if (it.sex === '雌性') c.female = q;
        else if (it.sex === '雄性') c.male = q;
        else if (it.sex === '亚成体') c.sub = q;
        else if (it.sex === '幼体' || it.sex === '若蛛') c.juv = q;
        else c.unk = q;
        rec.nFemale = c.female; rec.nMale = c.male; rec.nSub = c.sub; rec.nJuv = c.juv; rec.nUnk = c.unk;
        rec.sex = countsSummary(c);
      } else if (it.sex) rec.sex = it.sex;
      if (it.note) rec.note = it.note;
      state.records.push(rec);
      ids.push(rec.id);
    });
    saveState();
    renderAll();
    lastBatch = ids;
    const names = items.map(it => displayName(it.item || it)).join('、');
    const totalQty = items.reduce((s, it) => s + (it.qty || 1), 0);
    const lastRec = state.records[state.records.length - 1];
    setTranscript('已记录 ' + names + ' ×' + totalQty + (lastRec ? ' · ' + lastRec.no : ''), true);
    toast('已记录：' + names + ' · ' + totalQty + ' 头', '撤销', function () { undoBatch(ids); });
    if (opts.speak !== false) speak('记录' + names + '，' + totalQty + '头');
    return ids;
  }

  function undoBatch(ids) {
    const set = new Set(ids);
    state.records = state.records.filter(r => {
      if (set.has(r.id)) { if (r.photoId) photoDel(r.photoId); return false; }
      return true;
    });
    saveState(); renderAll();
    toast('已撤销');
  }

  function undoLast() {
    if (lastBatch && lastBatch.length) { undoBatch(lastBatch.slice()); lastBatch = []; }
    else if (state.records.length) {
      const r = state.records[state.records.length - 1];
      undoBatch([r.id]);
    } else toast('没有可撤销的记录');
  }

  /* ============================================================
   * 语音识别
   * ============================================================ */
  let recog = null;
  let voiceOn = false;
  let restartTimer = null;
  let lastErrorToast = 0;

  function setupRecognition() {
    if (!SR) return null;
    const r = new SR();
    r.lang = 'zh-CN';
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onstart = function () { renderMic(); };
    r.onresult = function (ev) {
      let interim = '', finalText = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      if (interim) setTranscript('“' + interim + '”', false);
      if (finalText) {
        setTranscript('“' + finalText + '”', true);
        handleUtterance(finalText);
      }
    };
    r.onerror = function (ev) {
      const err = ev && ev.error;
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        voiceOn = false; renderMic();
        toast('麦克风未获授权，可在地址栏权限里打开');
      } else if (err === 'network' && Date.now() - lastErrorToast > 20000) {
        lastErrorToast = Date.now();
        toast('语音识别需要联网（离线识别见说明文档）');
      } else if (err === 'audio-capture') {
        toast('没有可用的麦克风（检查蓝牙耳机连接）');
      }
    };
    r.onend = function () {
      if (voiceOn) {
        clearTimeout(restartTimer);
        restartTimer = setTimeout(function () {
          if (!voiceOn) return;
          try { r.start(); } catch (e) { /* 稍后由 onend 再试 */ }
        }, 420);
      } else {
        renderMic();
      }
    };
    return r;
  }

  function startListening() {
    if (!SR) { toast('此浏览器不支持语音识别，请用下面的输入框'); return; }
    if (!recog) recog = setupRecognition();
    voiceOn = true;
    renderMic();
    try { recog.start(); } catch (e) { /* 已在运行 */ }
  }
  function stopListening() {
    voiceOn = false;
    clearTimeout(restartTimer);
    if (recog) { try { recog.stop(); } catch (e) {} }
    renderMic();
  }
  function startOneShotVoice() {
    if (!SR) { toast('此浏览器不支持语音识别，请用文字输入'); return; }
    if (!state.settings.voice) { toast('语音输入已在设置中关闭'); return; }
    try {
      const r = new SR();
      r.lang = 'zh-CN';
      r.continuous = false;
      r.interimResults = false;
      r.maxAlternatives = 1;
      r.onresult = function (ev) {
        const txt = ev.results[0][0].transcript;
        setTranscript('“' + txt + '”', true);
        handleUtterance(txt);
      };
      r.onerror = function (ev) {
        if (ev && ev.error === 'not-allowed') toast('麦克风未授权');
        else if (ev && ev.error === 'network') toast('语音识别需要联网');
        else toast('没有听清，请再说一次或手动输入');
      };
      r.start();
      toast('请说一句…');
    } catch (e) { toast('语音启动失败，请用文字输入'); }
  }

  function setTranscript(t, final) {
    const el = $('#transcript');
    if (!el) return;
    el.textContent = t;
    el.classList.toggle('final', !!final);
  }

  /* ============================================================
   * 会话
   * ============================================================ */
  let timerHandle = null;
  function startTimer() {
    clearInterval(timerHandle);
    timerHandle = setInterval(updateTimer, 1000);
    updateTimer();
  }
  function updateTimer() {
    const el = $('#sessionTimer');
    if (!el) return;
    if (!state.session.active || !state.session.start) { el.textContent = '00:00'; return; }
    const s = Math.max(0, Math.floor((Date.now() - state.session.start) / 1000));
    el.textContent = pad(Math.floor(s / 3600), 2) + ':' + pad(Math.floor((s % 3600) / 60), 2) + ':' + pad(s % 60, 2);
  }

  function startSession() {
    if (state.session.active) return;
    state.session = { active: true, start: Date.now(), date: todayStr() };
    saveState();
    startTimer();
    startGeo();
    refreshWeather(true);
    renderAll();
    setTranscript('已开始一次采集；点大圆“+”记录', true);
    speak('开始采集');
  }

  function endSession() {
    if (!state.session.active) { openReport(todayStr()); switchTab('stats'); return; }
    const date = state.session.date || todayStr();
    const recs = recordsForDate(date);
    const sum = summarize(recs);
    openSheet('结束本次采集', [
      '<div class="tax-summary"><div class="tax-path">' + esc(date) + '</div>',
      '<div class="tax-selected"><b>' + sum.total + ' 头 · ' + sum.families + ' 科 ' + sum.genera + ' 属 ' + sum.species + ' 种</b>',
      '<span class="tax-lat">共 ' + recs.length + ' 条记录</span></div></div>',
      '<label class="field"><span>采集小结（可选，会写进日报）</span><textarea id="endNote" placeholder="天气变化、样地情况、特殊观察…">' + esc((state.settings.dayNotes || {})[date] || '') + '</textarea></label>',
      '<div class="grid2" style="margin-top:14px"><button class="btn primary" id="confirmEnd">结束并生成日报</button><button class="btn" id="continueEnd">继续采集</button></div>',
      '<div class="desc" style="margin-top:8px">不填小结也可以直接结束；结束后仍可回到本页继续记录。</div>'
    ].join(''), false);
    document.getElementById('continueEnd').addEventListener('click', closeSheet);
    document.getElementById('confirmEnd').addEventListener('click', function () {
      const note = document.getElementById('endNote').value.trim();
      if (!state.settings.dayNotes) state.settings.dayNotes = {};
      state.settings.dayNotes[date] = note;
      stopListening();
      state.session.active = false;
      saveState();
      closeSheet();
      renderAll();
      openReport(date);
      switchTab('stats');
      speak('采集结束');
    });
  }

  /* ============================================================
   * 语音指令处理
   * ============================================================ */
  async function handleUtterance(text) {
    const r = parseUtterance(text);
    if (r.cmd === 'start') { startSession(); return; }
    if (r.cmd === 'end') { endSession(); return; }
    if (r.cmd === 'stats') {
      switchTab('stats');
      const recs = recordsForDate(state.session.date || todayStr());
      const s = summarize(recs);
      speak('共' + s.total + '头，' + s.families + '科，' + s.genera + '属，' + s.species + '种');
      toast('共 ' + s.total + ' 头 · ' + s.families + ' 科 ' + s.genera + ' 属 ' + s.species + ' 种');
      return;
    }
    if (r.cmd === 'undo') { undoLast(); return; }
    if (r.cmd === 'record') {
      if (!state.session.active) {
        toast('请先说“开始采集”');
        speak('请先说开始采集');
        return;
      }
      commitRecords(r.items);
      return;
    }
    if (r.cmd === 'unknown') {
      if (!state.session.active) { toast('请先说“开始采集”'); return; }
      openVoicePicker(r.text);
    }
  }

  /* ============================================================
   * 渲染：头部/采集页
   * ============================================================ */
  function renderHeader() {
    const g = $('#gpsDot'), gl = $('#gpsLabel');
    const hasG = hasCoords();
    if (g) {
      g.className = 'dot ' + (hasG ? 'ok' : (geo.status === 'locating' ? 'wait' : (geo.status === 'idle' ? '' : 'err')));
      gl.textContent = hasG ? (geo.demAlt != null ? 'GPS+' : 'GPS') : (geo.status === 'locating' ? '定位中' : 'GPS');
    }
    const w = $('#wxDot'), wl = $('#wxLabel');
    const hasW = weather.temp != null;
    if (w) {
      w.className = 'dot ' + (hasW ? 'ok' : (state.settings.weatherOnline ? 'wait' : ''));
      wl.textContent = hasW ? (weather.temp + '℃') : '天气';
    }
  }

  function renderEnv() {
    const env = currentEnv();
    const g = $('#envGeo');
    if (g) {
      if (env.lat != null) {
        g.textContent = fmtCoord(env.lat, env.lon) + (env.acc ? '  ±' + Math.round(env.acc) + 'm' : '');
        g.title = env.coordSource === 'manual' ? '手动坐标' : 'GPS 坐标（WGS84）';
      } else {
        g.textContent = geo.status === 'denied' ? '未授权定位' : (geo.status === 'locating' ? '定位中…' : (geo.status === 'error' ? '定位失败' + (geo.errCode === 2 ? '（不可用）' : geo.errCode === 3 ? '（超时）' : '') : '无定位'));
      }
    }
    const a = $('#envAlt');
    if (a) a.textContent = env.alt != null ? Math.round(env.alt) + ' m' : '—';
    const wx = $('#envWx');
    if (wx) wx.textContent = env.weatherText && env.weatherText !== '—' ? env.weatherText : '—';
    const th = $('#envTh');
    if (th) th.textContent = (env.temp != null ? env.temp + '℃' : '—') + ' / ' + (env.hum != null ? env.hum + '%' : '—');
    renderHeader();
  }

  function renderMic() {
    const btn = $('#micBtn');
    if (!btn) return;
    const active = state.session.active;
    btn.classList.remove('listening');
    btn.querySelector('.mic-ico').style.color = '';
    const ico = btn.querySelector('.mic-ico');
    if (ico) {
      ico.innerHTML = active
        ? '<path d="M12 5v14M5 12h14"/>'
        : '<circle cx="12" cy="12" r="8.5"/><path d="M10 8.2l6 3.8-6 3.8z" fill="currentColor" stroke="none"/>';
    }
    $('#micLabel').textContent = active ? '' : '开始一次采集';
    btn.setAttribute('aria-label', active ? '记录一条' : '开始一次采集');
    btn.title = active ? '记录一条' : '开始一次采集';
    const hint = $('#micHint');
    hint.textContent = active ? '点大圆记录；结束请到“统计”页' : '点一下开始一次采集；记录用大圆“+”';
    const st = $('#sessionState');
    if (st) {
      st.textContent = active ? ('采集中 · ' + state.session.date) : '未开始';
      st.className = 'pill ' + (active ? 'live' : 'dark');
    }
  }

  function renderChips() {
    const hc = $('#habitatChips');
    if (hc) {
      hc.innerHTML = habitatOptions().map(h =>
        '<button class="chip' + (state.settings.habitat === h ? ' on' : '') + '" data-habitat="' + esc(h) + '">' + esc(h) + '</button>'
      ).join('');
    }
    const mc = $('#methodChips');
    if (mc) {
      mc.innerHTML = methodOptions().map(m =>
        '<button class="chip' + (state.settings.method === m ? ' on' : '') + '" data-method="' + esc(m) + '">' + esc(m) + '</button>'
      ).join('');
    }
    const hn = $('#habitatNow');
    if (hn) hn.textContent = [state.settings.habitat, state.settings.method].filter(Boolean).join(' · ') || '未选择';
  }

  function renderRecent() {
    const box = $('#recentList');
    if (!box) return;
    const recs = recordsForDate(defaultDate()).slice(-3).reverse();
    if (!recs.length) {
      box.innerHTML = '<div class="empty">还没有记录。说“横纹金蛛三头”，或点上面的按钮。</div>';
      return;
    }
    box.innerHTML = recs.map(r => recordCard(r, true)).join('');
    hydratePhotos(box);
  }

  function recordCard(r, compact) {
    const name = displayName(r);
    const latin = r.latin || '';
    const showLatin = latin && latin !== name && name.indexOf(latin) !== 0;
    const photo = r.photoId
      ? '<img class="rec-photo" data-photo="' + esc(r.photoId) + '" alt="照片">'
      : '<div class="rec-photo">照片位</div>';
    const meta = [
      (r.grp && r.grp !== '蜘蛛') ? groupLabel(r.grp) : '蜘蛛目',
      r.time || '',
      (r.lat != null ? r.lat.toFixed(4) + ',' + r.lon.toFixed(4) : ''),
      (r.alt != null ? Math.round(r.alt) + 'm' : ''),
      (r.temp != null ? r.temp + '℃' : ''),
      (r.habitat || ''),
      (r.sex || '')
    ].filter(Boolean).map(x => '<span>' + esc(x) + '</span>').join('');
    return '<div class="rec" data-rec="' + esc(r.id) + '">' + photo +
      '<div class="rec-main">' +
      '<div class="rec-top"><div><div class="rec-name">' + esc(name) + '</div>' +
      (showLatin ? '<div class="rec-latin">' + esc(latin) + '</div>' : '') + '</div>' +
      '<span class="rec-qty">×' + r.qty + '</span></div>' +
      '<div class="rec-meta">' + meta + '</div>' +
      '<div class="rec-top" style="margin-top:3px"><span class="rec-no">' + esc(r.no) + '</span>' +
      '<span class="rec-acts">' + (compact ? '' :
        '<button data-edit="' + esc(r.id) + '">编辑</button><button data-del="' + esc(r.id) + '">删除</button>') +
      '</span></div></div></div>';
  }

  /* ============================================================
   * 统计 / 日期
   * ============================================================ */
  function defaultDate() {
    return (state.session.active && state.session.date) ? state.session.date : todayStr();
  }
  function recordsForDate(date) {
    return state.records.filter(r => r.date === date)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }
  function allDates() {
    const set = new Set(state.records.map(r => r.date));
    set.add(todayStr());
    if (state.session.date) set.add(state.session.date);
    return Array.from(set).filter(Boolean).sort().reverse();
  }
  function summarize(recs) {
    const fam = new Set(), gen = new Set(), sp = new Set();
    let total = 0;
    recs.forEach(r => {
      total += (Number(r.qty) || 0);
      if (r.family) fam.add(r.family);
      if (r.genus) gen.add(r.genus);
      if (isDetermined(r.species)) sp.add(r.species);
    });
    return { total: total, families: fam.size, genera: gen.size, species: sp.size };
  }

  function familyRows(recs) {
    const map = new Map();
    recs.forEach(r => {
      const k = r.family || '未记录';
      if (!map.has(k)) map.set(k, { family: k, latin: r.familyLatin || '', qty: 0, genera: new Set(), species: new Set(), n: 0, codes: new Set() });
      const o = map.get(k);
      o.qty += Number(r.qty) || 0;
      o.n++;
      if (r.genus) o.genera.add(r.genus);
      if (isDetermined(r.species)) o.species.add(r.species);
      if (r.code) o.codes.add(r.code);
    });
    return Array.from(map.values()).sort((a, b) => b.qty - a.qty);
  }

  function renderStats() {
    const sel = $('#statDate');
    if (!sel) return;
    const dates = allDates();
    const def = defaultDate();
    const cur = (sel.value && dates.indexOf(sel.value) !== -1) ? sel.value : (dates.indexOf(def) !== -1 ? def : dates[0]);
    sel.innerHTML = dates.map(d => '<option value="' + d + '"' + (d === cur ? ' selected' : '') + '>' + d + (d === todayStr() ? ' 今天' : '') + '</option>').join('');
    const recs = recordsForDate(cur);
    const s = summarize(recs);
    $('#statTotal').textContent = s.total;
    $('#statFamilies').textContent = s.families;
    $('#statGenera').textContent = s.genera;
    $('#statSpecies').textContent = s.species;

    const rows = familyRows(recs);
    $('#familyTable').innerHTML = rows.length
      ? '<thead><tr><th>科</th><th>拉丁科名</th><th class="num">头数</th><th class="num">属</th><th class="num">种</th></tr></thead><tbody>' +
        rows.map(o => '<tr><td>' + esc(o.family) + '</td><td class="lat">' + esc(o.latin) + '</td><td class="num">' + o.qty + '</td><td class="num">' + o.genera.size + '</td><td class="num">' + o.species.size + '</td></tr>').join('') + '</tbody>'
      : '<tbody><tr><td class="muted">这一天还没有记录</td></tr></tbody>';

    const sp = new Map();
    recs.forEach(r => {
      const k = r.family + '|' + r.genus + '|' + r.species;
      if (!sp.has(k)) sp.set(k, { r: r, qty: 0, n: 0 });
      const o = sp.get(k); o.qty += Number(r.qty) || 0; o.n++;
    });
    const spRows = Array.from(sp.values()).sort((a, b) => b.qty - a.qty);
    $('#speciesTable').innerHTML = spRows.length
      ? '<thead><tr><th>科 / 属 / 种</th><th>拉丁名</th><th class="num">头数</th></tr></thead><tbody>' +
        spRows.map(o => '<tr><td>' + esc(taxonSummaryLabel(o.r)) + '</td><td class="lat">' + esc(o.r.latin) + '</td><td class="num">' + o.qty + '</td></tr>').join('') + '</tbody>'
      : '<tbody><tr><td class="muted">—</td></tr></tbody>';
  }

  /* ============================================================
   * 记录页
   * ============================================================ */
  function renderList() {
    const sel = $('#listDate');
    if (!sel) return;
    const dates = allDates();
    const def = defaultDate();
    const cur = (sel.value && dates.indexOf(sel.value) !== -1) ? sel.value : (dates.indexOf(def) !== -1 ? def : dates[0]);
    sel.innerHTML = dates.map(d => '<option value="' + d + '"' + (d === cur ? ' selected' : '') + '>' + d + (d === todayStr() ? ' 今天' : '') + '</option>').join('');
    const recs = recordsForDate(cur).slice().reverse();
    const s = summarize(recs);
    $('#listSummary').textContent = recs.length
      ? recs.length + ' 条记录 · ' + s.total + ' 头 · ' + s.families + ' 科 ' + s.genera + ' 属 ' + s.species + ' 种'
      : '这一天还没有记录';
    const box = $('#recordList');
    if (!recs.length) {
      box.innerHTML = '<div class="empty">暂无记录。<br>到“采集”页开始，或检查日期筛选。</div>';
      return;
    }
    box.innerHTML = recs.map(r => recordCard(r, false)).join('');
    hydratePhotos(box);
  }

  /* ============================================================
   * 设置页
   * ============================================================ */
  function renderSettings() {
    const box = $('#settingsBody');
    if (!box) return;
    const famMap = new Map();
    state.taxonomy.forEach(t => {
      const key = t.f || t.fl;
      if (!key) return;
      if (!famMap.has(key)) famMap.set(key, { key: key, label: familyLabel(t), grp: t.grp, fl: t.fl });
    });
    const fams = Array.from(famMap.values()).sort((a, b) => (a.grp === b.grp ? a.label.localeCompare(b.label, 'zh') : a.grp.localeCompare(b.grp, 'zh')));
    const metaCounts = DATA_META.counts || {};
    const groupLine = state.settings.customTaxonomy
      ? '自定义名录 · ' + state.taxonomy.length + ' 条'
      : '蜘蛛目 ' + (metaCounts.spider_species || 0) + ' 种 · 盲蛛目 ' + (metaCounts.op_species || 0) + ' 种';
    const voiceInfo = SR
      ? '当前浏览器支持语音识别（安卓 Chrome 需要联网）。语音只是辅助，主流程用逐级选择。'
      : '当前浏览器不支持语音识别，只能用文字/逐级选择。安卓 Chrome 打开本页即可使用。';

    box.innerHTML =
      '<div class="set-group"><h3>采集信息</h3>' +
      '<label class="field"><span>采集人</span><input type="text" data-set="collector" value="' + esc(state.settings.collector) + '" placeholder="如：龚某某"></label>' +
      '<label class="field"><span>地点 / 样地</span><input type="text" data-set="site" value="' + esc(state.settings.site) + '" placeholder="如：浙江天目山仙人顶"></label>' +
      '<div class="desc">会写进每条记录与日报，换地点时记得改。</div></div>' +

      '<div class="set-group"><h3>生境 / 采集方法</h3>' +
      '<label class="field"><span>生境（每行一个）</span><textarea id="habitatList" style="min-height:110px">' + esc(habitatOptions().join('\n')) + '</textarea></label>' +
      '<label class="field"><span>采集方法（每行一个）</span><textarea id="methodList" style="min-height:110px">' + esc(methodOptions().join('\n')) + '</textarea></label>' +
      '<div class="grid2"><button class="btn small" data-act="saveLists">保存选项</button><button class="btn small ghost" data-act="resetLists">恢复默认</button></div>' +
      '<div class="desc">每行一个；保存后立即出现在采集页的 chip 里，并随备份保存。</div></div>' +

      '<div class="set-group"><h3>采集编号</h3>' +
      '<div class="grid2"><label class="field"><span>编号前缀</span><input type="text" data-set="noPrefix" value="' + esc(state.settings.noPrefix) + '" placeholder="HBUARA#"></label>' +
      '<label class="field"><span>年份</span><input type="text" data-set="noYear" value="' + esc(state.settings.noYear) + '" placeholder="2026"></label></div>' +
      '<label class="field"><span>下一个编号（数字部分）</span><input type="number" step="1" min="1" data-set="noNext" value="' + esc(state.settings.noNext) + '" placeholder="799"></label>' +
      '<div class="desc">示例：' + esc(formatNo(currentNoNum())) + '。每保存一条自动 +1；单条编号在记录表单里还能改。</div></div>' +

      '<div class="set-group"><h3>分类名录 <span class="muted">' + state.taxonomy.length + ' 条</span></h3>' +
      '<div class="desc">' + esc(groupLine) + ' · 数据版本 ' + esc(state.settings.taxonomyDataVersion || '未标记') + '<br>' +
      'CSV 每行：目,科中文,科拉丁,属中文,属拉丁,种中文,种拉丁,别名（别名用分号分隔；种或属可留空表示只到属/科）。</div>' +
      '<label class="field"><span>粘贴 CSV 内容</span><textarea id="taxText" placeholder="蜘蛛,园蛛科,Araneidae,金蛛属,Argiope,横纹金蛛,Argiope bruennichi,金蛛"></textarea></label>' +
      '<div class="grid2"><button class="btn small" data-act="taxImport">粘贴并替换</button><button class="btn small" data-act="taxMerge">粘贴并合并</button></div>' +
      '<div class="grid2" style="margin-top:8px"><button class="btn small ghost" data-act="taxFileReplace">选择文件替换</button><button class="btn small ghost" data-act="taxFileMerge">选择文件合并</button></div>' +
      '<input type="file" id="taxFile" accept=".csv,text/csv" hidden>' +
      '<div class="grid2" style="margin-top:8px"><button class="btn small ghost" data-act="taxExport">导出当前名录</button><button class="btn small ghost" data-act="taxReset">恢复内置名录</button></div>' +
      '<div class="desc">内置名录：中国蜘蛛 5875 种 + 盲蛛 1521 种；盲蛛目前只有部分科有 species 级记录。蜘蛛未收录中文名的科显示拉丁名。</div></div>' +

      '<div class="set-group"><h3>语音（辅助）</h3>' +
      '<div class="set-row"><div>单次语音输入<div class="desc">点“语音”说一句，不后台常驻</div></div><input type="checkbox" data-set="voice" ' + (state.settings.voice ? 'checked' : '') + '></div>' +
      '<div class="set-row"><div>语音播报<div class="desc">记录成功后读出名称和编号</div></div><input type="checkbox" data-set="announce" ' + (state.settings.announce ? 'checked' : '') + '></div>' +
      '<button class="btn small ghost" data-act="voiceTest" style="margin-top:10px">测试播报</button>' +
      '<div class="desc">' + esc(voiceInfo) + '</div></div>' +

      '<div class="set-group"><h3>天气与手动值</h3>' +
      '<div class="set-row"><div>在线获取天气<div class="desc">Open-Meteo；无网络时自动用手填值</div></div><input type="checkbox" data-set="weatherOnline" ' + (state.settings.weatherOnline ? 'checked' : '') + '></div>' +
      '<div class="grid2"><label class="field"><span>温度 ℃</span><input type="number" step="0.1" data-set="manualTemp" value="' + esc(state.settings.manualTemp) + '" placeholder="24"></label>' +
      '<label class="field"><span>湿度 %</span><input type="number" step="1" data-set="manualHum" value="' + esc(state.settings.manualHum) + '" placeholder="65"></label></div>' +
      '<div class="grid2"><label class="field"><span>手动纬度</span><input type="number" step="0.00001" data-set="manualLat" value="' + esc(state.settings.manualLat) + '" placeholder="30.2741"></label>' +
      '<label class="field"><span>手动经度</span><input type="number" step="0.00001" data-set="manualLon" value="' + esc(state.settings.manualLon) + '" placeholder="120.1551"></label></div>' +
      '<label class="field"><span>手动海拔 m</span><input type="number" step="1" data-set="manualAlt" value="' + esc(state.settings.manualAlt) + '" placeholder="45"></label>' +
      '<div class="desc">定位失败或没有信号时使用；有 GPS 时以 GPS 为准。</div></div>' +

      '<div class="set-group"><h3>数据</h3>' +
      '<div class="grid2"><button class="btn small" data-act="backup">导出备份 (JSON)</button><button class="btn small" data-act="restore">恢复备份</button></div>' +
      '<button class="btn small danger" data-act="clear" style="width:100%;margin-top:8px">清空全部记录</button>' +
      '<div class="desc">换手机、清缓存前务必先导出备份。照片不包含在 JSON 备份中。</div></div>' +

      '<div class="set-group"><h3>关于</h3>' +
      '<div class="desc">蛛迹 v' + APP_VERSION + ' · 离线优先 · 数据不上传。<br>正式研究请遵守当地采集许可与保护物种规定。</div>' +
      '<button class="btn small ghost" data-act="help" style="margin-top:10px">使用说明</button></div>';
    saveState();
  }

  /* ============================================================
   * 弹层
   * ============================================================ */
  let sheetFull = false;
  function openSheet(title, html, full) {
    sheetFull = !!full;
    $('#sheetTitle').textContent = title;
    $('#sheetBody').innerHTML = html;
    $('#sheet').classList.toggle('full', !!full);
    $('#sheetWrap').hidden = false;
  }
  function closeSheet() {
    $('#sheetWrap').hidden = true;
    $('#sheetBody').innerHTML = '';
    sheetFull = false;
  }

  function openHelp() {
    openSheet('使用说明', [
      '<div class="set-group"><h3>主流程：逐级选择</h3><div class="desc" style="font-size:12.5px;line-height:1.9">',
      '1. 点“＋ 记录一条”，先选<b>科</b>；点科名进入属，点属名进入种。<br>',
      '2. 任意一级都可以点该行右侧的 <b>sp.</b>，直接记到这一级（如“园蛛科 sp.”）。<br>',
      '3. 顶部搜索框可以输入科/属/种/拉丁名，<b>直接跳到种</b>，不必逐级点。<br>',
      '4. 记录编号自动生成，也可以在表单里手动改。',
      '</div></div>',
      '<div class="set-group"><h3>语音只是辅助</h3><div class="desc" style="line-height:1.9">',
      '开始采集后仍可说 <b>“横纹金蛛三头”</b> 直接记一条，或说“结束采集”。<br>',
      '语音识别需要联网；听不清时用逐级选择，不会写错。',
      '</div></div>',
      '<div class="set-group"><h3>名录</h3><div class="desc" style="line-height:1.9">',
      '内置：中国蜘蛛 5875 种 + 盲蛛 1521 种（盲蛛部分科暂无种级记录）。<br>',
      '“设置 → 分类名录”可粘贴 CSV 或选择 CSV 文件导入，8 列：类群,科中文,科拉丁,属中文,属拉丁,种中文,种拉丁,别名。',
      '</div></div>',
      '<div class="set-group"><h3>数据安全</h3><div class="desc" style="line-height:1.9">',
      '记录保存在浏览器本地，不上传服务器。<br>',
      '每天收工后到“设置 → 数据”导出 JSON 备份，并导出 CSV/PDF。<br>',
      '不要用“清除浏览数据”清理本站，否则记录会丢。',
      '</div></div>'
    ].join(''), false);
  }

  /* ============================================================
   * 分级名录浏览器 + 记录表单
   * ============================================================ */
  let taxFileMode = true;
  let browser = {
    step: 'family', grp: '全部', query: '', family: null, genus: null,
    editing: null, item: null, no: '', qty: 1, sex: '', habitat: '', method: '',
    note: '', photo: null, photoChanged: false
  };

  function activeDate() {
    return (state.session.active && state.session.date) ? state.session.date : todayStr();
  }
  function emptyCounts() { return { female: 0, male: 0, sub: 0, juv: 0, unk: 0 }; }
  function countsTotal(c) { return (c.female || 0) + (c.male || 0) + (c.sub || 0) + (c.juv || 0) + (c.unk || 0); }
  function countsSummary(c) {
    const parts = [];
    if (c.female) parts.push('♀' + c.female);
    if (c.male) parts.push('♂' + c.male);
    if (c.sub) parts.push('亚' + c.sub);
    if (c.juv) parts.push('幼' + c.juv);
    if (c.unk) parts.push('未分' + c.unk);
    return parts.join(' ');
  }
  function recordCounts(r) {
    if (r && (r.nFemale != null || r.nMale != null || r.nSub != null || r.nJuv != null || r.nUnk != null)) {
      return { female: r.nFemale || 0, male: r.nMale || 0, sub: r.nSub || 0, juv: r.nJuv || 0, unk: r.nUnk || 0 };
    }
    const c = emptyCounts();
    const q = Number(r && r.qty) || 1;
    const sex = (r && r.sex) || '';
    if (sex === '雌性') c.female = q;
    else if (sex === '雄性') c.male = q;
    else if (sex === '亚成体') c.sub = q;
    else if (sex === '幼体' || sex === '若蛛') c.juv = q;
    else c.unk = q;
    return c;
  }
  function normalizeRecord(r) {
    const c = recordCounts(r);
    r.nFemale = c.female; r.nMale = c.male; r.nSub = c.sub; r.nJuv = c.juv; r.nUnk = c.unk;
    if (!r.sex) r.sex = countsSummary(c);
    return r;
  }
  function readCounts() {
    const c = emptyCounts();
    document.querySelectorAll('#sheetBody [data-count]').forEach(inp => {
      const k = inp.getAttribute('data-count');
      if (Object.prototype.hasOwnProperty.call(c, k)) c[k] = Math.max(0, parseInt(inp.value, 10) || 0);
    });
    return c;
  }
  function updateCountTotal() {
    const c = readCounts();
    const el = document.getElementById('countTotal');
    if (el) el.textContent = String(countsTotal(c));
  }
  function familyAsTaxon(f) {
    return { grp: f.grp, f: f.f, fl: f.fl, g: '', gl: '', s: '', sl: '' };
  }
  function genusAsTaxon(g) {
    return { grp: g.grp, f: g.f, fl: g.fl, g: g.g, gl: g.gl, s: '', sl: '' };
  }
  function taxonPath(t) {
    return [groupLabel(t.grp), t.f || t.fl, t.g || t.gl].filter(Boolean).join(' › ');
  }

  function familyList(grp) {
    const map = new Map();
    state.taxonomy.forEach(t => {
      if (grp && grp !== '全部' && t.grp !== grp) return;
      const key = t.grp + '|' + t.f + '|' + t.fl;
      if (!map.has(key)) map.set(key, { grp: t.grp, f: t.f, fl: t.fl, genera: new Set(), species: 0 });
      const x = map.get(key);
      if (t.gl) x.genera.add(t.gl);
      if (t.sl) x.species++;
    });
    const order = { '蜘蛛': 0, '盲蛛': 1 };
    return Array.from(map.values()).sort((a, b) => ((order[a.grp] ?? 2) - (order[b.grp] ?? 2)) || (b.species - a.species) || (a.f || a.fl).localeCompare(b.f || b.fl, 'zh'));
  }

  function genusList(fam) {
    const map = new Map();
    state.taxonomy.forEach(t => {
      if (t.grp !== fam.grp || t.f !== fam.f || t.fl !== fam.fl || !t.gl) return;
      if (!map.has(t.gl)) map.set(t.gl, { grp: fam.grp, f: fam.f, fl: fam.fl, g: t.g, gl: t.gl, species: 0 });
      const x = map.get(t.gl);
      if (!x.g && t.g) x.g = t.g;
      if (t.sl) x.species++;
    });
    return Array.from(map.values()).sort((a, b) => (a.g || a.gl).localeCompare(b.g || b.gl, 'zh'));
  }

  function speciesList(fam, gen) {
    return state.taxonomy.filter(t => t.grp === fam.grp && t.f === fam.f && t.fl === fam.fl && t.gl === gen.gl && t.sl)
      .sort((a, b) => (a.s || a.sl).localeCompare(b.s || b.sl, 'zh'));
  }

  function searchTaxa(query) {
    const q = norm(query);
    if (!q) return [];
    const out = [];
    const seen = new Set();
    for (const t of state.taxonomy) {
      const names = [t.s, t.sl, t.g, t.gl, t.f, t.fl].concat(t.a || []);
      if (!names.some(n => n && norm(n).indexOf(q) !== -1)) continue;
      const level = taxonLevel(t);
      const key = level + '|' + (t.gl || '') + '|' + (t.sl || t.f || t.fl);
      if (seen.has(key)) continue;
      seen.add(key);
      const name = level === 'species' ? (t.s || t.sl) : level === 'genus' ? (t.g || t.gl) : familyLabel(t);
      out.push({ t: t, level: level, name: name });
      if (out.length > 400) break;
    }
    out.sort((a, b) => {
      const an = norm(a.name), bn = norm(b.name);
      const sa = an === q ? 0 : an.indexOf(q) === 0 ? 1 : 2;
      const sb = bn === q ? 0 : bn.indexOf(q) === 0 ? 1 : 2;
      const lv = { species: 0, genus: 1, family: 2 };
      return sa - sb || lv[a.level] - lv[b.level] || an.length - bn.length;
    });
    return out.slice(0, 40);
  }

  function browserHTML() {
    return '<div class="tax-crumbs" id="taxCrumbs"></div>' +
      '<div class="tax-search"><input id="taxSearch" type="text" autocomplete="off" placeholder="搜索科 / 属 / 种 / 拉丁名（可跳级）" value="' + esc(browser.query) + '"></div>' +
      '<div class="tax-groups" id="taxGroups"></div>' +
      '<div class="tax-list" id="taxList"></div>';
  }

  function openBrowserStep(step) {
    browser.step = step;
    const title = step === 'family' ? '选择科（可跳级搜索）' : step === 'genus' ? '选择属' : '选择种';
    openSheet(title, browserHTML(), false);
    bindBrowser();
    renderBrowserBody();
  }

  function openFamilyStep(grp, query, editing) {
    browser.step = 'family';
    browser.grp = grp || '全部';
    browser.query = query || '';
    browser.family = null;
    browser.genus = null;
    browser.editing = editing || null;
    browser.item = null;
    openBrowserStep('family');
  }

  function openGenusStep(fam) {
    browser.family = fam;
    browser.genus = null;
    browser.query = '';
    openBrowserStep('genus');
  }

  function openSpeciesStep(gen) {
    browser.genus = gen;
    browser.query = '';
    openBrowserStep('species');
  }

  function openTaxonBrowser(query, editing) {
    ensureLocation();
    openFamilyStep('全部', query || '', editing || null);
  }

  function ensureLocation() {
    if (hasCoords()) return;
    if (geo.status !== 'locating') { startGeo(); refreshWeather(true); }
  }

  function taxRowHTML(i, name, latin, count, withSp) {
    return '<div class="tax-row">' +
      '<button type="button" class="tax-main" data-open="' + i + '">' +
      '<span class="tax-name">' + esc(name) + '</span>' +
      (latin && latin !== name ? '<span class="tax-lat">' + esc(latin) + '</span>' : '') +
      (count ? '<span class="tax-count">' + esc(count) + '</span>' : '') +
      '</button>' +
      (withSp ? '<button type="button" class="tax-sp" data-sp="' + i + '">sp.</button>' : '') +
      '<span class="tax-chev">›</span></div>';
  }

  function resultRowHTML(i, r) {
    const latin = r.level === 'species' ? (r.t.sl || '') : r.level === 'genus' ? (r.t.gl || '') : (r.t.fl || '');
    const path = [groupLabel(r.t.grp), familyLabel(r.t), genusLabel(r.t)].filter(Boolean).join(' › ');
    const lv = r.level === 'species' ? '种' : r.level === 'genus' ? '属' : '科';
    return '<div class="tax-row">' +
      '<button type="button" class="tax-main" data-res="' + i + '">' +
      '<span class="tax-name"><span class="tax-badge">' + lv + '</span> ' + esc(r.name) + '</span>' +
      (latin && latin !== r.name ? '<span class="tax-lat">' + esc(latin) + '</span>' : '') +
      '<span class="tax-path">' + esc(path) + '</span>' +
      '</button>' +
      (r.level !== 'species' ? '<button type="button" class="tax-sp" data-res-sp="' + i + '">sp.</button>' : '') +
      '<span class="tax-chev">›</span></div>';
  }

  function renderBrowserBody() {
    const cr = document.getElementById('taxCrumbs');
    const groups = document.getElementById('taxGroups');
    const list = document.getElementById('taxList');
    if (!cr || !groups || !list) return;

    if (browser.step === 'family') {
      cr.innerHTML = '<span class="muted">全名录 · ' + state.taxonomy.length + ' 条</span>';
      const gs = ['全部'].concat(Array.from(new Set(state.taxonomy.map(t => t.grp))));
      groups.innerHTML = gs.map(g => '<button class="chip' + (browser.grp === g ? ' on' : '') + '" data-grp="' + esc(g) + '">' + esc(g === '全部' ? '全部' : groupLabel(g)) + '</button>').join('');
    } else if (browser.step === 'genus') {
      cr.innerHTML = '<button class="tax-back" data-back="family">‹ 全部科</button><span class="muted">' + esc(browser.family.grp) + ' › <b>' + esc(familyLabel(browser.family)) + '</b></span>';
      groups.innerHTML = '';
    } else {
      cr.innerHTML = '<button class="tax-back" data-back="genus">‹ ' + esc(familyLabel(browser.family)) + '</button><span class="muted">' + esc(browser.family.grp) + ' › ' + esc(familyLabel(browser.family)) + ' › <b>' + esc(genusLabel(browser.genus)) + '</b></span>';
      groups.innerHTML = '';
    }

    const q = browser.query.trim();
    if (q) {
      const results = searchTaxa(q);
      browser._results = results;
      if (!results.length) {
        list.innerHTML = '<div class="tax-empty">没有匹配“' + esc(q) + '”。<br>可以返回逐级选择，或先记为待鉴定。<br><button class="btn small" data-manual="1" style="margin-top:10px">以“' + esc(q) + '”记为待鉴定</button></div>';
      } else {
        list.innerHTML = results.map((r, i) => resultRowHTML(i, r)).join('');
      }
      return;
    }

    if (browser.step === 'family') {
      const fams = familyList(browser.grp);
      browser._fams = fams;
      list.innerHTML = fams.length ? fams.map((f, i) => taxRowHTML(i, familyLabel(f), f.fl, f.genera.size + ' 属 · ' + f.species + ' 种', true)).join('') : '<div class="tax-empty">这个类群还没有名录。</div>';
    } else if (browser.step === 'genus') {
      const gens = genusList(browser.family);
      browser._gens = gens;
      list.innerHTML = gens.length ? gens.map((g, i) => taxRowHTML(i, genusLabel(g), g.gl, g.species + ' 种', true)).join('') : '<div class="tax-empty">这个科还没有属记录。<br>可以返回上一级，直接按科记录。</div>';
    } else {
      const sps = speciesList(browser.family, browser.genus);
      browser._sps = sps;
      const shown = sps.slice(0, 200);
      list.innerHTML = shown.length
        ? shown.map((t, i) => taxRowHTML(i, t.s || t.sl, t.sl, '', false)).join('') +
          (sps.length > 200 ? '<div class="tax-empty">还有 ' + (sps.length - 200) + ' 种，请在上方搜索缩小范围。</div>' : '')
        : '<div class="tax-empty">这个属还没有种记录。<br>可以返回上一级，直接按属记录。</div>';
    }
  }

  function bindBrowser() {
    const inp = document.getElementById('taxSearch');
    if (inp) inp.addEventListener('input', function () { browser.query = this.value; renderBrowserBody(); });

    const cr = document.getElementById('taxCrumbs');
    if (cr) cr.addEventListener('click', function (e) {
      const b = e.target.closest('[data-back]');
      if (!b) return;
      if (b.dataset.back === 'family') openFamilyStep(browser.grp, '', browser.editing);
      else if (b.dataset.back === 'genus') openGenusStep(browser.family);
    });

    const gs = document.getElementById('taxGroups');
    if (gs) gs.addEventListener('click', function (e) {
      const b = e.target.closest('[data-grp]');
      if (!b) return;
      browser.grp = b.dataset.grp;
      browser.query = '';
      renderBrowserBody();
    });

    const list = document.getElementById('taxList');
    if (list) list.addEventListener('click', function (e) {
      const sp = e.target.closest('[data-sp]');
      if (sp) {
        const i = +sp.dataset.sp;
        if (browser.step === 'family') openRecordForm(entryToItem(familyAsTaxon(browser._fams[i]), 'family'), browser.editing);
        else if (browser.step === 'genus') openRecordForm(entryToItem(genusAsTaxon(browser._gens[i]), 'genus'), browser.editing);
        return;
      }
      const rsp = e.target.closest('[data-res-sp]');
      if (rsp) {
        const r = browser._results[+rsp.dataset.resSp];
        if (r) openRecordForm(entryToItem(r.t, r.level), browser.editing);
        return;
      }
      const res = e.target.closest('[data-res]');
      if (res) {
        chooseSearchResult(browser._results[+res.dataset.res]);
        return;
      }
      const open = e.target.closest('[data-open]');
      if (open) {
        const i = +open.dataset.open;
        if (browser.step === 'family') openGenusStep(browser._fams[i]);
        else if (browser.step === 'genus') openSpeciesStep(browser._gens[i]);
        else openRecordForm(entryToItem(browser._sps[i], 'species'), browser.editing);
        return;
      }
      const man = e.target.closest('[data-manual]');
      if (man) {
        const q = browser.query.trim() || '未命名';
        openRecordForm({
          grp: '其他', family: '待鉴定科', familyLatin: '', genus: '', genusLatin: '',
          species: q.slice(0, 60), latin: '', level: 'species'
        }, browser.editing);
      }
    });
  }

  function chooseSearchResult(r) {
    if (!r) return;
    if (r.level === 'family') openGenusStep({ grp: r.t.grp, f: r.t.f, fl: r.t.fl });
    else if (r.level === 'genus') openSpeciesStep({ grp: r.t.grp, f: r.t.f, fl: r.t.fl, g: r.t.g, gl: r.t.gl });
    else openRecordForm(entryToItem(r.t, 'species'), browser.editing);
  }

  function recordFormHTML() {
    const item = browser.item;
    const e = browser.editing;
    const path = [groupLabel(item.grp), item.family, item.genus].filter(Boolean).join(' › ');
    const photoBlock = state.settings.photo
      ? '<label class="field"><span>照片（可选）</span><input type="file" id="photoInput" accept="image/*" capture="environment"><div id="photoPreview" style="margin-top:8px"></div></label>'
      : '';
    return '<div class="tax-summary">' +
      '<div class="tax-path">' + esc(path) + '</div>' +
      '<div class="tax-selected"><b>' + esc(displayName(item)) + '</b>' +
      (item.latin && !(item.level === 'genus' && item.latin === item.genusLatin) ? '<span class="tax-lat">' + esc(item.latin) + '</span>' : '') + '</div>' +
      '<button type="button" class="link" id="changeTax">更换分类</button></div>' +
      '<label class="field"><span>记录编号（可修改）</span><input type="text" id="noInput" value="' + esc(browser.no) + '"></label>' +
      '<div class="grid2">' +
      '<label class="field"><span>成年雌 ♀</span><input type="number" data-count="female" min="0" max="999" value="' + (browser.counts.female || 0) + '"></label>' +
      '<label class="field"><span>成年雄 ♂</span><input type="number" data-count="male" min="0" max="999" value="' + (browser.counts.male || 0) + '"></label>' +
      '<label class="field"><span>亚成体</span><input type="number" data-count="sub" min="0" max="999" value="' + (browser.counts.sub || 0) + '"></label>' +
      '<label class="field"><span>幼体 / 若蛛</span><input type="number" data-count="juv" min="0" max="999" value="' + (browser.counts.juv || 0) + '"></label></div>' +
      '<div class="grid2" style="align-items:end"><label class="field"><span>未分 / 未记录</span><input type="number" data-count="unk" min="0" max="999" value="' + (browser.counts.unk || 0) + '"></label>' +
      '<div class="count-total">总数 <b id="countTotal">' + countsTotal(browser.counts) + '</b> 头</div></div>' +
      '<div class="grid2"><label class="field"><span>生境</span><select id="habSel">' + ['', ...habitatOptions()].map(h => '<option value="' + esc(h) + '"' + (browser.habitat === h ? ' selected' : '') + '>' + (h || '未选') + '</option>').join('') + '</select></label>' +
      '<label class="field"><span>方法</span><select id="metSel">' + ['', ...methodOptions()].map(m => '<option value="' + esc(m) + '"' + (browser.method === m ? ' selected' : '') + '>' + (m || '未选') + '</option>').join('') + '</select></label></div>' +
      '<label class="field"><span>备注</span><input type="text" id="noteInput" value="' + esc(browser.note) + '" placeholder="网型、寄主、基质…"></label>' +
      photoBlock +
      '<div class="actions" style="margin-top:16px"><button class="btn primary" id="saveRec">' + (e ? '保存修改' : '保存记录') + '</button><button class="btn" id="cancelRec">取消</button></div>' +
      (e ? '<button class="btn danger" id="delRec" style="width:100%;margin-top:8px">删除这条</button>' : '') +
      '<div class="desc" style="margin-top:8px;font-size:11px;color:#7a857a">保存时会写入当前坐标、海拔、天气、温湿度。</div>';
  }

  function openRecordForm(item, editing) {
    if (!item) return;
    ensureLocation();
    browser.item = item;
    browser.editing = editing || null;
    browser.no = editing ? (editing.no || '') : nextNo().no;
    browser.counts = editing ? recordCounts(editing) : { female: 0, male: 0, sub: 0, juv: 0, unk: 1 };
    browser.habitat = editing ? (editing.habitat || '') : (state.settings.habitat || '');
    browser.method = editing ? (editing.method || '') : (state.settings.method || '');
    browser.note = editing ? (editing.note || '') : '';
    browser.photo = null;
    browser.photoChanged = false;
    openSheet(editing ? '编辑记录' : '记录一条', recordFormHTML(), false);
    bindRecordForm();
    if (editing && editing.photoId) {
      photoGet(editing.photoId).then(function (d) {
        if (d && document.getElementById('photoPreview')) {
          browser.photo = d;
          document.getElementById('photoPreview').innerHTML = '<img src="' + d + '" style="width:100%;border-radius:10px;max-height:200px;object-fit:cover"><div class="muted" style="font-size:11px;margin-top:4px">已存照片；重新选择可替换</div>';
        }
      });
    }
  }

  function bindRecordForm() {
    document.querySelectorAll('#sheetBody [data-count]').forEach(function (inp) {
      inp.addEventListener('input', updateCountTotal);
    });
    const pi = document.getElementById('photoInput');
    if (pi) pi.addEventListener('change', async function () {
      const f = pi.files && pi.files[0];
      if (!f) return;
      try {
        browser.photo = await compressImage(f);
        browser.photoChanged = true;
        document.getElementById('photoPreview').innerHTML = '<img src="' + browser.photo + '" style="width:100%;border-radius:10px;max-height:200px;object-fit:cover">';
      } catch (e) { toast('照片读取失败'); }
    });
    const ct = document.getElementById('changeTax');
    if (ct) ct.addEventListener('click', function () { openFamilyStep('全部', '', browser.editing); });
    const save = document.getElementById('saveRec');
    if (save) save.addEventListener('click', saveRecordForm);
    const cancel = document.getElementById('cancelRec');
    if (cancel) cancel.addEventListener('click', closeSheet);
    const del = document.getElementById('delRec');
    if (del) del.addEventListener('click', function () { deleteRecord(browser.editing.id); closeSheet(); });
  }

  async function saveRecordForm() {
    if (!browser.item) return;
    const counts = readCounts();
    let qty = countsTotal(counts);
    if (qty <= 0) { counts.unk = 1; qty = 1; }
    const sex = countsSummary(counts);
    const habitat = document.getElementById('habSel').value;
    const method = document.getElementById('metSel').value;
    const note = document.getElementById('noteInput').value.trim();
    const no = document.getElementById('noInput').value.trim() || browser.no;
    if (!no) { toast('请填写记录编号'); return; }
    const editing = browser.editing;

    if (editing) {
      editing.grp = browser.item.grp;
      editing.family = browser.item.family;
      editing.familyLatin = browser.item.familyLatin;
      editing.genus = browser.item.genus;
      editing.genusLatin = browser.item.genusLatin;
      editing.species = browser.item.species;
      editing.latin = browser.item.latin;
      editing.level = browser.item.level;
      editing.no = no;
      editing.qty = qty;
      editing.sex = sex;
      editing.nFemale = counts.female; editing.nMale = counts.male; editing.nSub = counts.sub;
      editing.nJuv = counts.juv; editing.nUnk = counts.unk;
      editing.habitat = habitat;
      editing.method = method;
      editing.note = note;
      if (browser.photoChanged && browser.photo) {
        if (editing.photoId) await photoDel(editing.photoId);
        const pid = uid();
        try { await photoPut(pid, browser.photo); editing.photoId = pid; } catch (e) { toast('照片保存失败'); }
      }
      saveState(); closeSheet(); renderAll();
      toast('已保存修改');
      return;
    }

    const rec = buildRecord(browser.item, activeDate());
    rec.no = no;
    rec.qty = qty;
    rec.sex = sex;
    rec.nFemale = counts.female; rec.nMale = counts.male; rec.nSub = counts.sub;
    rec.nJuv = counts.juv; rec.nUnk = counts.unk;
    rec.habitat = habitat;
    rec.method = method;
    rec.note = note;
    if (browser.photoChanged && browser.photo) {
      const pid = uid();
      try { await photoPut(pid, browser.photo); rec.photoId = pid; } catch (e) { toast('照片保存失败'); }
    }
    state.records.push(rec);
    saveState(); closeSheet(); renderAll();
    toast('已记录 ' + displayName(rec) + ' · ' + qty + ' 头', '撤销', function () { undoBatch([rec.id]); });
    speak('记录' + displayName(rec) + '，' + qty + '头');
  }

  function openVoicePicker(text) {
    openTaxonBrowser(text, browser.editing);
  }

  function deleteRecord(id) {
    const rec = state.records.find(r => r.id === id);
    if (!rec) return;
    if (!confirm('删除 ' + rec.no + '（' + displayName(rec) + '）？')) return;
    if (rec.photoId) photoDel(rec.photoId);
    state.records = state.records.filter(r => r.id !== id);
    saveState(); renderAll();
    toast('已删除');
  }

  /* ============================================================
   * 报告 / 导出
   * ============================================================ */
  function buildReport(recs, date) {
    const s = summarize(recs);
    const frows = familyRows(recs);
    const collector = (recs[0] && recs[0].collector) || state.settings.collector || '—';
    const site = (recs[0] && recs[0].site) || state.settings.site || '—';
    const first = recs[0], last = recs[recs.length - 1];
    const weatherLine = first ? [first.weather, first.temp != null ? first.temp + '℃' : '', first.hum != null ? first.hum + '%' : ''].filter(Boolean).join(' · ') : '—';
    const order = recs.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

    return '<div class="rep">' +
      '<div class="rep-head">' +
      '<div class="rep-kicker">FIELD RECORD · ARACHNIDA</div>' +
      '<div class="rep-title">野外蛛形动物采集日报</div>' +
      '<div class="rep-sub">' + esc(date) + ' · ' + esc(site) + '</div>' +
      '<div class="rep-meta">' +
      '<div>采集人：' + esc(collector) + '</div><div>记录条数：' + recs.length + '</div>' +
      '<div>时间：' + esc(first ? first.time : '—') + ' — ' + esc(last ? last.time : '—') + '</div>' +
      '<div>天气：' + esc(weatherLine) + '</div>' +
      '<div>地点：' + esc(site) + '</div><div>坐标基准：WGS84</div>' +
      '</div></div>' +

      '<div class="rep-cards">' +
      '<div class="rep-card"><b>' + s.total + '</b><span>头 / 只</span></div>' +
      '<div class="rep-card"><b>' + s.families + '</b><span>科</span></div>' +
      '<div class="rep-card"><b>' + s.genera + '</b><span>属</span></div>' +
      '<div class="rep-card"><b>' + s.species + '</b><span>种</span></div>' +
      '</div>' +

      '<h2>各科统计</h2>' +
      '<table><thead><tr><th>科</th><th>拉丁科名</th><th class="num">头数</th><th class="num">属数</th><th class="num">种数</th></tr></thead><tbody>' +
      (frows.length ? frows.map(o => '<tr><td>' + esc(o.family) + '</td><td class="lat">' + esc(o.latin) + '</td><td class="num">' + o.qty + '</td><td class="num">' + o.genera.size + '</td><td class="num">' + o.species.size + '</td></tr>').join('')
        : '<tr><td colspan="5">无记录</td></tr>') +
      '</tbody></table>' +
      ((state.settings.dayNotes || {})[date] ? '<h2>采集小结</h2><div class="rep-note-text">' + esc(state.settings.dayNotes[date]).replace(/\n/g, '<br>') + '</div>' : '') +

      '<h2>采集明细</h2>' +
      '<table class="detail"><thead><tr><th>编号</th><th>科</th><th>属</th><th>种</th><th>拉丁名</th><th class="num">数量</th><th>时间</th><th>经纬度</th><th>海拔</th><th>生境 / 方法</th></tr></thead><tbody>' +
      (order.length ? order.map(r => '<tr>' +
        '<td>' + esc(r.no) + '</td><td>' + esc(r.family) + '</td><td>' + esc(r.genus) + '</td>' +
        '<td>' + esc(r.species) + '</td><td class="lat">' + esc(r.latin) + '</td><td class="num">' + r.qty + (r.sex ? '<br><span style="font-size:8px;font-weight:400;color:#7a877c">' + esc(r.sex) + '</span>' : '') + '</td>' +
        '<td>' + esc(r.time) + '</td><td>' + esc(r.lat != null ? r.lat.toFixed(5) + ', ' + r.lon.toFixed(5) : '—') + '</td>' +
        '<td>' + (r.alt != null ? Math.round(r.alt) + 'm' : '—') + '</td>' +
        '<td>' + esc([r.habitat, r.method].filter(Boolean).join(' / ') || '—') + '</td></tr>').join('')
        : '<tr><td colspan="10">无记录</td></tr>') +
      '</tbody></table>' +

      '<div class="rep-note">备注：海拔为 GPS/DEM 估算值；天气与温湿度为记录时自动获取或手填。物种鉴定结果由采集人负责。</div>' +
      '<div class="rep-foot"><span>蛛迹 · 野外采集记录</span><span>生成于 ' + new Date().toLocaleString('zh-CN') + '</span></div>' +
      '</div>';
  }

  /* ============================================================
   * 直接下载 PDF（图片版，任何浏览器都能保存）
   * ============================================================ */
  const PDF_W = 595.28, PDF_H = 841.89, PDF_CW = 1240, PDF_CH = 1754;
  const PDF_FONT = '"Microsoft YaHei","Noto Sans CJK SC","PingFang SC",sans-serif';

  function pdfCanvas() {
    const c = document.createElement('canvas');
    c.width = PDF_CW; c.height = PDF_CH;
    return c;
  }
  function pdfWrap(ctx, text, maxW, maxLines) {
    text = String(text == null ? '' : text);
    if (!text) return [''];
    const lines = [];
    let cur = '';
    for (const ch of text) {
      const test = cur + ch;
      if (ctx.measureText(test).width > maxW && cur) {
        lines.push(cur); cur = ch;
        if (lines.length >= maxLines) break;
      } else cur = test;
    }
    if (cur && lines.length < maxLines) lines.push(cur);
    if (!lines.length) lines.push('');
    if (lines.join('').length < text.length) lines[lines.length - 1] = lines[lines.length - 1].slice(0, -1) + '…';
    return lines;
  }
  function pdfDrawTable(ctx, x, y, widths, headers, rows, opts) {
    const font = (opts && opts.font) || 16;
    const pad = 8;
    const lh = font + 6;
    ctx.font = font + 'px ' + PDF_FONT;
    const rowH = [];
    rows.forEach(row => {
      let n = 1;
      row.forEach((cell, i) => { n = Math.max(n, pdfWrap(ctx, cell, widths[i] - pad * 2, 2).length); });
      rowH.push(Math.max(40, n * lh + pad * 2));
    });
    const headerH = 38;
    const totalW = widths.reduce((a, b) => a + b, 0);
    ctx.fillStyle = '#173A2B';
    ctx.fillRect(x, y, totalW, headerH);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold ' + (font - 1) + 'px ' + PDF_FONT;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    let cx = x;
    headers.forEach((h, i) => {
      ctx.fillText(h, cx + pad, y + headerH / 2);
      cx += widths[i];
    });
    let cy = y + headerH;
    rows.forEach((row, ri) => {
      const h = rowH[ri];
      if (ri % 2 === 1) { ctx.fillStyle = '#FAF8F1'; ctx.fillRect(x, cy, totalW, h); }
      ctx.strokeStyle = '#D9D2C2'; ctx.lineWidth = 1;
      ctx.strokeRect(x, cy, totalW, h);
      let xx = x;
      ctx.font = font + 'px ' + PDF_FONT;
      row.forEach((cell, i) => {
        const lines = pdfWrap(ctx, cell, widths[i] - pad * 2, 2);
        ctx.fillStyle = (i === 4 && opts && opts.italicLatin) ? '#3E5447' : '#1E2A23';
        ctx.font = (i === 4 && opts && opts.italicLatin ? 'italic ' : '') + font + 'px ' + PDF_FONT;
        let ty = cy + pad;
        lines.forEach(line => { ctx.fillText(line, xx + pad, ty); ty += lh; });
        xx += widths[i];
      });
      cy += h;
    });
    ctx.strokeStyle = '#D9D2C2';
    ctx.strokeRect(x, y, totalW, cy - y);
    return cy;
  }
  function pdfHeader(ctx, title, sub) {
    const m = 70;
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, PDF_CW, PDF_CH);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillStyle = '#2D7A58'; ctx.font = 'bold 14px ' + PDF_FONT;
    ctx.fillText('FIELD RECORD · ARACHNIDA', m, 56);
    ctx.fillStyle = '#172A20'; ctx.font = 'bold 44px ' + PDF_FONT;
    ctx.fillText(title, m, 82);
    ctx.fillStyle = '#5F6F62'; ctx.font = '20px ' + PDF_FONT;
    ctx.fillText(sub, m, 134);
    ctx.strokeStyle = '#173A2B'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(m, 176); ctx.lineTo(PDF_CW - m, 176); ctx.stroke();
  }
  function pdfFooter(ctx, page, total) {
    const m = 70;
    ctx.strokeStyle = '#D9D2C2'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(m, PDF_CH - 62); ctx.lineTo(PDF_CW - m, PDF_CH - 62); ctx.stroke();
    ctx.fillStyle = '#7A877C'; ctx.font = '12px ' + PDF_FONT;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('蛛迹 · 野外采集记录', m, PDF_CH - 38);
    ctx.textAlign = 'right';
    ctx.fillText('第 ' + page + ' / ' + total + ' 页', PDF_CW - m, PDF_CH - 38);
    ctx.textAlign = 'left';
  }
  function pdfDetailRows(recs, start, count) {
    return recs.slice(start, start + count).map(r => [
      r.no,
      r.family || '',
      r.genus || '',
      r.species || '',
      r.latin || '',
      String(r.qty || ''),
      r.time || '',
      r.lat != null ? r.lat.toFixed(5) + ', ' + r.lon.toFixed(5) : '—',
      r.alt != null ? Math.round(r.alt) + 'm' : '—',
      [r.habitat, r.method].filter(Boolean).join(' / ') || '—'
    ]);
  }

  function pdfEllipsis(ctx, text, maxW) {
    text = String(text == null ? '' : text);
    if (ctx.measureText(text).width <= maxW) return text;
    let s = text;
    while (s.length && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s + '…';
  }
  function pdfRecordCard(ctx, x, y, w, r) {
    const h = 124;
    ctx.fillStyle = '#FAF8F1'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#D9D2C2'; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = '#2D7A58'; ctx.fillRect(x, y, 5, h);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillStyle = '#173A2B'; ctx.font = 'bold 17px ' + PDF_FONT;
    ctx.fillText(pdfEllipsis(ctx, r.no, w - 150), x + 18, y + 12);
    ctx.textAlign = 'right'; ctx.fillStyle = '#2D6A4F'; ctx.font = 'bold 17px ' + PDF_FONT;
    ctx.fillText('×' + (r.qty || 1), x + w - 16, y + 12);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#1E2A23'; ctx.font = 'bold 18px ' + PDF_FONT;
    ctx.fillText(pdfEllipsis(ctx, taxonSummaryLabel(r), w - 36), x + 18, y + 38);
    ctx.fillStyle = '#5F6F62'; ctx.font = 'italic 15px ' + PDF_FONT;
    ctx.fillText(pdfEllipsis(ctx, r.latin || '—', w - 36), x + 18, y + 66);
    const meta = [groupLabel(r.grp), r.sex, r.time, r.lat != null ? r.lat.toFixed(5) + ', ' + r.lon.toFixed(5) : '', r.alt != null ? Math.round(r.alt) + 'm' : '', r.temp != null ? r.temp + '℃' : '', r.hum != null ? r.hum + '%' : ''].filter(Boolean).join(' · ');
    ctx.fillStyle = '#3A4A3F'; ctx.font = '14px ' + PDF_FONT;
    ctx.fillText(pdfEllipsis(ctx, meta, w - 36), x + 18, y + 92);
    const hab = [r.habitat, r.method, r.note].filter(Boolean).join(' · ') || '—';
    ctx.fillStyle = '#6F7C72'; ctx.font = '14px ' + PDF_FONT;
    ctx.fillText(pdfEllipsis(ctx, hab, w - 36), x + 18, y + 108);
    return y + h + 10;
  }
  function pdfSummaryPage(date) {
    const recs = recordsForDate(date);
    const s = summarize(recs);
    const frows = familyRows(recs);
    const c = pdfCanvas(); const ctx = c.getContext('2d');
    const m = 70;
    pdfHeader(ctx, '野外蛛形动物采集日报', date + ' · ' + ((recs[0] && recs[0].site) || state.settings.site || '未填写地点'));
    let y = 200;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillStyle = '#3A4A3F'; ctx.font = '16px ' + PDF_FONT;
    const collector = (recs[0] && recs[0].collector) || state.settings.collector || '—';
    const site = (recs[0] && recs[0].site) || state.settings.site || '—';
    const first = recs[0], last = recs[recs.length - 1];
    const weather = first ? [first.weather, first.temp != null ? first.temp + '℃' : '', first.hum != null ? first.hum + '%' : ''].filter(Boolean).join(' · ') : '—';
    const info = [
      ['采集人', collector], ['记录条数', String(recs.length)],
      ['地点', site], ['时间', (first ? first.time : '—') + ' — ' + (last ? last.time : '—')],
      ['天气', weather], ['坐标基准', 'WGS84']
    ];
    info.forEach((pair, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const xx = m + col * 500, yy = y + row * 28;
      ctx.fillStyle = '#7A877C'; ctx.font = '14px ' + PDF_FONT;
      ctx.fillText(pair[0], xx, yy);
      ctx.fillStyle = '#1E2A23'; ctx.font = '15px ' + PDF_FONT;
      ctx.fillText(String(pair[1]).slice(0, 28), xx + 82, yy);
    });
    y += 100;
    const cards = [
      [String(s.total), '头 / 只'], [String(s.families), '科'],
      [String(s.genera), '属'], [String(s.species), '种']
    ];
    const gap = 16, cw = (PDF_CW - m * 2 - gap * 3) / 4;
    cards.forEach((card, i) => {
      const x = m + i * (cw + gap);
      ctx.fillStyle = '#EEF5EC'; ctx.fillRect(x, y, cw, 92);
      ctx.strokeStyle = '#D7E4D4'; ctx.strokeRect(x, y, cw, 92);
      ctx.fillStyle = '#173A2B'; ctx.font = 'bold 38px ' + PDF_FONT; ctx.textAlign = 'center';
      ctx.fillText(card[0], x + cw / 2, y + 16);
      ctx.fillStyle = '#5F6F62'; ctx.font = '14px ' + PDF_FONT;
      ctx.fillText(card[1], x + cw / 2, y + 64);
      ctx.textAlign = 'left';
    });
    y += 126;
    ctx.fillStyle = '#173A2B'; ctx.font = 'bold 24px ' + PDF_FONT;
    ctx.fillText('各科统计', m, y);
    y += 40;
    const rows = frows.slice(0, 12).map(o => [o.family, o.latin, String(o.qty), String(o.genera.size), String(o.species.size)]);
    if (!rows.length) rows.push(['无记录', '', '', '', '']);
    let afterFam = pdfDrawTable(ctx, m, y, [280, 330, 120, 100, 100], ['科', '拉丁科名', '头数', '属数', '种数'], rows, { font: 17, italicLatin: false });
    const dayNote = (state.settings.dayNotes || {})[date];
    if (dayNote) {
      afterFam += 22;
      ctx.fillStyle = '#173A2B'; ctx.font = 'bold 20px ' + PDF_FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('采集小结', m, afterFam);
      afterFam += 28;
      ctx.fillStyle = '#3A4A3F'; ctx.font = '15px ' + PDF_FONT;
      const lines = pdfWrap(ctx, dayNote, PDF_CW - m * 2, 3);
      lines.forEach(line => { ctx.fillText(line, m, afterFam); afterFam += 21; });
    }
    if (recs.length) {
      afterFam += 24;
      ctx.fillStyle = '#173A2B'; ctx.font = 'bold 22px ' + PDF_FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('采集记录', m, afterFam);
      afterFam += 34;
      recs.slice(0, 4).forEach(r => { afterFam = pdfRecordCard(ctx, m, afterFam, PDF_CW - m * 2, r); });
    }
    return c;
  }
  function pdfDetailPages(date) {
    const recs = recordsForDate(date).slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    if (recs.length <= 4) return [];
    const pages = [];
    const per = 11;
    for (let start = 4; start < recs.length; start += per) {
      const c = pdfCanvas(); const ctx = c.getContext('2d');
      const m = 70;
      pdfHeader(ctx, '采集记录（续）', date + ' · 第 ' + (Math.floor((start - 4) / per) + 1) + ' 部分');
      let y = 200;
      recs.slice(start, start + per).forEach(r => { y = pdfRecordCard(ctx, m, y, PDF_CW - m * 2, r); });
      pages.push(c);
    }
    return pages;
  }
  function jpegBytes(dataUrl) {
    const b64 = dataUrl.split(',')[1];
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }
  function imagePdfBlob(canvases) {
    const chunks = []; let len = 0;
    const put = data => { const b = typeof data === 'string' ? new TextEncoder().encode(data) : data; chunks.push(b); len += b.length; };
    put('%PDF-1.4\n');
    const n = canvases.length;
    const objCount = 2 + n * 3;
    const offsets = new Array(objCount + 1).fill(0);
    const obj = (num, parts) => {
      offsets[num] = len;
      put(num + ' 0 obj\n');
      parts.forEach(put);
      put('\nendobj\n');
    };
    obj(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
    const kids = canvases.map((_, i) => (3 + i * 3) + ' 0 R').join(' ');
    obj(2, ['<< /Type /Pages /Count ' + n + ' /Kids [' + kids + '] >>']);
    canvases.forEach((canvas, i) => {
      const pageId = 3 + i * 3, contentId = 4 + i * 3, imgId = 5 + i * 3;
      obj(pageId, ['<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PDF_W + ' ' + PDF_H + '] /Resources << /XObject << /Im0 ' + imgId + ' 0 R >> >> /Contents ' + contentId + ' 0 R >>']);
      const content = 'q ' + PDF_W + ' 0 0 ' + PDF_H + ' 0 0 cm /Im0 Do Q';
      const cb = new TextEncoder().encode(content);
      obj(contentId, ['<< /Length ' + cb.length + ' >>\nstream\n', cb, '\nendstream']);
      const img = jpegBytes(canvas.toDataURL('image/jpeg', 0.9));
      obj(imgId, ['<< /Type /XObject /Subtype /Image /Width ' + PDF_CW + ' /Height ' + PDF_CH + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + img.length + ' >>\nstream\n', img, '\nendstream']);
    });
    const xref = len;
    put('xref\n0 ' + (objCount + 1) + '\n0000000000 65535 f \n');
    for (let i = 1; i <= objCount; i++) put(String(offsets[i]).padStart(10, '0') + ' 00000 n \n');
    put('trailer\n<< /Size ' + (objCount + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF');
    return new Blob(chunks, { type: 'application/pdf' });
  }
  function buildReportPDF(date) {
    const pages = [pdfSummaryPage(date)].concat(pdfDetailPages(date));
    pages.forEach((c, i) => pdfFooter(c.getContext('2d'), i + 1, pages.length));
    return imagePdfBlob(pages);
  }
  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
  }
  function exportReportPDF(date) {
    try {
      const blob = buildReportPDF(date);
      downloadBlob('蛛形动物采集_' + date + '.pdf', blob);
      toast('PDF 已生成（' + Math.round(blob.size / 1024) + ' KB）');
    } catch (e) {
      toast('PDF 生成失败，请改用“打印 / 另存为 PDF”');
    }
  }

  function openReport(date) {
    const recs = recordsForDate(date);
    const html = buildReport(recs, date);
    openSheet('采集日报 · ' + date, [
      '<div class="rep-screen" style="border:1px solid #e2dbc9;border-radius:12px;overflow-x:auto;background:#fff">' + html + '</div>',
      '<div class="grid2" style="margin-top:12px"><button class="btn primary" id="doPdf">下载 PDF 文件</button>',
      '<button class="btn" id="doPrint">打印 / 另存</button></div>',
      '<button class="btn" id="doCsv" style="width:100%;margin-top:8px">导出 CSV</button>',
      '<div class="desc" style="margin-top:8px;font-size:11px;color:#7a857a">“下载 PDF”为图片版，任何浏览器都能保存（夸克/微信可用）；“打印”生成矢量版，适合电脑。</div>'
    ].join(''), false);
    $('#doPdf').addEventListener('click', () => exportReportPDF(date));
    $('#doPrint').addEventListener('click', () => {
      $('#printArea').innerHTML = html;
      setTimeout(() => { try { window.print(); } catch (e) { toast('此浏览器不支持直接打印'); } }, 120);
    });
    $('#doCsv').addEventListener('click', () => exportCSV(date));
  }

  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exportCSV(date) {
    const recs = recordsForDate(date);
    const head = ['记录号', '日期', '时间', '类目', '科', '科拉丁', '属', '属拉丁', '种', '种拉丁', '数量', '成年雌', '成年雄', '亚成体', '幼体', '未分', '性别/虫态',
      '纬度', '经度', '海拔(m)', '定位精度(m)', '天气', '温度(℃)', '湿度(%)', '生境', '采集方法', '照片', '采集人', '地点', '备注'];
    const lines = [head.join(',')];
    recs.forEach(r => {
      lines.push([
        r.no, r.date, r.time, groupLabel(r.grp || ''), r.family, r.familyLatin, r.genus, r.genusLatin, r.species, r.latin, r.qty, r.nFemale || 0, r.nMale || 0, r.nSub || 0, r.nJuv || 0, r.nUnk || 0, r.sex,
        r.lat != null ? r.lat.toFixed(6) : '', r.lon != null ? r.lon.toFixed(6) : '',
        r.alt != null ? Math.round(r.alt) : '', r.acc != null ? Math.round(r.acc) : '',
        r.weather, r.temp != null ? r.temp : '', r.hum != null ? r.hum : '',
        r.habitat, r.method, r.photoId ? '有' : '', r.collector, r.site, r.note
      ].map(csvCell).join(','));
    });
    download('蛛形动物采集_' + date + '.csv', lines.join('\r\n'), 'text/csv');
    toast('CSV 已导出（' + recs.length + ' 条）');
  }

  function exportTaxonomy() {
    const head = ['目', '科中文', '科拉丁', '属中文', '属拉丁', '种中文', '种拉丁', '别名'];
    const lines = [head.join(',')];
    state.taxonomy.forEach(t => {
      lines.push([groupLabel(t.grp), t.f, t.fl, t.g, t.gl, t.s, t.sl, (t.a || []).join(';')].map(csvCell).join(','));
    });
    download('分类名录_' + todayStr() + '.csv', lines.join('\r\n'), 'text/csv');
  }

  /* ============================================================
   * 名录导入
   * ============================================================ */
  function parseCSV(text) {
    const rows = [];
    let row = [], cell = '', q = false;
    const s = String(text || '').replace(/^\ufeff/, '');
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) {
        if (c === '"') {
          if (s[i + 1] === '"') { cell += '"'; i++; }
          else q = false;
        } else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (c === '\r') { /* skip */ }
      else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => String(c).trim() !== ''));
  }

  function importTaxonomy(text, replace) {
    const rows = parseCSV(text).filter(r => r.some(c => String(c).trim() !== ''));
    if (!rows.length) { toast('没有读到内容'); return; }
    let start = 0;
    if (norm(rows[0].join('')).indexOf('科') !== -1 && (norm(rows[0].join('')).indexOf('latin') !== -1 || norm(rows[0].join('')).indexOf('拉丁') !== -1)) start = 1;
    const list = [];
    for (let i = start; i < rows.length; i++) {
      const r = rows[i].map(c => String(c).trim());
      if (!r.length) continue;
      let grp, f, fl, g, gl, s, sl, a;
      if (r.length >= 8) { grp = r[0]; f = r[1]; fl = r[2]; g = r[3]; gl = r[4]; s = r[5]; sl = r[6]; a = r[7]; }
      else if (r.length === 7) { grp = '蜘蛛'; f = r[0]; fl = r[1]; g = r[2]; gl = r[3]; s = r[4]; sl = r[5]; a = r[6]; }
      else if (r.length === 6) { grp = '蜘蛛'; f = r[0]; fl = r[1]; g = r[2]; gl = r[3]; s = r[4]; sl = r[5]; }
      else if (r.length === 5) { grp = '蜘蛛'; f = r[0]; fl = r[1]; g = r[2]; gl = r[3]; s = r[4]; }
      else if (r.length === 4) { grp = '蜘蛛'; f = r[0]; g = r[1]; s = r[2]; sl = r[3]; }
      else if (r.length === 3) { grp = '蜘蛛'; f = r[0]; g = r[1]; s = r[2]; }
      else if (r.length === 2) { grp = '蜘蛛'; f = r[0]; g = r[1]; }
      else { grp = '蜘蛛'; f = r[0]; }
      if (!f && !fl) continue;
      list.push({ grp: normalizeGroup((grp || '蜘蛛').trim()), f: f || '', fl: fl || '', g: g || '', gl: gl || '', s: s || '', sl: sl || '', a: a ? a.split(/[;；]/).map(x => x.trim()).filter(Boolean) : [] });
    }
    if (!list.length) { toast('没有识别到有效行，请检查列顺序'); return; }
    if (replace) state.taxonomy = list;
    else {
      const map = new Map(state.taxonomy.map(t => [t.grp + '|' + t.f + '|' + t.fl + '|' + t.gl + '|' + t.sl + '|' + t.s, t]));
      list.forEach(t => {
        const k = t.grp + '|' + t.f + '|' + t.fl + '|' + t.gl + '|' + t.sl + '|' + t.s;
        if (map.has(k)) map.set(k, Object.assign(map.get(k), t));
        else map.set(k, t);
      });
      state.taxonomy = Array.from(map.values());
    }
    state.settings.customTaxonomy = true;
    state.settings.taxonomyDataVersion = '自定义 ' + todayStr();
    buildTaxIndex();
    saveState();
    renderSettings(); renderChips();
    toast('名录已' + (replace ? '替换' : '合并') + '，共 ' + state.taxonomy.length + ' 条');
  }

  /* ============================================================
   * 备份
   * ============================================================ */
  function backupJSON() {
    const data = {
      app: 'zhuji', version: APP_VERSION, exportedAt: new Date().toISOString(),
      settings: state.settings, taxonomy: state.taxonomy, records: state.records, session: state.session
    };
    download('蛛迹备份_' + todayStr() + '.json', JSON.stringify(data, null, 2), 'application/json');
    toast('备份已导出');
  }
  function restoreJSON(file) {
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const j = JSON.parse(fr.result);
        if (!j || !Array.isArray(j.records) || !Array.isArray(j.taxonomy)) throw new Error('bad');
        if (!confirm('用备份覆盖当前 ' + state.records.length + ' 条记录？此操作不可撤销。')) return;
        state.records = j.records;
        state.taxonomy = (j.taxonomy && j.taxonomy.length ? j.taxonomy : state.taxonomy).map(normalizeTaxon);
        state.settings = Object.assign({}, state.settings, j.settings || {});
        state.settings.customTaxonomy = true;
        state.session = j.session || { active: false, start: null, date: null };
        buildTaxIndex(); saveState(); renderAll(); renderSettings();
        toast('备份已恢复：' + state.records.length + ' 条');
      } catch (e) { toast('备份文件无法读取'); }
    };
    fr.readAsText(file);
  }

  /* ============================================================
   * 渲染总入口 / 标签页
   * ============================================================ */
  function renderCollect() {
    renderMic(); renderChips(); renderRecent();
    const np = $('#noPreview');
    if (np) np.textContent = nextNo().no;
    const active = state.session.active && currentTab === 'collect';
    const bar = $('#sessionBar');
    if (bar) {
      bar.hidden = !active;
      const app = $('.app');
      if (app) app.classList.toggle('session-on', active);
      if (active) {
        const s = summarize(recordsForDate(state.session.date || todayStr()));
        $('#sbTotal').textContent = s.total;
        $('#sbTaxa').textContent = s.families + ' 科 · ' + s.genera + ' 属 · ' + s.species + ' 种';
      }
    }
  }
  function renderAll() {
    renderCollect(); renderEnv(); renderList(); renderStats();
    renderHeader();
  }
  function switchTab(name) {
    currentTab = name;
    $$('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + name));
    $$('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    if (name === 'list') renderList();
    if (name === 'stats') renderStats();
    if (name === 'settings') renderSettings();
    renderCollect();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ============================================================
   * 事件
   * ============================================================ */
  function bind() {
    $$('.tabbar button').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
    document.addEventListener('click', e => {
      const a = e.target.closest('[data-tab]');
      if (a) { e.preventDefault(); switchTab(a.dataset.tab); }
    });

    $('#micBtn').addEventListener('click', () => {
      if (state.session.active) openTaxonBrowser();
      else startSession();
    });

    $('#cmdForm').addEventListener('submit', e => {
      e.preventDefault();
      const v = $('#cmdInput').value.trim();
      if (!v) return;
      $('#cmdInput').value = '';
      setTranscript('“' + v + '”', true);
      handleUtterance(v);
    });

    $('#voiceBtn').addEventListener('click', startOneShotVoice);
    $('#noEdit').addEventListener('click', openNumberEditor);
    $('#geoRetry').addEventListener('click', () => { geo.lowTried = false; startGeo(); refreshWeather(true); toast('正在重新定位'); });
    $('#wxRetry').addEventListener('click', () => { refreshWeather(true); toast('正在更新天气'); });
    $('#envEdit').addEventListener('click', openEnvEditor);

    $('#habitatChips').addEventListener('click', e => {
      const b = e.target.closest('[data-habitat]');
      if (!b) return;
      state.settings.habitat = state.settings.habitat === b.dataset.habitat ? '' : b.dataset.habitat;
      saveState(); renderChips();
    });
    $('#methodChips').addEventListener('click', e => {
      const b = e.target.closest('[data-method]');
      if (!b) return;
      state.settings.method = state.settings.method === b.dataset.method ? '' : b.dataset.method;
      saveState(); renderChips();
    });

    $('#recentList').addEventListener('click', e => {
      const del = e.target.closest('[data-del]');
      if (del) deleteRecord(del.dataset.del);
    });

    $('#listDate').addEventListener('change', renderList);
    $('#statDate').addEventListener('change', renderStats);
    $('#btnCsv').addEventListener('click', () => exportCSV($('#listDate').value || todayStr()));
    $('#btnPdf').addEventListener('click', () => openReport($('#listDate').value || todayStr()));
    $('#btnReport').addEventListener('click', () => openReport($('#statDate').value || todayStr()));
    $('#btnEnd').addEventListener('click', endSession);

    $('#recordList').addEventListener('click', e => {
      const ed = e.target.closest('[data-edit]');
      const del = e.target.closest('[data-del]');
      if (ed) { const r = state.records.find(x => x.id === ed.dataset.edit); if (r) openRecordForm(recordToItem(r), r); }
      if (del) deleteRecord(del.dataset.del);
    });

    $('#sheetClose').addEventListener('click', closeSheet);
    $('#sheetBg').addEventListener('click', closeSheet);

    $('#settingsBody').addEventListener('input', e => {
      const el = e.target;
      const k = el.getAttribute('data-set');
      if (!k) return;
      if (el.type === 'checkbox') state.settings[k] = el.checked;
      else state.settings[k] = el.value;
      saveState();
      if (k === 'weatherOnline') { refreshWeather(true); renderHeader(); }
      if (k === 'collector' || k === 'site') { /* 下条记录生效 */ }
    });
    $('#settingsBody').addEventListener('change', e => {
      const el = e.target;
      if (el.id === 'taxFile') {
        const f = el.files && el.files[0];
        if (!f) return;
        f.text().then(function (txt) { importTaxonomy(txt, taxFileMode); }).catch(function () { toast('文件读取失败'); });
        return;
      }
      const k = el.getAttribute('data-set');
      if (k && el.type === 'checkbox') { state.settings[k] = el.checked; saveState(); }
      const fam = el.getAttribute('data-family');
      if (fam) {
        const v = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
        state.settings.familyCodes[fam] = v || state.settings.familyCodes[fam];
        el.value = state.settings.familyCodes[fam];
        saveState();
      }
    });
    $('#settingsBody').addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'saveLists') {
        const parse = id => document.getElementById(id).value.split(/\n/).map(x => x.trim()).filter(Boolean);
        const hs = parse('habitatList'), ms = parse('methodList');
        if (!hs.length || !ms.length) { toast('生境和方法至少各留一项'); return; }
        state.settings.habitats = hs;
        state.settings.methods = ms;
        if (hs.indexOf(state.settings.habitat) === -1) state.settings.habitat = '';
        if (ms.indexOf(state.settings.method) === -1) state.settings.method = '';
        saveState(); renderChips(); renderSettings();
        toast('生境/方法选项已保存');
      } else if (act === 'resetLists') {
        state.settings.habitats = [];
        state.settings.methods = [];
        saveState(); renderChips(); renderSettings();
        toast('已恢复默认选项');
      } else if (act === 'taxImport' || act === 'taxMerge') {
        const txt = $('#taxText').value.trim();
        if (!txt) { toast('先把 CSV 内容粘贴到文本框'); return; }
        importTaxonomy(txt, act === 'taxImport');
      } else if (act === 'taxExport') exportTaxonomy();
      else if (act === 'taxReset') {
        if (confirm('恢复为内置名录？当前名录会被替换。')) {
          state.taxonomy = TAXONOMY_SEED.map(x => normalizeTaxon(x));
          state.settings.customTaxonomy = false;
          state.settings.familyCodes = {};
          buildTaxIndex(); saveState(); renderSettings(); renderChips();
          toast('已恢复内置名录');
        }
      } else if (act === 'taxFileReplace' || act === 'taxFileMerge') {
        taxFileMode = act === 'taxFileReplace';
        const fi = document.getElementById('taxFile');
        if (fi) { fi.value = ''; fi.click(); }
      } else if (act === 'voiceTest') {
        if (!('speechSynthesis' in window)) { toast('此浏览器不支持语音播报'); return; }
        state.settings.announce = true; saveState(); speak('语音播报正常，开始采集');
        toast('已尝试播报');
      } else if (act === 'backup') backupJSON();
      else if (act === 'restore') {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = 'application/json,.json';
        inp.onchange = () => { if (inp.files && inp.files[0]) restoreJSON(inp.files[0]); };
        inp.click();
      } else if (act === 'clear') {
        if (!state.records.length) { toast('没有记录'); return; }
        if (!confirm('确定清空全部 ' + state.records.length + ' 条记录？建议先导出备份。')) return;
        state.records.forEach(r => { if (r.photoId) photoDel(r.photoId); });
        state.records = []; saveState(); renderAll(); renderSettings();
        toast('已清空');
      } else if (act === 'help') openHelp();
    });
  }

  function openEnvEditor() {
    const s = state.settings;
    openSheet('手动填写环境', [
      '<div class="desc">没有 GPS 或网络时使用。填了坐标后，新记录会用它。<br>Edge 安卓在中国大陆可能无法定位（权限全开也一样），可改用 Chrome/夸克，或在这里手填。</div>',
      '<div class="grid2"><label class="field"><span>纬度</span><input type="number" step="0.00001" id="mLat" value="' + esc(s.manualLat) + '" placeholder="30.2741"></label>',
      '<label class="field"><span>经度</span><input type="number" step="0.00001" id="mLon" value="' + esc(s.manualLon) + '" placeholder="120.1551"></label></div>',
      '<div class="grid2"><label class="field"><span>海拔 m</span><input type="number" step="1" id="mAlt" value="' + esc(s.manualAlt) + '" placeholder="45"></label>',
      '<label class="field"><span>温度 ℃</span><input type="number" step="0.1" id="mTemp" value="' + esc(s.manualTemp) + '" placeholder="24"></label></div>',
      '<label class="field"><span>湿度 %</span><input type="number" step="1" id="mHum" value="' + esc(s.manualHum) + '" placeholder="65"></label>',
      '<button class="btn primary" id="mSave" style="width:100%;margin-top:14px">保存并用于后续记录</button>',
      '<div class="desc" style="margin-top:8px">提示：GPS 正常时仍优先用 GPS。</div>'
    ].join(''), false);
    $('#mSave').addEventListener('click', () => {
      s.manualLat = $('#mLat').value; s.manualLon = $('#mLon').value; s.manualAlt = $('#mAlt').value;
      s.manualTemp = $('#mTemp').value; s.manualHum = $('#mHum').value;
      saveState(); closeSheet(); renderEnv(); renderHeader();
      toast('已保存手动值');
    });
  }

  function openNumberEditor() {
    openSheet('本组采集编号', [
      '<div class="desc">本组编号会按顺序发给每条记录，保存一条自动 +1；单条编号在记录表单里还能改。</div>',
      '<div class="grid2"><label class="field"><span>前缀</span><input type="text" id="noPrefixInput" value="' + esc(state.settings.noPrefix) + '"></label>',
      '<label class="field"><span>年份</span><input type="text" id="noYearInput" value="' + esc(state.settings.noYear) + '"></label></div>',
      '<label class="field"><span>本组起始号（数字）</span><input type="number" id="noNextInput" min="1" step="1" value="' + esc(state.settings.noNext) + '"></label>',
      '<div class="desc">示例：' + esc(formatNo(currentNoNum())) + '</div>',
      '<button class="btn primary" id="noSave" style="width:100%;margin-top:14px">保存</button>'
    ].join(''), false);
    document.getElementById('noSave').addEventListener('click', function () {
      const p = document.getElementById('noPrefixInput').value.trim() || 'HBUARA#';
      const y = document.getElementById('noYearInput').value.trim() || String(new Date().getFullYear());
      const n = Math.max(1, parseInt(document.getElementById('noNextInput').value, 10) || 1);
      state.settings.noPrefix = p;
      state.settings.noYear = y;
      state.settings.noNext = String(n);
      saveState(); closeSheet(); renderCollect();
      toast('本组编号已设为 ' + formatNo(n));
    });
  }

  /* ============================================================
   * 初始化
   * ============================================================ */
  function init() {
    buildTaxIndex();
    $('#verLabel').textContent = 'v' + APP_VERSION;
    bind();
    renderAll();
    updateTimer();

    if (state.session.active) {
      startTimer(); startGeo(); refreshWeather();
      setTranscript('上次采集还在进行中。点麦克风可继续语音。', true);
    } else {
      // 预热定位与天气，方便到点即记
      if (state.settings.manualLat && state.settings.manualLon) { refreshWeather(); }
    }
    renderEnv(); renderHeader();

    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  /* 测试/调试入口（不影响正常使用） */
  window.__zhuji = {
    get state() { return state; },
    parse: parseUtterance,
    commit: commitRecords,
    summarize: summarize,
    recordsForDate: recordsForDate,
    openReport: openReport,
    buildReportPDF: buildReportPDF,
    exportReportPDF: exportReportPDF,
    importTaxonomy: importTaxonomy,
    refresh: renderAll,
    reset: function () { state = defaultState(); buildTaxIndex(); saveState(); renderAll(); renderSettings(); }
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { renderEnv(); renderHeader(); }
  });
  window.addEventListener('beforeunload', saveState);

  init();
})();
