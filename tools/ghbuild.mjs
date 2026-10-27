// 나의 수학날개 — GitHub Pages build
// usage: node ghbuild.mjs missing <dumpDir> <repoDir>                 -> JSON array of photo asset ids that still need downloading
//        node ghbuild.mjs <dumpDir> <template.html> <repoDir> [photosDir] -> writes repoDir/index.html (+ repoDir/p/*.bin)
// photosDir holds downloaded teacher photos named <assetId>.<ext>
import fs from "node:fs"; import path from "node:path"; import { webcrypto as C, createHash } from "node:crypto";
const SALT = "ca65a3467bb87b8aa19eeec5b85dfe47", ITER = 600000;
const args = process.argv.slice(2);
const MISSING = args[0] === "missing";
const [dump, a2, a3, a4] = MISSING ? args.slice(1) : args;
const repo = MISSING ? a2 : a3, tpl = MISSING ? null : a2, photosDir = MISSING ? null : a4;
const load = c => { const d = path.join(dump, c); if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter(f => f.endsWith(".json")).map(f => ({ id: f.slice(0, -5), ...JSON.parse(fs.readFileSync(path.join(d, f), "utf8")) })); };
const norm = c => String(c || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
const enc = new TextEncoder(), salt = Buffer.from(SALT, "hex");
const nowK = Date.now() + 9 * 3600e3, kst = new Date(nowK).toISOString();
const day = n => new Date(nowK + n * 864e5).toISOString().slice(0, 10);
const TODAY = kst.slice(0, 10), MONTH = kst.slice(0, 7), UPDATED = kst.slice(0, 10) + " " + kst.slice(11, 16);
const WEEK = day(-((new Date(nowK).getUTCDay() + 6) % 7));
const from = day(-35);
const students = load("students").filter(s => s.active !== false);
const tests = load("tests");
const materials = load("materials");
const matIds = s => materials.filter(m => m.sid === s.id).flatMap(m => Array.isArray(m.files) ? m.files.filter(f => f && typeof f.id === "string").map(f => f.id) : []);
const photoName = (keyBytes, assetId) => "p/" + createHash("sha256").update(Buffer.from(keyBytes)).update(":" + assetId).digest("hex").slice(0, 24) + ".bin";
async function keysFor(code) {
  const base = await C.subtle.importKey("raw", enc.encode(norm(code)), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await C.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITER }, base, 352));
  return { id: Buffer.from(bits.slice(0, 12)).toString("hex"), raw: bits.slice(12, 44),
    key: await C.subtle.importKey("raw", bits.slice(12, 44), "AES-GCM", false, ["encrypt"]) };
}
// unique-code students only
const seen = new Set(), coded = [];
for (const s of students) { const c = norm(s.code); if (!c) continue; if (seen.has(c)) { console.error("duplicate code skipped: " + s.name); continue; } seen.add(c); coded.push(s); }
const photoIds = s => tests.filter(t => t.sid === s.id).flatMap(t => Array.isArray(t.photos) ? t.photos.filter(x => typeof x === "string") : []);

if (MISSING) {
  const need = new Set();
  for (const s of coded) { const ids = photoIds(s); if (!ids.length && !matIds(s).length) continue; const k = await keysFor(s.code);
    for (const a of ids.concat(matIds(s))) if (!fs.existsSync(path.join(repo, photoName(k.raw, a)))) need.add(a); }
  console.log(JSON.stringify([...need])); process.exit(0);
}

const classes = Object.fromEntries(load("classes").map(c => [c.id, c.name || ""]));
const notices = load("notices").filter(n => n.date && n.date >= day(-14) && n.date <= day(7) && n.text);
const records = load("records").filter(r => r.date && r.date <= TODAY);
function board(inPeriod) {
  const pts = {}, done = {};
  for (const r of records) { if (!inPeriod(r.date)) continue;
    const p = r.status === "done" ? 3 : ["sub", "fix", "fixed"].includes(r.status) ? 1 : 0;
    pts[r.sid] = (pts[r.sid] || 0) + p; if (r.status === "done") done[r.sid] = (done[r.sid] || 0) + 1; }
  const rows = students.map(s => ({ s, points: pts[s.id] || 0, done: done[s.id] || 0 }))
    .sort((a, b) => b.points - a.points || b.done - a.done || a.s.name.localeCompare(b.s.name, "ko"));
  let rank = 0, prev = null; rows.forEach((r, i) => { if (r.points !== prev) { rank = i + 1; prev = r.points; } r.rank = r.points > 0 ? rank : null; });
  const top = rows.filter(r => r.rank && r.rank <= 10).slice(0, 12).map(r => ({ rank: r.rank, name: r.s.name, grade: r.s.grade || "", points: r.points, done: r.done }));
  return { top, by: Object.fromEntries(rows.map(r => [r.s.id, r])) };
}
const M = board(d => d.slice(0, 7) === MONTH), W = board(d => d >= WEEK);
fs.mkdirSync(path.join(repo, "p"), { recursive: true });
const findPhoto = a => { if (!photosDir || !fs.existsSync(photosDir)) return null; const f = fs.readdirSync(photosDir).find(x => x.startsWith(a)); return f ? path.join(photosDir, f) : null; };
const blobs = {}, keep = new Set(); let missingPhotos = 0;
for (const s of coded) {
  const k = await keysFor(s.code), m = M.by[s.id], w = W.by[s.id];
  const encPhoto = async (a, type) => {
    const name = photoName(k.raw, a), dest = path.join(repo, name);
    const iv = createHash("sha256").update(Buffer.from(k.raw)).update(":iv:" + a).digest().subarray(0, 12);
    if (!fs.existsSync(dest)) { const src = findPhoto(a); if (!src) { missingPhotos++; return null; }
      const ct = new Uint8Array(await C.subtle.encrypt({ name: "AES-GCM", iv }, k.key, fs.readFileSync(src))); fs.writeFileSync(dest, ct); }
    keep.add(name); const o = { f: name, iv: Buffer.from(iv).toString("base64") }; if (type && type !== "image/jpeg") o.t = type; return o;
  };
  const myTests = tests.filter(t => t.sid === s.id && t.date).sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 60);
  const testsOut = [];
  for (const t of myTests) { const ph = []; for (const a of (Array.isArray(t.photos) ? t.photos : [])) { if (typeof a !== "string") continue; const r = await encPhoto(a); if (r) ph.push(r); }
    testsOut.push({ date: t.date, title: t.title || "", score: t.score ?? "", total: Number(t.total) || 0, memo: t.memo || "", photos: ph }); }
  const matsOut = [];
  for (const m of materials.filter(m => m.sid === s.id && m.date).sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 60)) {
    const files = [];
    for (const f of (Array.isArray(m.files) ? m.files : [])) { if (!f || typeof f.id !== "string") continue;
      const type = f.type === "application/pdf" ? "application/pdf" : "image/jpeg";
      const r = await encPhoto(f.id, type); if (r) { r.t = type; r.n = String(f.name || "").slice(0, 120); files.push(r); } }
    matsOut.push({ date: m.date, title: m.title || "", memo: m.memo || "", files });
  }
  const payload = { name: s.name, grade: s.grade || "", className: classes[s.classId] || "",
    points: m.points, done: m.done, rank: m.rank, weekPoints: w.points, weekRank: w.rank,
    notices: notices.filter(n => n.classId === "all" || (s.classId && n.classId === s.classId))
      .sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 10)
      .map(n => ({ date: n.date, text: n.text, cls: n.classId === "all" ? "전체" : (classes[n.classId] || "") })),
    homework: records.filter(x => x.sid === s.id && x.date >= from && x.status && x.status !== "skip").sort((a, b) => a.date < b.date ? 1 : -1)
      .map(x => ({ date: x.date, status: x.status, memo: x.memo || "" })),
    tests: testsOut, materials: matsOut };
  const iv = C.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await C.subtle.encrypt({ name: "AES-GCM", iv }, k.key, enc.encode(JSON.stringify(payload))));
  blobs[k.id] = { iv: Buffer.from(iv).toString("base64"), ct: Buffer.from(ct).toString("base64") };
}
// remove photo files no longer referenced (deleted tests, changed codes)
for (const f of fs.readdirSync(path.join(repo, "p"))) if (!keep.has("p/" + f)) fs.unlinkSync(path.join(repo, "p", f));
const data = JSON.stringify({ month: MONTH, week: WEEK, updated: UPDATED, salt: SALT, iter: ITER, top: M.top, topWeek: W.top, students: blobs }).replace(/</g, "\\u003c");
const body = fs.readFileSync(tpl, "utf8");
const re = /(<script id="app-data" type="application\/json">)[\s\S]*?(<\/script>)/;
if (!re.test(body)) { console.error("data block not found"); process.exit(1); }
const head = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#2457d6"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="수학날개"><link rel="apple-touch-icon" href="icon.png"><link rel="icon" href="icon.png"><link rel="manifest" href="manifest.json">
<meta name="robots" content="noindex,nofollow">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>`;
fs.writeFileSync(path.join(repo, "index.html"), head + body.replace(re, (_, a, b) => a + data + b) + "</body></html>");
console.log(`${MONTH} updated ${UPDATED}: ${Object.keys(blobs).length} students, photos ${keep.size}${missingPhotos ? ` (missing ${missingPhotos})` : ""}, week top: ` + W.top.slice(0, 3).map(t => `${t.rank}위 ${t.name}(${t.points}점)`).join(", ") + ` | month top: ` + M.top.slice(0, 3).map(t => `${t.rank}위 ${t.name}(${t.points}점)`).join(", "));
