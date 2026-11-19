/**
 * MPHS Scout backend (Google Apps Script, bound to a Google Sheet).
 * Replace your whole Code.gs with this file, then
 * Deploy -> Manage deployments -> pencil -> New version -> Deploy.
 */
const ADMIN_USERNAME = 'YourName';      // only used if the Users tab has no admin at all
const DEFAULT_PASSWORD = '1111';        // every new user starts with this

const FTC_SEASON = 2026;                                   // 2026 = BioBuzz
const FTC_API = 'https://api.ftcscout.org/rest/v1';        // FTCScout public API (no key needed)
const TEST_TEAM = '8533';                                  // used only by testFtcScout()

const SHEETS = { field: 'Field', pit: 'Pit', user: 'Users', target: 'Targets', info: 'TeamInfo' };
const ADMIN_ONLY = { user: true, target: true, info: true };

function doGet() {
  return out_({ ok: true, msg: 'MPHS scouting backend is running' });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: String(err) }); }
  if (body.action === 'lookup') return lookup_(body);      // slow (calls FTCScout): done without holding the lock
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const now = Date.now();
    ensureAdmin_(now);
    if (body.action === 'directory') return directory_(body);
    if (body.action === 'login') return login_(body);
    if (body.action === 'setpw') return setPassword_(body);
    if (body.action === 'resetpw') return resetPassword_(body);
    return sync_(body, now);
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/* ---------- sync ---------- */
const ORGS = ['17190', '17300'];
const owner_ = r => String(r.org || '17190');
function scope_(actor, org) {
  return ORGS.indexOf(String(org)) >= 0 && (actor.data.role === 'admin' || owner_(actor) === String(org));
}
function directory_(body) {
  if (ORGS.indexOf(String(body.org)) < 0) return out_({ok:false,error:'Choose a team'});
  return out_({ok:true,version:2,users:readType_('user',0).filter(u => !u.deleted && owner_(u) === String(body.org)).map(u => ({id:u.id,name:u.data.name,org:owner_(u)}))});
}
function sync_(body, now) {
  const actor = authedUser_(body.userId, body.token);
  if (!actor) return out_({ok:true,auth:false,records:[]});
  const org = String(body.org || '');
  if (!scope_(actor,org)) return out_({ok:false,error:'This account cannot access that team'});
  const rejected = [], existing = {};
  Object.keys(SHEETS).forEach(t => readType_(t,0).forEach(r => existing[r.id] = r));
  const accepted = {};
  (body.records || []).forEach(r => {
    const old = existing[r.id];
    let ok = r && typeof r.id === 'string' && SHEETS[r.type] && r.data && Number.isFinite(r.updatedAt) && owner_(r) === org;
    ok = ok && (!old || (old.type === r.type && owner_(old) === org));
    ok = ok && (!ADMIN_ONLY[r.type] || actor.data.role === 'admin');
    if (r.type === 'user') {
      ok = ok && ['scout','hub','admin'].includes(r.data.role);
      // Users are account metadata only. PINs/hashes/tokens never enter sync records.
      ok = ok && Object.keys(r.data).every(k => ['name','role'].includes(k));
      ok = ok && String(r.data.name || '').trim().length > 0;
      ok = ok && !Object.values(existing).some(u => u.type === 'user' && !u.deleted && u.id !== r.id && owner_(u) === org && u.data.name.toLowerCase() === String(r.data.name).toLowerCase());
      if (old && old.data.role === 'admin' && (r.deleted || r.data.role !== 'admin')) {
        ok = ok && Object.values(existing).some(u => u.type === 'user' && !u.deleted && u.id !== r.id && u.data.role === 'admin');
      }
    }
    if (!ok) { rejected.push(r.id); return; }
    if (old && old.updatedAt > r.updatedAt) return; // do not overwrite a newer copy
    const clean = {id:r.id,type:r.type,org:org,data:r.data,updatedAt:r.updatedAt,deleted:!!r.deleted};
    existing[r.id] = clean;
    if (!accepted[r.type]) accepted[r.type] = [];
    accepted[r.type].push(clean);
  });
  Object.keys(accepted).forEach(t => upsertMany_(t,accepted[t],now));
  let records = [];
  Object.keys(SHEETS).forEach(t => { records = records.concat(readType_(t, Number(body.since)||0).filter(r => owner_(r) === org)); });
  if (!records.some(r => r.id === actor.id)) records.push(findUser_(actor.id));
  return out_({ok:true,auth:true,version:2,now,records,rejected,reason:rejected.length?'Team or role does not permit these changes':''});
}

/* ---------- passwords ---------- */
function hex_(bytes) {
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
function sha_(s) {
  return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s));
}
function serverSecret_() {
  const p = PropertiesService.getScriptProperties();
  let secret = p.getProperty('pinPepper');
  if (!secret) { secret = Utilities.getUuid() + Utilities.getUuid(); p.setProperty('pinPepper',secret); }
  return secret;
}
function pwHash_(userId, pw) { return 'pin2:' + sha_(serverSecret_() + '|' + userId + '|' + pw); }

function authSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('Auth');
  if (!sh) { sh = ss.insertSheet('Auth'); sh.appendRow(['userId', 'pwHash', 'changedAt']); sh.setFrozenRows(1); }
  return sh;
}
function storedHash_(userId) {
  const sh = authSheet_(); const last = sh.getLastRow();
  if (last < 2) return '';
  const vals = sh.getRange(2, 1, last - 1, 2).getValues();
  for (let i = 0; i < vals.length; i++) if (String(vals[i][0]) === String(userId)) return String(vals[i][1] || '').startsWith('pin2:') ? String(vals[i][1]) : '';
  return '';
}
function setStoredHash_(userId, hash) {
  const sh = authSheet_(); const last = sh.getLastRow();
  const ids = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues().map(function (r) { return String(r[0]); }) : [];
  const i = ids.indexOf(String(userId));
  const row = [userId, hash, Date.now()];
  if (i >= 0) sh.getRange(i + 2, 1, 1, 3).setValues([row]); else sh.appendRow(row);
}
function currentHash_(userId) { return storedHash_(userId) || pwHash_(userId, DEFAULT_PASSWORD); }
function tokenFor_(userId) {
  const p = PropertiesService.getScriptProperties(), key = 'session2_' + userId;
  let t = p.getProperty(key);
  if (!t) { t = Utilities.getUuid() + Utilities.getUuid(); p.setProperty(key,t); }
  return t;
}
function revoke_(id) { PropertiesService.getScriptProperties().deleteProperty('session2_' + id); }

function findUser_(id) {
  return readType_('user', 0).filter(function (u) { return u.id === id && !u.deleted; })[0] || null;
}
function authedUser_(userId, token) {
  if (!userId || !token) return null;
  const u = findUser_(userId);
  return u && token === tokenFor_(userId) ? u : null;
}

function login_(body) {
  const u = findUser_(body.loginId);
  const pin = String(body.password || '');
  const cache = CacheService.getScriptCache(), key = 'attempt_' + String(body.loginId);
  const attempts = Number(cache.get(key) || 0);
  if (attempts >= 8) return out_({ok:false,error:'Too many attempts. Try again in 5 minutes.'});
  if (!u || owner_(u) !== String(body.org) || !/^\d{4}$/.test(pin) || pwHash_(u.id,pin) !== currentHash_(u.id)) {
    cache.put(key,String(attempts+1),300);
    return out_({ok:false,error:'Incorrect PIN'});
  }
  cache.remove(key);
  return out_({ok:true,version:2,user:u,token:tokenFor_(u.id),isDefault:!storedHash_(u.id)});
}

function setPassword_(body) {
  const u = authedUser_(body.userId, body.token);
  if (!u) return out_({ ok: false, error: 'Please sign in again' });
  if (pwHash_(u.id, String(body.oldPw || '')) !== currentHash_(u.id)) return out_({ ok: false, error: 'Current PIN is wrong' });
  const np = String(body.newPw || '');
  if (!/^\d{4}$/.test(np)) return out_({ ok: false, error: 'PIN must contain exactly four digits' });
  setStoredHash_(u.id, np === '1111' ? '' : pwHash_(u.id, np));
  revoke_(u.id);
  return out_({ ok: true, token: tokenFor_(u.id) });
}

function resetPassword_(body) {
  const admin = authedUser_(body.userId, body.token);
  if (!admin || admin.data.role !== 'admin') return out_({ ok: false, error: 'Admins only' });
  if (!findUser_(body.targetId)) return out_({ ok: false, error: 'No such user' });
  setStoredHash_(body.targetId, '');
  revoke_(body.targetId);
  return out_({ ok: true });
}

/* ---------- storage ---------- */
function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getSheet_(type) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEETS[type]);
  if (!sh) {
    sh = ss.insertSheet(SHEETS[type]);
    sh.appendRow(['id', 'syncedAt', 'updatedAt', 'deleted', 'json']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function readType_(type, since) {
  const sh = getSheet_(type);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const vals = sh.getRange(2, 1, last - 1, 5).getValues();
  const out = [];
  vals.forEach(function (r) {
    if (Number(r[1]) >= since && r[4]) {
      try { const rec = JSON.parse(r[4]); rec.org = owner_(rec); out.push(rec); } catch (e) { /* skip bad row */ }
    }
  });
  return out;
}

function safe_(v) {
  return (typeof v === 'string' && /^[=+\-@]/.test(v)) ? "'" + v : v;
}

function upsertMany_(type, recs, now) {
  const sh = getSheet_(type);
  let headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const missing = [];
  recs.forEach(function (r) {
    Object.keys(r.data || {}).forEach(function (k) {
      if (headers.indexOf(k) < 0 && missing.indexOf(k) < 0) missing.push(k);
    });
  });
  if (missing.length) {
    sh.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
    headers = headers.concat(missing);
  }
  const last = sh.getLastRow();
  const ids = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues().map(function (r) { return String(r[0]); }) : [];
  recs.forEach(function (rec) {
    const row = headers.map(function (h) {
      if (h === 'id') return rec.id;
      if (h === 'syncedAt') return now;
      if (h === 'updatedAt') return rec.updatedAt;
      if (h === 'deleted') return !!rec.deleted;
      if (h === 'json') return JSON.stringify(rec);
      let v = rec.data && rec.data[h] !== undefined ? rec.data[h] : '';
      if (v && typeof v === 'object') v = JSON.stringify(v);
      return safe_(v);
    });
    const i = ids.indexOf(String(rec.id));
    if (i >= 0) sh.getRange(i + 2, 1, 1, row.length).setValues([row]);
    else { sh.appendRow(row); ids.push(String(rec.id)); }
  });
}

function ensureAdmin_(now) {
  const hasAdmin = readType_('user', 0).some(function (u) { return !u.deleted && u.data && u.data.role === 'admin'; });
  if (!hasAdmin) {
    upsertMany_('user', [{ id: 'u_admin', type: 'user', updatedAt: now, deleted: false,
      data: { name: ADMIN_USERNAME, role: 'admin' } }], now);
  }
}

/* ---------- FTCScout lookups ---------- */
function ftcJson_(r) {
  try { return r && r.getResponseCode() === 200 ? JSON.parse(r.getContentText()) : null; } catch (e) { return null; }
}
function ftcStat_(x) {
  if (!x || typeof x !== 'object') return null;
  const v = Number(x.value);
  return { v: isFinite(v) ? Math.round(v * 10) / 10 : null, r: x.rank != null ? x.rank : null };
}
function ftcFirst_() {
  for (let i = 0; i < arguments.length; i++) if (arguments[i] !== undefined && arguments[i] !== null && arguments[i] !== '') return arguments[i];
  return '';
}

function lookup_(body) {
  const actor = authedUser_(body.userId, body.token);
  if (!actor) return out_({ ok: false, error: 'Please sign in again' });
  if (!scope_(actor,body.org)) return out_({ok:false,error:'Team access denied'});
  const teams = (body.teams || []).map(String).filter(function (t) { return /^\d{1,6}$/.test(t); }).slice(0, 10);
  if (!teams.length) return out_({ ok: true, results: {} });

  // 1) team + quick stats + events for every team, all in parallel
  const reqs = [];
  teams.forEach(function (t) {
    reqs.push({ url: FTC_API + '/teams/' + t, muteHttpExceptions: true });
    reqs.push({ url: FTC_API + '/teams/' + t + '/quick-stats?season=' + FTC_SEASON, muteHttpExceptions: true });
    reqs.push({ url: FTC_API + '/teams/' + t + '/events/' + FTC_SEASON, muteHttpExceptions: true });
  });
  const resps = UrlFetchApp.fetchAll(reqs);

  // 2) names/dates for the events those teams entered
  const parsed = teams.map(function (t, i) {
    return { team: t, rt: resps[3 * i], team_: ftcJson_(resps[3 * i]), quick: ftcJson_(resps[3 * i + 1]), events: ftcJson_(resps[3 * i + 2]) };
  });
  const codes = [];
  parsed.forEach(function (p) {
    (Array.isArray(p.events) ? p.events : []).slice(0, 8).forEach(function (e) {
      if (e && e.eventCode && codes.indexOf(e.eventCode) < 0) codes.push(e.eventCode);
    });
  });
  const evInfo = {};
  if (codes.length) {
    const er = UrlFetchApp.fetchAll(codes.slice(0, 24).map(function (code) {
      return { url: FTC_API + '/events/' + FTC_SEASON + '/' + code, muteHttpExceptions: true };
    }));
    codes.slice(0, 24).forEach(function (code, i) { evInfo[code] = ftcJson_(er[i]) || {}; });
  }

  // 3) build records
  const now = Date.now();
  const results = {}, recs = [];
  parsed.forEach(function (p) {
    const code = p.rt ? p.rt.getResponseCode() : 0;
    const tm = p.team_;
    if (!tm) {
      if (code === 404) {
        recs.push(infoRec_(p.team, now, { team: p.team, found: false, error: 'Not found on FTCScout', fetchedAt: now, season: FTC_SEASON }));
        results[p.team] = { ok: false, error: 'Not found on FTCScout' };
      } else {
        results[p.team] = { ok: false, error: 'FTCScout error ' + code };   // do not overwrite old data on a temporary failure
      }
      return;
    }
    const loc = tm.location && typeof tm.location === 'object' ? tm.location : {};
    const q = p.quick || {};
    const events = (Array.isArray(p.events) ? p.events : []).slice(0, 8).map(function (e) {
      const s = (e && e.stats) || {}, ei = evInfo[e && e.eventCode] || {};
      const opr = s.opr && typeof s.opr === 'object' ? ftcFirst_(s.opr.totalPointsNp, s.opr.totalPoints, s.opr.total) : '';
      return {
        code: e && e.eventCode || '', name: ei.name || '', start: ei.start || '', city: ei.city || '',
        rank: ftcFirst_(s.rank, e && e.rank), w: ftcFirst_(s.wins), l: ftcFirst_(s.losses), t: ftcFirst_(s.ties),
        opr: opr === '' ? '' : Math.round(Number(opr) * 10) / 10
      };
    });
    recs.push(infoRec_(p.team, now, {
      team: p.team, found: true, error: '',
      name: tm.name || '', school: tm.schoolName || '',
      city: ftcFirst_(tm.city, loc.city), state: ftcFirst_(tm.state, loc.state), country: ftcFirst_(tm.country, loc.country),
      rookie: ftcFirst_(tm.rookieYear), website: tm.website || '',
      sponsors: Array.isArray(tm.sponsors) ? tm.sponsors.join(', ') : (tm.sponsors || ''),
      season: FTC_SEASON, fetchedAt: now,
      quick: JSON.stringify({ tot: ftcStat_(q.tot), auto: ftcStat_(q.auto), dc: ftcStat_(q.dc), eg: ftcStat_(q.eg), count: q.count != null ? q.count : null }),
      events: JSON.stringify(events)
    }));
    results[p.team] = { ok: true };
  });

  if (recs.length) {
    const lock = LockService.getScriptLock();
    lock.waitLock(25000);
    try {
      const fresh = authedUser_(body.userId,body.token);
      if (!fresh || !scope_(fresh,body.org)) return out_({ok:false,error:'Please sign in again'});
      recs.forEach(r => { r.org = String(body.org); r.id = 'info_' + r.org + '_' + r.data.team; });
      upsertMany_('info', recs, Date.now());
    } finally { lock.releaseLock(); }
  }
  return out_({ ok: true, results: results });
}

function infoRec_(team, now, data) {
  return { id: 'info_' + team, type: 'info', updatedAt: now, deleted: false, data: data };
}

/** Run this once from the editor: approves the "connect to an external service" permission and logs what FTCScout returns. */
function testFtcScout() {
  const urls = [FTC_API + '/teams/' + TEST_TEAM, FTC_API + '/teams/' + TEST_TEAM + '/quick-stats?season=' + FTC_SEASON, FTC_API + '/teams/' + TEST_TEAM + '/events/' + FTC_SEASON];
  urls.forEach(function (u) {
    const r = UrlFetchApp.fetch(u, { muteHttpExceptions: true });
    Logger.log(r.getResponseCode() + '  ' + u + '\n' + r.getContentText().slice(0, 600));
  });
}