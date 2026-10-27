/**
 * 수학날개 숙제체크 서버 (구글 Apps Script)
 * 1) 이 파일 전체를 복사해서 Apps Script 의 Code.gs 에 붙여 넣으세요.
 * 2) 아래 OWNER_CODE 의 "0000" 을 원장님 코드 4자리로 바꾸세요.
 */

// 원장님 코드 — 따옴표 안의 0000 을 원장님 코드로 바꾸세요
var OWNER_CODE = "0000";

/* ===== 수학날개 서버 핵심 로직 (구글 Apps Script / 테스트 서버 공용) ===== */
var COLS = ["students", "records", "classes", "notices", "tests", "materials", "teachers"];
var STAFF_WRITABLE = { students: 1, records: 1, classes: 1, notices: 1, tests: 1, materials: 1 };
var MAX_FAILS = 40, LOCK_SECONDS = 600;

function kstNow_() { return new Date(Date.now() + 9 * 3600e3); }
function kstDay_(n) { return new Date(Date.now() + 9 * 3600e3 + (n || 0) * 864e5).toISOString().slice(0, 10); }
function normCode_(c) { return String(c == null ? "" : c).replace(/\D/g, ""); }
function newId_() { var s = "", a = "abcdefghijklmnopqrstuvwxyz0123456789"; for (var i = 0; i < 20; i++) s += a.charAt(Math.floor(Math.random() * a.length)); return s; }

/* who is this code? -> {role, id, name} or null */
function identify_(store, code) {
  code = normCode_(code);
  if (code.length !== 4) return null;
  var oc = normCode_(store.ownerCode());
  if (oc.length === 4 && code === oc) return { role: "owner", id: "owner", name: "원장님" };
  var t = store.getAll("teachers");
  for (var k in t) if (normCode_(t[k].code) === code) return { role: "teacher", id: k, name: t[k].name || "" };
  var s = store.getAll("students");
  for (var j in s) if (s[j].active !== false && normCode_(s[j].code) === code) return { role: "student", id: j, name: s[j].name || "" };
  return null;
}

function guard_(store, code) {
  if ((store.cacheGet("fails") || 0) >= MAX_FAILS) return { error: "locked", message: "코드를 너무 많이 틀렸어요. 10분 뒤에 다시 해 주세요." };
  var who = identify_(store, code);
  if (!who) {
    store.cachePut("fails", (store.cacheGet("fails") || 0) + 1, LOCK_SECONDS);
    store.sleep(700);
    return { error: "bad_code", message: "코드가 맞지 않아요." };
  }
  return { who: who };
}

function asList_(obj) { var out = []; for (var k in obj) { var d = obj[k]; var o = {}; for (var x in d) o[x] = d[x]; o.id = k; out.push(o); } return out; }

function handle(store, req) {
  var op = req.op;
  if (op === "top") { var pl = studentPayload_(store, "__none__"); return { ok: true, month: pl.month, week: pl.week, updated: pl.updated, top: pl.top, topWeek: pl.topWeek }; }
  var g = guard_(store, req.code);
  if (g.error) return g;
  var who = g.who;

  if (op === "login") return { ok: true, role: who.role, id: who.id, name: who.name };

  if (op === "student") {
    if (who.role !== "student") return { error: "not_student", message: "학생 코드가 아니에요." };
    return { ok: true, data: studentPayload_(store, who.id) };
  }
  if (op === "file") {
    var fid = String(req.id || "");
    if (who.role === "student" && !studentOwnsFile_(store, who.id, fid)) return { error: "forbidden", message: "볼 수 없는 파일이에요." };
    var f = store.getFile(fid);
    if (!f) return { error: "not_found", message: "파일을 찾을 수 없어요." };
    return { ok: true, type: f.type, b64: f.b64 };
  }

  if (who.role === "student") return { error: "forbidden", message: "선생님 코드로 들어와 주세요." };

  if (op === "load") {
    var from = kstDay_(-70);
    var out = { ok: true, me: { role: who.role, id: who.id, name: who.name } };
    out.students = asList_(store.getAll("students"));
    out.records = asList_(store.getAll("records")).filter(function (r) { return r.date && r.date >= from; });
    out.classes = asList_(store.getAll("classes"));
    out.notices = asList_(store.getAll("notices")).filter(function (n) { return n.date && n.date >= from; });
    out.tests = asList_(store.getAll("tests"));
    out.materials = asList_(store.getAll("materials"));
    out.teachers = asList_(store.getAll("teachers")).map(function (t) { var o = { id: t.id, name: t.name, order: t.order }; if (who.role === "owner") o.code = t.code; return o; });
    return out;
  }

  if (op === "set" || op === "update" || op === "delete" || op === "add") {
    var col = String(req.col || "");
    if (COLS.indexOf(col) < 0) return { error: "bad_col", message: "알 수 없는 저장 위치예요." };
    if (!STAFF_WRITABLE[col] && who.role !== "owner") return { error: "forbidden", message: "원장님만 바꿀 수 있어요." };
    return store.withLock(function () {
      var id = op === "add" ? newId_() : String(req.id || "");
      if (!/^[A-Za-z0-9_\-.:~@+]{1,200}$/.test(id)) return { error: "bad_id", message: "잘못된 항목이에요." };
      if (op === "delete") { store.del(col, id); return { ok: true, id: id }; }
      var data = req.data && typeof req.data === "object" ? req.data : {};
      if (op === "update") { var cur = store.getAll(col)[id] || {}; for (var k in data) cur[k] = data[k]; data = cur; }
      if (col === "teachers" || col === "students") { // 코드 중복 방지
        var c = normCode_(data.code);
        if (c) {
          if (c === normCode_(store.ownerCode())) return { error: "dup_code", message: "이미 쓰는 코드예요." };
          var pools = [store.getAll("teachers"), store.getAll("students")];
          for (var p = 0; p < 2; p++) for (var x in pools[p]) {
            if ((p === 0 ? col === "teachers" : col === "students") && x === id) continue;
            if (p === 1 && pools[p][x].active === false) continue;
            if (normCode_(pools[p][x].code) === c) return { error: "dup_code", message: "이미 쓰는 코드예요." };
          }
        }
      }
      data.updatedAt = Date.now();
      store.put(col, id, data);
      return { ok: true, id: id, data: data };
    });
  }

  if (op === "upload") {
    var type = req.type === "application/pdf" ? "application/pdf" : "image/jpeg";
    var b64 = String(req.b64 || "");
    if (!b64) return { error: "empty", message: "파일이 비어 있어요." };
    if (b64.length > 14 * 1024 * 1024) return { error: "too_big", message: "파일이 너무 커요 (10MB까지)." };
    var nid = store.saveFile(String(req.name || "file").slice(0, 120), type, b64);
    return { ok: true, id: nid };
  }

  if (op === "import") {
    if (who.role !== "owner") return { error: "forbidden", message: "원장님만 할 수 있어요." };
    var dataIn = req.data || {}, n = 0;
    return store.withLock(function () {
      for (var cc in dataIn) { if (COLS.indexOf(cc) < 0) continue;
        var rows = dataIn[cc]; for (var rid in rows) { store.put(cc, rid, rows[rid]); n++; } }
      store.flush && store.flush();
      return { ok: true, count: n };
    });
  }
  return { error: "bad_op", message: "알 수 없는 요청이에요." };
}

function studentOwnsFile_(store, sid, fid) {
  var t = store.getAll("tests"), m = store.getAll("materials");
  for (var a in t) if (t[a].sid === sid && (t[a].photos || []).indexOf(fid) >= 0) return true;
  for (var b in m) if (m[b].sid === sid) { var fs = m[b].files || []; for (var i = 0; i < fs.length; i++) if (fs[i] && fs[i].id === fid) return true; }
  return false;
}

function board_(students, records, inPeriod) {
  var pts = {}, done = {};
  records.forEach(function (r) { if (!r.date || !inPeriod(r.date)) return;
    var p = r.status === "done" ? 3 : (r.status === "sub" || r.status === "fix" || r.status === "fixed") ? 1 : 0;
    pts[r.sid] = (pts[r.sid] || 0) + p; if (r.status === "done") done[r.sid] = (done[r.sid] || 0) + 1; });
  var rows = students.map(function (s) { return { s: s, points: pts[s.id] || 0, done: done[s.id] || 0 }; })
    .sort(function (a, b) { return b.points - a.points || b.done - a.done || String(a.s.name).localeCompare(String(b.s.name), "ko"); });
  var rank = 0, prev = null; rows.forEach(function (r, i) { if (r.points !== prev) { rank = i + 1; prev = r.points; } r.rank = r.points > 0 ? rank : null; });
  var top = rows.filter(function (r) { return r.rank && r.rank <= 10; }).slice(0, 12).map(function (r) { return { rank: r.rank, name: r.s.name, grade: r.s.grade || "", points: r.points, done: r.done }; });
  var by = {}; rows.forEach(function (r) { by[r.s.id] = r; });
  return { top: top, by: by };
}

function studentPayload_(store, sid) {
  var today = kstDay_(0), month = today.slice(0, 7);
  var dow = kstNow_().getUTCDay(), week = kstDay_(-((dow + 6) % 7)), from = kstDay_(-35);
  var students = asList_(store.getAll("students")).filter(function (s) { return s.active !== false; });
  var records = asList_(store.getAll("records")).filter(function (r) { return r.date && r.date <= today && r.date >= kstDay_(-40); });
  var classes = store.getAll("classes");
  var M = board_(students, records, function (d) { return d.slice(0, 7) === month; });
  var W = board_(students, records, function (d) { return d >= week; });
  var s = store.getAll("students")[sid] || {}; s.id = sid;
  var m = M.by[sid] || { points: 0, done: 0, rank: null }, w = W.by[sid] || { points: 0, rank: null };
  var byDate = function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0); };
  var className = function (id) { return classes[id] ? classes[id].name || "" : ""; };
  var notices = asList_(store.getAll("notices")).filter(function (n) { return n.date && n.date >= kstDay_(-14) && n.date <= kstDay_(7) && n.text && (n.classId === "all" || (s.classId && n.classId === s.classId)); })
    .sort(byDate).slice(0, 10).map(function (n) { return { date: n.date, text: n.text, cls: n.classId === "all" ? "전체" : className(n.classId) }; });
  var tests = asList_(store.getAll("tests")).filter(function (t) { return t.sid === sid && t.date; }).sort(byDate).slice(0, 60)
    .map(function (t) { return { date: t.date, title: t.title || "", score: t.score == null ? "" : t.score, total: Number(t.total) || 0, memo: t.memo || "",
      photos: (t.photos || []).filter(function (x) { return typeof x === "string"; }).map(function (x) { return { id: x, t: "image/jpeg" }; }) }; });
  var mats = asList_(store.getAll("materials")).filter(function (x) { return x.sid === sid && x.date; }).sort(byDate).slice(0, 60)
    .map(function (x) { return { date: x.date, title: x.title || "", memo: x.memo || "",
      files: (x.files || []).filter(function (f) { return f && f.id; }).map(function (f) { return { id: f.id, t: f.type === "application/pdf" ? "application/pdf" : "image/jpeg", n: f.name || "" }; }) }; });
  var homework = records.filter(function (r) { return r.sid === sid && r.date >= from && r.status && r.status !== "skip"; })
    .sort(function (a, b) { return a.date < b.date ? 1 : -1; }).map(function (r) { return { date: r.date, status: r.status, memo: r.memo || "" }; });
  var t = kstNow_().toISOString();
  return { month: month, week: week, updated: t.slice(0, 10) + " " + t.slice(11, 16), top: M.top, topWeek: W.top,
    me: { name: s.name || "", grade: s.grade || "", className: className(s.classId), points: m.points, done: m.done, rank: m.rank,
      weekPoints: w.points, weekRank: w.rank, notices: notices, homework: homework, tests: tests, materials: mats } };
}

/* ===== 구글 시트·드라이브 연결 부분 ===== */
var VIEW_COLS = {
  students: [["name", "이름"], ["grade", "학년"], ["classId", "반ID"], ["code", "코드"], ["active", "사용"]],
  records: [["date", "날짜"], ["sid", "학생ID"], ["status", "상태"], ["memo", "피드백"]],
  classes: [["name", "반 이름"], ["teacherId", "담당"]],
  notices: [["date", "날짜"], ["classId", "반ID"], ["text", "공지"]],
  tests: [["date", "날짜"], ["sid", "학생ID"], ["title", "시험"], ["score", "점수"], ["total", "만점"], ["memo", "코멘트"]],
  materials: [["date", "날짜"], ["sid", "학생ID"], ["title", "자료"], ["memo", "설명"]],
  teachers: [["name", "이름"], ["code", "코드"]]
};
var SHEET_NAMES = { students: "학생", records: "숙제기록", classes: "반", notices: "숙제공지", tests: "테스트", materials: "자료", teachers: "선생님" };
var STATUS_KO = { none: "미제출", sub: "제출(피드백 대기)", fix: "오답 정리 중", fixed: "확인 대기", done: "완료", skip: "숙제 없음" };

function makeStore_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var memo = {}, rowsOf = {};
  function sheet(col) {
    var name = SHEET_NAMES[col];
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      var head = ["id", "수정시각", "data(지우지 마세요)"].concat(VIEW_COLS[col].map(function (c) { return c[1]; }));
      if (col === "records" || col === "tests" || col === "materials") head.push("학생 이름");
      sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight("bold");
      sh.setFrozenRows(1); sh.setColumnWidth(3, 60);
    }
    return sh;
  }
  function load(col) {
    if (memo[col]) return memo[col];
    var sh = sheet(col), n = sh.getLastRow(), out = {}, rows = {};
    if (n > 1) {
      var v = sh.getRange(2, 1, n - 1, 3).getValues();
      for (var i = 0; i < v.length; i++) { var id = String(v[i][0] || ""); if (!id) continue;
        try { out[id] = JSON.parse(v[i][2] || "{}"); rows[id] = i + 2; } catch (e) {} }
    }
    memo[col] = out; rowsOf[col] = rows; return out;
  }
  function rowValues(col, id, data) {
    var r = [id, new Date(), JSON.stringify(data)];
    VIEW_COLS[col].forEach(function (c) { var x = data[c[0]]; if (col === "records" && c[0] === "status") x = STATUS_KO[x] || x; r.push(x == null ? "" : (typeof x === "object" ? JSON.stringify(x) : x)); });
    if (col === "records" || col === "tests" || col === "materials") { var st = load("students")[data.sid]; r.push(st ? st.name : ""); }
    return r;
  }
  var store = {
    ownerCode: function () { return OWNER_CODE; },
    getAll: function (col) { return load(col); },
    put: function (col, id, data) {
      var all = load(col), sh = sheet(col), row = rowsOf[col][id], vals = rowValues(col, id, data);
      if (row) sh.getRange(row, 1, 1, vals.length).setValues([vals]);
      else { sh.appendRow(vals); rowsOf[col][id] = sh.getLastRow(); }
      all[id] = data;
    },
    del: function (col, id) {
      var all = load(col), row = rowsOf[col][id];
      if (row) { sheet(col).deleteRow(row); delete memo[col]; delete rowsOf[col]; } else delete all[id];
    },
    saveFile: function (name, type, b64) {
      var blob = Utilities.newBlob(Utilities.base64Decode(b64), type, name);
      return folder_().createFile(blob).getId();
    },
    getFile: function (id) {
      try { var f = DriveApp.getFileById(id); var ps = f.getParents(), fid = folder_().getId(), ok = false;
        while (ps.hasNext()) if (ps.next().getId() === fid) ok = true;
        if (!ok) return null;
        var b = f.getBlob(); return { type: b.getContentType(), b64: Utilities.base64Encode(b.getBytes()) };
      } catch (e) { return null; }
    },
    cacheGet: function (k) { var v = CacheService.getScriptCache().get(k); return v ? Number(v) : 0; },
    cachePut: function (k, v, sec) { CacheService.getScriptCache().put(k, String(v), sec); },
    sleep: function (ms) { Utilities.sleep(ms); },
    withLock: function (fn) { var l = LockService.getScriptLock(); l.waitLock(25000); try { return fn(); } finally { SpreadsheetApp.flush(); l.releaseLock(); } }
  };
  return store;
}

function folder_() {
  var p = PropertiesService.getScriptProperties(), id = p.getProperty("FOLDER_ID");
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var f = DriveApp.createFolder("수학날개 앱 파일 (지우지 마세요)");
  p.setProperty("FOLDER_ID", f.getId()); return f;
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function doPost(e) {
  try { var req = JSON.parse(e.postData.contents || "{}"); return json_(handle(makeStore_(), req)); }
  catch (err) { return json_({ error: "server", message: "서버 오류: " + err }); }
}
function doGet() { return json_({ ok: true, app: "수학날개", time: new Date().toISOString() }); }

/* 처음 한 번 실행: 시트와 폴더를 만들고 권한을 받습니다 */
function setup() {
  var s = makeStore_();
  COLS.forEach(function (c) { s.getAll(c); });
  folder_();
  Logger.log("준비 완료! 이제 배포 → 새 배포 를 눌러 주세요.");
}
