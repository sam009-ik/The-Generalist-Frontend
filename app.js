// ========= CONFIG (matches your backend) =========
const API_BASE = "https://the-generalist-data-analyst-agent.onrender.com";
const API_PATH = "/api/"; // IMPORTANT: trailing slash required
// Your backend requires a file named exactly "questions.txt"
const QUESTION_FILE_FIELD = "questions.txt";
const OTHER_FILES_FIELD = "files"; // can be any name that's not "questions.txt"
// =================================================

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

els.runBtn.addEventListener("click", async () => {
  const brief = (els.brief.value || "").trim();
  const urlsRaw = (els.urls.value || "").trim();

  if (!brief && files.length === 0 && !urlsRaw) {
    setStatus("Please enter a brief, or add files/URLs.");
    return;
  }

  // Build questions.txt content (your backend extracts URLs from this text)
  const urlLines = urlsRaw
    ? urlsRaw.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
    : [];
  const questionsText = [
    brief || "",
    ...(urlLines.length ? ["", ...urlLines] : [])
  ].join("\n");

  // Create a text file Blob for questions.txt
  const questionsBlob = new Blob([questionsText], { type: "text/plain" });
  const questionsFile = new File([questionsBlob], "questions.txt", { type: "text/plain" });

  els.runBtn.disabled = true;
  setStatus("Submitting…", true);
  els.results.innerHTML = "";
  els.provenance.innerHTML = "";

  try {
    const fd = new FormData();
    // REQUIRED by your backend:
    fd.append(QUESTION_FILE_FIELD, questionsFile, "questions.txt");

    // Optional: any other files (key name can be anything ≠ "questions.txt")
    for (const f of files) fd.append(OTHER_FILES_FIELD, f, f.name);

    const res = await fetch(`${API_BASE}${API_PATH}`, {
      method: "POST",
      body: fd,
    });

    // Handle non-2xx
    if (!res.ok) {
      const errText = await res.text().catch(()=> "");
      throw new Error(`HTTP ${res.status}${errText ? `: ${errText}` : ""}`);
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

function renderResponse(payload) {
  // If the backend returned an execution error, surface it clearly
  if (payload && (payload.error || payload.details || payload.stderr)) {
    let msg = "";
    if (payload.error)   msg += `Error: ${payload.error}\n\n`;
    if (payload.details) msg += `Traceback:\n${payload.details}\n\n`;
    if (payload.stdout)  msg += `STDOUT:\n${payload.stdout}\n\n`;
    if (payload.stderr)  msg += `STDERR:\n${payload.stderr}\n\n`;
    pushCard(els.results, "Execution Error", `<pre>${escapeHTML(msg.trim())}</pre>`);
    return;
  }

  // General text fields
  if (payload.answer || payload.summary || payload.explanation) {
    const txt = payload.answer || payload.summary || payload.explanation;
    pushCard(els.results, "Findings", `<div>${linkify(escapeHTML(String(txt)))}</div>`);
  }

  // Answers array
  if (Array.isArray(payload.answers)) {
    const html = payload.answers.map(a => `<li>${escapeHTML(String(a))}</li>`).join("");
    pushCard(els.results, "Findings", `<ul>${html}</ul>`);
  }

  // Tables
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
      if (typeof src === "string") {
        return `<img alt="figure" src="${src.startsWith("data:") || src.startsWith("http") ? src : `data:image/png;base64,${src}`}" />`;
      }
      if (src && src.base64) return `<img alt="figure" src="data:image/png;base64,${src.base64}"/>`;
      return "";
    }).join("");
    if (html.trim()) pushCard(els.results, "Visuals", html);
  }

  // Code or SQL echoes
  const code = payload.code || payload.sql || payload.codelets || null;
  if (code) {
    pushCard(els.results, "Code", `<pre>${escapeHTML(typeof code === "string" ? code : JSON.stringify(code, null, 2))}</pre>`);
  }

  // Provenance-ish fields if your model returns them
  const prov = payload.provenance || payload.materials || payload.sources || null;
  if (prov) {
    pushCard(els.provenance, "Materials", `<pre>${escapeHTML(JSON.stringify(prov, null, 2))}</pre>`);
  }

  // If nothing matched, show the raw response
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
