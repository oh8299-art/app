/* 수학날개 숙제체크 — 구글 서버 연결 (예전 Claude 저장소와 같은 사용법) */
(function () {
  const API = {
    code: "",
    async call(body) {
      if (!window.SN_API) return { error: "no_api", message: "서버 주소가 아직 설정되지 않았어요." };
      body = Object.assign({ code: this.code }, body);
      try {
        const r = await fetch(window.SN_API, { method: "POST", body: JSON.stringify(body) });
        return await r.json();
      } catch (e) { return { error: "network", message: "인터넷 연결을 확인해 주세요." }; }
    }
  };
  const COLS = ["students", "records", "classes", "notices", "tests", "materials", "teachers"];

  function makeDb(onStatus) {
    const cache = {}; COLS.forEach(c => cache[c] = {});
    const ensure = c => { if (!cache[c]) cache[c] = {}; return cache[c]; };
    const listeners = []; // {col, filter, cb}
    const snapOf = (col, filter) => {
      if (!cache[col]) cache[col] = {};
      const docs = Object.keys(cache[col]).filter(id => !filter || filter(cache[col][id]))
        .map(id => ({ id, data: () => Object.assign({}, cache[col][id]), exists: true }));
      return { docs, size: docs.length, empty: !docs.length, docChanges: () => [] };
    };
    const notify = col => listeners.filter(l => l.col === col).forEach(l => { try { l.cb(snapOf(col, l.filter)); } catch (e) { console.error(e); } });
    const fail = r => { const e = new Error(r.message || "저장하지 못했어요"); e.code = r.error === "forbidden" || r.error === "bad_code" ? "invalid_argument" : (r.error || "unavailable"); e.serverMessage = r.message; return e; };
    let pending = 0, last = 0;
    async function refresh() {
      if (pending) return;
      const r = await API.call({ op: "load" });
      last = Date.now();
      if (!r.ok) { onStatus && onStatus(r); return r; }
      const all = Object.assign({}, r.data || {}); COLS.forEach(c => { if (!all[c]) all[c] = r[c] || []; });
      Object.keys(cache).forEach(c => { if (!all[c]) all[c] = []; });
      Object.keys(all).forEach(c => { cache[c] = {}; (all[c] || []).forEach(d => { const id = d.id; const o = Object.assign({}, d); delete o.id; cache[c][id] = o; }); notify(c); });
      onStatus && onStatus(r); return r;
    }
    async function write(body, col) {
      let r; pending++;
      try { r = await API.call(body); } finally { pending--; }
      if (!r.ok) { await refresh(); throw fail(r); }
      if (r.data) { ensure(col)[r.id] = r.data; notify(col); }
      return r;
    }
    function docRef(col, id) {
      return {
        id,
        async get() { const d = ensure(col)[id]; return { exists: !!d, id, data: () => d ? Object.assign({}, d) : undefined }; },
        async set(data) { ensure(col)[id] = Object.assign({}, data); notify(col); await write({ op: "set", col, id, data }, col); },
        async update(data) { ensure(col)[id] = Object.assign({}, ensure(col)[id] || {}, data); notify(col); await write({ op: "update", col, id, data }, col); },
        async delete() { delete ensure(col)[id]; notify(col); await write({ op: "delete", col, id }, col); },
        onSnapshot(cb) { const l = { col, filter: null, cb: s => { const d = ensure(col)[id]; cb({ exists: !!d, id, data: () => d }); } }; listeners.push(l); l.cb(); return () => listeners.splice(listeners.indexOf(l), 1); }
      };
    }
    function colRef(col, filter) {
      return {
        doc: id => docRef(col, id),
        where(field, op, val) { const prev = filter; const f = d => { const x = d[field]; const ok = op === ">=" ? x >= val : op === "<=" ? x <= val : op === "==" ? x === val : true; return ok && (!prev || prev(d)); }; return colRef(col, f); },
        async add(data) { const r = await write({ op: "add", col, data }, col); return docRef(col, r.id); },
        onSnapshot(cb) { const l = { col, filter, cb }; listeners.push(l); cb(snapOf(col, filter)); return () => listeners.splice(listeners.indexOf(l), 1); },
        async get() { return snapOf(col, filter); }
      };
    }
    // 다른 선생님이 바꾼 내용을 주기적으로 가져오기
    setInterval(() => { if (document.visibilityState === "visible" && Date.now() - last > 40000 && !document.querySelector("input:focus,textarea:focus,select:focus")) refresh(); }, 10000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && Date.now() - last > 15000) refresh(); });
    return { collection: c => colRef(c, null), doc: p => { const [c, id] = p.split("/"); return docRef(c, id); }, refresh };
  }

  const toB64 = blob => new Promise((ok, bad) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(",")[1] || ""); fr.onerror = bad; fr.readAsDataURL(blob); });
  const makeAssets = () => ({
    async upload(blob, opts) {
      const type = (opts && opts.type) || blob.type || "image/jpeg";
      if (blob.size > 10 * 1024 * 1024) throw new Error("파일이 10MB보다 커요");
      const r = await API.call({ op: "upload", type, name: blob.name || "file", b64: await toB64(blob) });
      if (!r.ok) throw new Error(r.message || "업로드 실패");
      return { id: r.id, url: "", contentType: type };
    }
  });

  const urlCache = {};
  async function fileUrl(id) {
    if (urlCache[id]) return urlCache[id];
    const r = await API.call({ op: "file", id });
    if (!r.ok) throw new Error(r.message || "파일을 열 수 없어요");
    const bin = atob(r.b64), arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return (urlCache[id] = URL.createObjectURL(new Blob([arr], { type: r.type || "application/octet-stream" })));
  }
  // 화면에 <img data-fid> 가 생기면 그림을 채워 넣기
  function hydrate(root) {
    (root || document).querySelectorAll("img[data-fid]:not([data-done])").forEach(img => {
      img.setAttribute("data-done", "1");
      fileUrl(img.dataset.fid).then(u => img.src = u).catch(() => img.alt = "사진을 불러오지 못했어요");
    });
  }
  new MutationObserver(() => hydrate()).observe(document.documentElement, { childList: true, subtree: true });
  // <a data-fopen> 누르면 파일 열기
  document.addEventListener("click", e => {
    const a = e.target.closest("[data-fopen]"); if (!a) return; e.preventDefault();
    const w = window.open("", "_blank");
    fileUrl(a.dataset.fopen).then(u => { if (w) w.location = u; else location.href = u; }).catch(err => { if (w) w.close(); alertMsg(err.message); });
  });
  function alertMsg(m) { const t = document.getElementById("toast"); if (t) { t.textContent = m; t.hidden = false; setTimeout(() => t.hidden = true, 2500); } }

  window.SN = { API, makeDb, makeAssets, fileUrl };
})();
