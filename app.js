// ========= CONFIG =========
const API_BASE = "https://the-generalist-data-analyst-agent.onrender.com";
const API_PATH = "/api/"; // adjust if your path differs
// If your backend uses different field names, change here:
const FORM_KEYS = { brief: "brief", file: "files", urls: "urls" };
// ==========================

const els = {
  brief: document.getElementById("brief"),
  urls: document.getElementById("urls"),
  dropzone: document.getElementById("dropzone"),
  fileInput: document.getElementById("fileInput"),
  browseBtn: document.getElementById("browseBtn"),
  fileList: document.getElementById("fileList"),
  runBtn: document.getElementById("runBtn"),
  status: document.getElementById("status"),
  results: document.getElementById("results"),
  provenance: document.getElementById("provenance"),
};

let files = [];

function setStatus(msg, spinning = false) {
  els.status.innerHTML = spinning ? `<span class="spinner"></span> ${msg}` : msg;
}

// Drag & drop handlers
els.browseBtn.addEventListener("click", () => els.fileInput.click());
els.fileInput.addEventListener("change", () => {
  for (const f of els.fileInput.files) files.push(f);
  refreshFileList();
});

["dragenter", "dragover"].forEach(evt =>
  els.dropzone.addEventListener(evt, e => {
    e.preventDefault();
    e.stopPropagation();
    els.dropzone.style.background = "#FFFDF9";
  })
);
["dragleave", "drop"].forEach(evt =>
  els.dropzone.addEventListener(evt, e => {
    e.preventDefault();
    e.stopPropagation();
    els.dropzone.style.background = "#fff";
  })
);
els.dropzone.addEventListener("drop", e => {
  const dropped = Array.from(e.dataTransfer.files || []);
  files.push(...dropped);
  refreshFileList();
});

// Render file list
function refreshFileList() {
  els.fileList.innerHTML = "";
  files.forEach((f, idx) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${f.name} <small>(${prettyBytes(f.size)})</small></span>
                    <button data-i="${idx}" aria-label="remove">✕</button>`;
    li.querySelector("button").addEventListener("click", (e) => {
      files.splice(Number(e.currentTarget.dataset.i), 1);
      refreshFileList();
    });
    els.fileList.appendChild(li);
  });
}

function prettyBytes(n){
  if(n<1024) return `${n} B`;
  const u=["KB","MB","GB","TB"];
  let i=-1; do{n/=1024; i++;}while(n>=1024 && i<u.length-1);
  return `${n.toFixed(1)} ${u[i]}`;
}

// Submit handler
els.runBtn.addEventListener("click", async () => {
  const brief = els.brief.value.trim();
  const urlsRaw = els.urls.value.trim();
  const urls = urlsRaw ? urlsRaw.split(/\r?\n/).map(s => s.trim()).filter(Boolean) : [];

  if (!brief && files.length === 0 && urls.length === 0) {
    setStatus("Please add a brief, a file, or a URL.");
    return;
  }

  els.runBtn.disabled = true;
  setStatus("Submitting…", true);
  els.results.innerHTML = "";
  els.provenance.innerHTML = "";

  try {
    const fd = new FormData();
    if (brief) fd.append(FORM_KEYS.brief, brief);
    if (urls.length) fd.append(FORM_KEYS.urls, JSON.stringify(urls));
    for (const f of files) fd.append(FORM_KEYS.file, f, f.name);

    const res = await fetch(`${API_BASE}${API_PATH}?debug=0`, {
      method: "POST",
      body: fd,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText}`);
    }
    const data = await res.json();
    setStatus("Done.");

    renderResponse(data);
  } catch (err) {
    console.error(err);
    setStatus("Error. See console.");
    pushCard(els.results, "Error", `<pre>${escapeHTML(String(err.message || err))}</pre>`);
  } finally {
    els.runBtn.disabled = false;
  }
});

// Render response (robust to different shapes)
function renderResponse(payload) {
  // Provenance first if present
  const prov = payload.provenance || payload.materials || payload.sources || null;
  if (prov) {
    pushCard(els.provenance, "Materials", `<pre>${escapeHTML(JSON.stringify(prov, null, 2))}</pre>`);
  }

  // Known common fields
  if (payload.answer || payload.summary || payload.explanation) {
    const txt = payload.answer || payload.summary || payload.explanation;
    pushCard(els.results, "Findings", `<div>${linkify(escapeHTML(String(txt)))}</div>`);
  }

  // Answers list
  if (Array.isArray(payload.answers)) {
    const html = payload.answers.map(a => `<li>${escapeHTML(String(a))}</li>`).join("");
    pushCard(els.results, "Findings", `<ul>${html}</ul>`);
  }

  // Tables (array of arrays or array of objects)
  const tables = payload.tables || payload.table || null;
  if (tables) {
    const arr = Array.isArray(tables) ? tables : [tables];
    arr.forEach((t, i) => pushTable(t, `Table ${i+1}`));
  }

  // Images / plots (base64 or URLs)
  const imgs = payload.images || payload.plots || payload.figures || null;
  if (imgs) {
    const list = Array.isArray(imgs) ? imgs : [imgs];
    const html = list.map(src => {
      if (typeof src === "string") return `<img alt="figure" src="${src.startsWith("data:") || src.startsWith("http") ? src : `data:image/png;base64,${src}`}" />`;
      if (src && src.base64) return `<img alt="figure" src="data:image/png;base64,${src.base64}"/>`;
      return "";
    }).join("");
    if (html.trim()) pushCard(els.results, "Visuals", html);
  }

  // SQL / Codelets
  const code = payload.code || payload.sql || payload.codelets || null;
  if (code) {
    pushCard(els.results, "Code", `<pre>${escapeHTML(typeof code === "string" ? code : JSON.stringify(code, null, 2))}</pre>`);
  }

  // If nothing matched, show raw
  if (els.results.innerHTML.trim() === "") {
    pushCard(els.results, "Raw Response", `<pre>${escapeHTML(JSON.stringify(payload, null, 2))}</pre>`);
  }
}

function pushCard(container, title, innerHTML) {
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `<h3>${escapeHTML(title)}</h3>${innerHTML}`;
  container.appendChild(card);
}

function pushTable(data, title="Table") {
  // Accepts array of objects OR {columns:[...], data:[[...]]} OR array of arrays
  let headers = [];
  let rows = [];

  if (Array.isArray(data) && data.length && typeof data[0] === "object" && !Array.isArray(data[0])) {
    headers = Object.keys(data[0]);
    rows = data.map(r => headers.map(h => r[h]));
  } else if (data && data.columns && Array.isArray(data.data)) {
    headers = data.columns;
    rows = data.data;
  } else if (Array.isArray(data) && Array.isArray(data[0])) {
    headers = data[0].map((_, i) => `col_${i+1}`);
    rows = data;
  } else {
    // fallback
    pushCard(els.results, title, `<pre>${escapeHTML(JSON.stringify(data, null, 2))}</pre>`);
    return;
  }

  const thead = `<thead><tr>${headers.map(h=>`<th>${escapeHTML(String(h))}</th>`).join("")}</tr></thead>`;
  const tbody = `<tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${escapeHTML(String(c))}</td>`).join("")}</tr>`).join("")}</tbody>`;
  const html = `<div class="table-wrap"><table>${thead}${tbody}</table></div>`;
  pushCard(els.results, title, html);
}

function escapeHTML(s){
  return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function linkify(s){
  return s.replace(/(https?:\/\/[^\s)]+)|(\bwww\.[^\s)]+)/g, url => {
    const href = url.startsWith("http") ? url : `http://${url}`;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
}
