import { t, tStatus, tCountry, tCat, setLang, getLang, detectLang } from "./i18n.js";
import { analyze, score, skillLabels, DEFAULT_TITLES } from "./match.js";
import * as db from "./store.js";
import { readCvFile } from "./cvread.js";
import { parseAd } from "./parsead.js";
import { backupJson, parseBackup, exportCsv, parseCsv, followUpIcs, searchLinks, download } from "./io.js";
import { emptyProfile, hasProfile, profileFromText, normalizeProfile } from "./profile.js";
import { templateFor, buildCv, cvHtml, cvDocx, buildLetter, letterDocx, letterHtml } from "./docs.js";
import { aiProfile, aiSummary, aiLetter, callClaude, DEFAULT_MODEL } from "./ai.js";

const COUNTRIES = ["Saudi Arabia", "Oman", "Qatar", "UAE", "Kuwait", "Bahrain", "Germany", "Austria", "Canada", "Other"];
const CATS = ["Production and operations", "Maintenance", "Installation and commissioning", "Field and service engineering", "Quality and Lean", "Project engineering", "Automotive", "Renewable energy", "Paper and packaging", "Plastics and recycling", "Oil, gas and energy", "Other"];
const STATUSES = ["Saved", "Applied", "Follow-up", "Interview", "Offer", "Rejected"];
const VIEWS = ["jobs", "find", "cv", "more"];
const FOLLOW_DAYS = 7;

const S = {
  jobs: [], cv: { text: "", fileName: "" }, an: null, profile: emptyProfile(),
  settings: { lang: "", apiKey: "", model: "", sites: [], findCountries: ["Saudi Arabia", "Oman", "Qatar"], findTitle: "", findCity: "" },
  f: { q: "", locs: new Set(), cat: "", min: 0, sort: "match", status: "" },
  view: "jobs", editing: null, installEvt: null,
};

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const uid = () => "j" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const isoDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return isoDay(d); };
const fmtDate = (iso) => { try { return new Date(iso + (iso.length === 10 ? "T12:00:00" : "")).toLocaleDateString(getLang(), { day: "numeric", month: "short", year: "numeric" }); } catch { return iso; } };
const opts = (list, sel, label = (x) => x, first) => (first != null ? `<option value="">${esc(first)}</option>` : "") + list.map((x) => `<option value="${esc(x)}"${x === sel ? " selected" : ""}>${esc(label(x))}</option>`).join("");
const chip = (txt, cls = "") => `<span class="chip ${cls}">${esc(txt)}</span>`;
const isDue = (j) => j.followUp && j.followUp <= isoDay() && !["Rejected", "Offer"].includes(j.status);
const scoreOf = (j) => score(S.an, j.title, j.desc, `${j.category || ""} ${j.notes || ""}`);
const flagText = (f) => t("asksYears", f.years, f.cv);
const aiCfg = () => ({ key: S.settings.apiKey, model: S.settings.model || DEFAULT_MODEL });
const hasAI = () => !!S.settings.apiKey;
const lines = (v) => String(v || "").split(/\n/).map((x) => x.trim()).filter(Boolean);
const slug = (s) => String(s || "").replace(/[^\p{L}\d]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40);

let toastTimer;
function toast(msg, action) {
  const el = $("toast");
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="btn ghost inv" type="button">${esc(action.label)}</button>` : ""}`;
  if (action) el.querySelector("button").onclick = action.fn;
  el.hidden = false; clearTimeout(toastTimer);
  if (!action) toastTimer = setTimeout(() => (el.hidden = true), 3200);
}
const saveSettings = () => db.setKV("settings", S.settings);

// ---------- data ----------
async function saveJob(j) {
  j.updated = Date.now();
  const i = S.jobs.findIndex((x) => x.id === j.id);
  if (i < 0) S.jobs.push(j); else S.jobs[i] = j;
  await db.putJob(j); render();
}
async function removeJobs(ids) {
  S.jobs = S.jobs.filter((x) => !ids.includes(x.id));
  await db.deleteJobs(ids); render();
}
function withStatus(j, status) {
  if (j.status === status) return j;
  const n = { ...j, status, history: [...(j.history || []), { status, at: isoDay() }] };
  if (status === "Applied" && !n.followUp) n.followUp = addDays(FOLLOW_DAYS);
  return n;
}
function normalizeJob(x) {
  return {
    id: x.id || uid(), title: (x.title || "").trim(), company: x.company || "", country: COUNTRIES.includes(x.country) ? x.country : (x.country ? "Other" : ""),
    city: x.city || "", category: CATS.includes(x.category) ? x.category : (x.category ? "Other" : ""), status: STATUSES.includes(x.status) ? x.status : "Saved",
    salary: x.salary || "", link: x.link || "", desc: x.desc || "", notes: x.notes || "", followUp: /^\d{4}-\d{2}-\d{2}$/.test(x.followUp || "") ? x.followUp : "",
    history: Array.isArray(x.history) ? x.history : [{ status: STATUSES.includes(x.status) ? x.status : "Saved", at: isoDay() }],
    added: x.added || Date.now(), updated: x.updated || Date.now(), example: !!x.example, docs: Array.isArray(x.docs) ? x.docs : [],
  };
}
async function setCv(text, fileName) {
  S.cv = { text, fileName: fileName || "" }; S.an = analyze(text);
  await db.setKV("cv", { ...S.cv, updatedAt: new Date().toISOString() }); render();
}

// ---------- jobs view ----------
function filtered() {
  const f = S.f, q = f.q.toLowerCase();
  let rows = S.jobs.map((j) => ({ j, r: scoreOf(j) })).filter(({ j, r }) => {
    if (f.locs.size && !f.locs.has(j.country || "")) return false;
    if (f.cat && j.category !== f.cat) return false;
    if (f.status === "_due" ? !isDue(j) : f.status && j.status !== f.status) return false;
    if (f.min && (!r || r.score < f.min)) return false;
    if (q && !`${j.title} ${j.company} ${j.city} ${j.notes} ${j.desc}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const by = {
    company: (a, b) => a.j.company.localeCompare(b.j.company),
    new: (a, b) => b.j.added - a.j.added,
    follow: (a, b) => (a.j.followUp || "9").localeCompare(b.j.followUp || "9"),
    match: (a, b) => (b.r ? b.r.score : -1) - (a.r ? a.r.score : -1) || b.j.added - a.j.added,
  };
  return rows.sort(by[f.sort === "match" && !S.an ? "new" : f.sort]);
}

function renderStats() {
  const c = {}; S.jobs.forEach((j) => (c[j.status] = (c[j.status] || 0) + 1));
  const due = S.jobs.filter(isDue).length;
  const b = (key, n, label, cls = "") => `<button class="stat ${cls}" data-st="${key}" aria-pressed="${S.f.status === key}"><b>${n}</b><span>${esc(label)}</span></button>`;
  $("stats").innerHTML = b("", S.jobs.length, t("all")) + STATUSES.map((s) => b(s, c[s] || 0, tStatus(s))).join("") + (due ? b("_due", due, t("due"), "due") : "");
}

function jobCard({ j, r }) {
  const cls = !r ? "" : r.score >= 70 ? "hi" : r.score >= 45 ? "mid" : "lo";
  const m = r
    ? `<div class="score ${cls}"><b>${r.score}<small>%</small></b><div class="meter"><i style="width:${r.score}%"></i></div><span>${esc(r.low ? t("limited") : t("match"))}</span></div>`
    : `<div class="score"><b>–</b><span>${esc(t("addCvShort"))}</span></div>`;
  const chips = r ? r.matched.slice(0, 4).map((k) => chip(k, "good")).join("") + r.missing.slice(0, 3).map((k) => chip(`${t("missing")}: ${k}`, "warn")).join("") + r.flags.map((f) => chip(flagText(f), "warn")).join("") : "";
  const where = [j.city, j.country && tCountry(j.country)].filter(Boolean).join(", ");
  const meta = [j.company || t("noCompany"), where, j.category && tCat(j.category), j.salary].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join("");
  let fu = "";
  if (j.followUp && !["Rejected", "Offer"].includes(j.status)) {
    const d = j.followUp, today = isoDay();
    fu = `<div class="follow ${d < today ? "late" : d === today ? "now" : ""}">${esc(t("followUp"))}: ${esc(fmtDate(d))}${d < today ? ` (${esc(t("overdue"))})` : d === today ? ` (${esc(t("today"))})` : ""}</div>`;
  }
  return `<article class="job" data-id="${esc(j.id)}">${m}
    <div class="body"><h3>${esc(j.title)}${j.example ? " " + chip(t("example"), "plain") : ""}</h3><div class="meta">${meta}</div>
      ${chips ? `<div class="chips">${chips}</div>` : ""}${fu}${j.notes ? `<p class="note">${esc(j.notes)}</p>` : ""}</div>
    <div class="side"><select data-act="status" aria-label="${esc(t("fStatus"))}">${opts(STATUSES, j.status, tStatus)}</select>
      <div class="acts">${j.link ? `<a class="btn ghost" href="${esc(j.link)}" target="_blank" rel="noopener noreferrer">${esc(t("openAd"))}</a>` : ""}
      ${j.followUp ? `<button class="btn ghost" data-act="ics">${esc(t("calendar"))}</button>` : ""}
      <button class="btn ghost" data-act="docs">${esc(t("docsBtn"))}</button><button class="btn ghost" data-act="edit">${esc(t("edit"))}</button><button class="btn ghost danger" data-act="del">${esc(t("del"))}</button></div></div></article>`;
}

function renderJobsView() {
  const el = $("v-jobs"), f = S.f;
  const locs = [...new Set(S.jobs.map((j) => j.country || ""))].filter(Boolean).sort((a, b) => COUNTRIES.indexOf(a) - COUNTRIES.indexOf(b));
  if (!el.dataset.built) {
    el.innerHTML = `<div class="filters">
      <div class="field grow"><label for="fq">${esc(t("search"))}</label><input id="fq" type="search" placeholder="${esc(t("searchPh"))}"></div>
      <div class="field"><label for="fcat">${esc(t("category"))}</label><select id="fcat"></select></div>
      <div class="field"><label for="fmin">${esc(t("minMatch"))}</label><select id="fmin">${[0, 40, 60, 80].map((n) => `<option value="${n}">${n ? n + "%" : esc(t("any"))}</option>`).join("")}</select></div>
      <div class="field"><label for="fsort">${esc(t("sort"))}</label><select id="fsort">${[["match", "sortMatch"], ["new", "sortNew"], ["follow", "sortFollow"], ["company", "sortCompany"]].map(([v, k]) => `<option value="${v}">${esc(t(k))}</option>`).join("")}</select></div>
    </div>
    <div class="locrow" id="flocs" role="group" aria-label="${esc(t("locations"))}"></div>
    <div class="row"><button class="btn primary" id="addBtn">${esc(t("addJob"))}</button><span class="hint" id="count"></span></div>
    <div id="jobList" class="list"></div>`;
    el.dataset.built = "1";
    $("fq").oninput = (e) => { f.q = e.target.value; renderList(); };
    $("fcat").onchange = (e) => { f.cat = e.target.value; renderList(); };
    $("fmin").onchange = (e) => { f.min = +e.target.value; renderList(); };
    $("fsort").onchange = (e) => { f.sort = e.target.value; renderList(); };
    $("addBtn").onclick = () => openForm(null);
    $("flocs").onclick = (e) => { const b = e.target.closest("[data-loc]"); if (!b) return; const v = b.dataset.loc; v === "" ? f.locs.clear() : f.locs.has(v) ? f.locs.delete(v) : f.locs.add(v); renderJobsView(); };
    bindList();
  }
  $("fq").value = f.q; $("fsort").value = f.sort; $("fmin").value = String(f.min);
  $("fcat").innerHTML = opts(CATS, f.cat, tCat, t("allCats"));
  [...f.locs].forEach((l) => { if (!locs.includes(l)) f.locs.delete(l); });
  $("flocs").innerHTML = locs.length > 1 ? `<button class="chip" data-loc="" aria-pressed="${!f.locs.size}">${esc(t("all"))}</button>` + locs.map((l) => `<button class="chip" data-loc="${esc(l)}" aria-pressed="${f.locs.has(l)}">${esc(tCountry(l))}</button>`).join("") : "";
  renderList();
}

function renderList() {
  const rows = filtered(), el = $("jobList");
  $("count").textContent = t("shown", rows.length, S.jobs.length) + (S.an ? "" : ". " + t("addCvHint"));
  if (!S.jobs.length) {
    el.innerHTML = `<div class="empty"><b>${esc(t("noJobs"))}</b><p>${esc(t("noJobsHint"))}</p><div class="row"><button class="btn primary" data-act="add">${esc(t("addJob"))}</button><button class="btn" data-act="examples">${esc(t("loadEx"))}</button></div></div>`;
    return;
  }
  if (!rows.length) { el.innerHTML = `<div class="empty"><b>${esc(t("noMatchFilters"))}</b><p>${esc(t("noMatchHint"))}</p></div>`; return; }
  el.innerHTML = rows.map(jobCard).join("") + (S.jobs.some((j) => j.example) ? `<div><button class="btn" data-act="rmExamples">${esc(t("rmEx"))}</button></div>` : "");
}

function bindList() {
  const el = $("jobList");
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const act = b.dataset.act;
    if (act === "add") return openForm(null);
    if (act === "examples") return loadExamples();
    if (act === "rmExamples") return removeJobs(S.jobs.filter((j) => j.example).map((j) => j.id));
    const id = b.closest(".job")?.dataset.id, j = S.jobs.find((x) => x.id === id); if (!j) return;
    if (act === "edit") openForm(j);
    if (act === "docs") openDocs(j);
    if (act === "ics") followUpIcs(j);
    if (act === "del") {
      if (b.dataset.arm) { removeJobs([id]); toast(t("deleted")); }
      else { b.dataset.arm = "1"; b.textContent = t("confirmDel"); setTimeout(() => { if (b.isConnected) { delete b.dataset.arm; b.textContent = t("del"); } }, 3000); }
    }
  });
  el.addEventListener("change", (e) => {
    if (e.target.dataset.act !== "status") return;
    const j = S.jobs.find((x) => x.id === e.target.closest(".job").dataset.id);
    if (j) saveJob(withStatus(j, e.target.value));
  });
}

// ---------- add / edit form ----------
function openForm(job, pre) {
  S.editing = job ? job.id : null;
  const d = job || { status: "Saved", country: "", category: "", ...pre };
  const dlg = $("jobDlg");
  dlg.innerHTML = `<form id="jobForm" class="sheet" novalidate>
    <header><h2>${esc(t(job ? "formEdit" : "formAdd"))}</h2><button type="button" class="btn ghost" data-close aria-label="${esc(t("cancel"))}">✕</button></header>
    <div class="sheet-body">
      ${job ? "" : `<div class="field"><label for="j-paste">${esc(t("pasteAd"))}</label><textarea id="j-paste" rows="4">${esc(pre?.paste || "")}</textarea><p class="hint">${esc(t("pasteAdHint"))}</p></div>`}
      <div id="j-preview"></div>
      <div class="grid2">
        <div class="field span2"><label for="j-title">${esc(t("fTitle"))}</label><input id="j-title" type="text" value="${esc(d.title)}" required></div>
        <div class="field"><label for="j-company">${esc(t("fCompany"))}</label><input id="j-company" type="text" value="${esc(d.company)}"></div>
        <div class="field"><label for="j-status">${esc(t("fStatus"))}</label><select id="j-status">${opts(STATUSES, d.status, tStatus)}</select></div>
        <div class="field"><label for="j-country">${esc(t("fCountry"))}</label><select id="j-country">${opts(COUNTRIES, d.country, tCountry, "—")}</select></div>
        <div class="field"><label for="j-city">${esc(t("fCity"))}</label><input id="j-city" type="text" value="${esc(d.city)}"></div>
        <div class="field"><label for="j-cat">${esc(t("fCat"))}</label><select id="j-cat">${opts(CATS, d.category, tCat, "—")}</select></div>
        <div class="field"><label for="j-follow">${esc(t("fFollow"))}</label><input id="j-follow" type="date" value="${esc(d.followUp)}"></div>
        <div class="field"><label for="j-salary">${esc(t("fSalary"))}</label><input id="j-salary" type="text" value="${esc(d.salary)}" placeholder="${esc(t("fSalaryPh"))}"></div>
        <div class="field"><label for="j-link">${esc(t("fLink"))}</label><input id="j-link" type="url" value="${esc(d.link)}" placeholder="https://"></div>
      </div>
      <div class="field"><label for="j-desc">${esc(t("fDesc"))}</label><textarea id="j-desc" rows="5">${esc(d.desc)}</textarea></div>
      <div class="field"><label for="j-notes">${esc(t("fNotes"))}</label><textarea id="j-notes" rows="2">${esc(d.notes)}</textarea></div>
      ${job && (job.history?.length || job.docs?.length) ? `<div><p class="lbl">${esc(t("history"))}</p><ol class="hist">${[...job.history.map((h) => ({ l: tStatus(h.status), at: h.at })), ...job.docs.map((d) => ({ l: t("docMade", d.kind, d.template), at: d.at }))].sort((a, b) => a.at.localeCompare(b.at)).map((h) => `<li>${esc(h.l)} <span>${esc(fmtDate(h.at))}</span></li>`).join("")}</ol></div>` : ""}
    </div>
    <footer><button class="btn primary" type="submit">${esc(t("save"))}</button><button class="btn" type="button" data-close>${esc(t("cancel"))}</button></footer>
  </form>`;
  const form = $("jobForm");
  const preview = () => {
    const r = score(S.an, $("j-title").value, $("j-desc").value, $("j-cat").value + " " + $("j-notes").value);
    if (!r || (!$("j-title").value.trim() && !$("j-desc").value.trim())) { $("j-preview").innerHTML = ""; return; }
    const cls = r.score >= 70 ? "hi" : r.score >= 45 ? "mid" : "lo";
    $("j-preview").innerHTML = `<div class="preview"><div class="score ${cls}"><b>${r.score}<small>%</small></b><div class="meter"><i style="width:${r.score}%"></i></div><span>${esc(r.low ? t("limited") : t("match"))}</span></div>
      <div>${r.matched.length ? `<p class="lbl">${esc(t("covers"))}</p><div class="chips">${r.matched.map((k) => chip(k, "good")).join("")}</div>` : ""}
      ${r.missing.length ? `<p class="lbl">${esc(t("notFound"))}</p><div class="chips">${r.missing.map((k) => chip(k, "warn")).join("")}</div>` : ""}
      ${r.flags.length ? `<div class="chips">${r.flags.map((f) => chip(flagText(f), "warn")).join("")}</div>` : ""}</div></div>`;
  };
  const fill = (p) => {
    const set = (id, v) => { if (v && !$(id).value.trim()) $(id).value = v; };
    set("j-title", p.title); set("j-company", p.company); set("j-city", p.city); set("j-salary", p.salary); set("j-link", p.link);
    if (p.country && !$("j-country").value) $("j-country").value = p.country;
    if (p.category && !$("j-cat").value) $("j-cat").value = p.category;
    if (p.desc && !$("j-desc").value.trim()) $("j-desc").value = p.desc;
    preview();
  };
  const paste = $("j-paste");
  if (paste) paste.addEventListener("input", () => { if (paste.value.trim().length > 30) fill(parseAd(paste.value)); });
  if (pre?.parsed) fill(pre.parsed);
  ["j-title", "j-desc", "j-cat", "j-notes"].forEach((id) => $(id).addEventListener("input", preview));
  preview();
  form.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) dlg.close(); });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = $("j-title").value.trim();
    if (!title) { toast(t("titleRequired")); $("j-title").focus(); return; }
    const old = S.editing ? S.jobs.find((x) => x.id === S.editing) : null;
    let j = normalizeJob({ ...(old || {}), id: old?.id, title, company: $("j-company").value.trim(), country: $("j-country").value, city: $("j-city").value.trim(),
      category: $("j-cat").value, status: old ? old.status : "Saved", salary: $("j-salary").value.trim(), link: $("j-link").value.trim(),
      desc: $("j-desc").value.trim(), notes: $("j-notes").value.trim(), followUp: $("j-follow").value, added: old?.added, history: old?.history });
    j = withStatus(j, $("j-status").value);
    await saveJob(j); dlg.close(); toast(t("saved"));
  });
  dlg.showModal();
  (paste && !pre ? paste : $("j-title")).focus();
}

function loadExamples() {
  const now = Date.now();
  const ex = [
    { title: "Commissioning Engineer, Packaging Lines", country: "Saudi Arabia", category: "Installation and commissioning", status: "Saved", desc: "Commissioning and start-up of packaging and converting lines. Mechanical troubleshooting, preventive maintenance, operator training. 5+ years in manufacturing." },
    { title: "Production Manager, Paper Converting", country: "Oman", category: "Production and operations", status: "Applied", followUp: isoDay(), desc: "Lead a production team on paper converting lines. Production planning in SAP, Lean, quality standards and HSE. 8+ years of experience." },
    { title: "Process Engineer, Battery Plant", country: "Germany", category: "Automotive", status: "Saved", desc: "Automotive supplier. PLC programming with Siemens, ISO 9001, German language required, 4+ years." },
  ].map((e, i) => normalizeJob({ ...e, company: "Sample Co (example)", added: now - i, example: true }));
  S.jobs.push(...ex); db.putJobs(ex).then(render);
}

// ---------- CV view ----------
function renderCvView() {
  const el = $("v-cv"), an = S.an;
  el.innerHTML = `<section class="box"><h2>${esc(t("cvTitle"))}</h2><p class="hint">${esc(t("cvHint"))}</p>
    <label class="btn primary file"><input id="cvFile" type="file" accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain">${esc(t("chooseFile"))}</label>
    <p class="hint" id="cvStatus" role="status">${S.cv.fileName ? esc(t("readOk", S.cv.fileName)) : ""}</p>
    <div class="field"><label for="cvText">${esc(t("orPaste"))}</label><textarea id="cvText" rows="6">${esc(S.cv.text)}</textarea></div>
    <div class="row"><button class="btn" id="cvSave">${esc(t("analyze"))}</button></div></section>
    ${an ? `<section class="box"><h2>${esc(t("found"))}</h2><p class="hint">${[S.cv.fileName, t("words", an.words), an.years ? t("yearsStated", an.years) : ""].filter(Boolean).map(esc).join(", ")}</p>
      <p class="lbl">${esc(t("skills"))}</p><div class="chips">${skillLabels(an).map((x) => chip(x)).join("") || `<span class="hint">${esc(t("nothing"))}</span>`}</div>
      <p class="lbl">${esc(t("fitTitles"))}</p><div class="chips">${an.titles.map((x) => chip(x, "good")).join("") || "–"}</div>
      ${S.jobs.length ? `<p class="hint">${esc(t("ranked", S.jobs.length))}</p>` : ""}</section>`
    : `<div class="empty"><b>${esc(t("noCv"))}</b><p>${esc(t("noCvHint"))}</p></div>`}
    <section class="box" id="profBox"></section>`;
  renderProfile(S.profile);
  $("cvFile").onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const st = $("cvStatus"); st.textContent = t("reading", file.name);
    try {
      const text = (await readCvFile(file) || "").trim();
      if (text.length < 40) { st.textContent = t("readFail"); return; }
      await setCv(text, file.name); toast(t("cvAnalyzed"));
    } catch (err) { console.error(err); st.textContent = t("readFail"); }
  };
  $("cvSave").onclick = async () => {
    const v = $("cvText").value.trim();
    if (v.length < 40) return toast(t("cvShort"));
    await setCv(v, v === S.cv.text ? S.cv.fileName : ""); toast(t("cvAnalyzed"));
  };
}

// ---------- profile editor ----------
function renderProfile(p) {
  const f = (k, label, type = "text", span = "") => `<div class="field ${span}"><label for="p-${k}">${esc(t(label))}</label><input id="p-${k}" data-p="${k}" type="${type}" value="${esc(p[k])}"></div>`;
  const ta = (k, label, rows = 4, hint = "onePerLine") => `<div class="field"><label for="p-${k}">${esc(t(label))}</label><textarea id="p-${k}" data-pl="${k}" rows="${rows}">${esc(p[k].join("\n"))}</textarea>${hint ? `<p class="hint">${esc(t(hint))}</p>` : ""}</div>`;
  $("profBox").innerHTML = `<h2>${esc(t("profTitle"))}</h2><p class="hint">${esc(t("profHint"))}</p>
    <div class="row">${S.cv.text ? `<button class="btn" id="pFill">${esc(t("fillFromCv"))}</button>` : ""}${S.cv.text && hasAI() ? `<button class="btn" id="pFillAi">${esc(t("fillAi"))}</button>` : ""}</div>
    <div class="grid2">${f("name", "pName", "text", "span2")}${f("headline", "pHeadline", "text", "span2")}${f("location", "pLocation")}${f("phone", "pPhone", "tel")}${f("email", "pEmail", "email")}${f("linkedin", "pLinkedin")}${f("nationality", "pNationality")}${f("availability", "pAvailability")}${f("licence", "pLicence")}</div>
    <div class="field"><label for="p-summary">${esc(t("pSummary"))}</label><textarea id="p-summary" data-p="summary" rows="5">${esc(p.summary)}</textarea></div>
    ${ta("skills", "pSkills", 5)}${ta("achievements", "pAchievements", 3)}
    <p class="lbl">${esc(t("pExperience"))}</p>
    <div id="xpList" class="xplist">${p.experience.map((x, i) => `<fieldset class="xp" data-i="${i}"><div class="grid2">
      <div class="field"><label>${esc(t("pRole"))}</label><input data-x="role" type="text" value="${esc(x.role)}"></div>
      <div class="field"><label>${esc(t("pOrg"))}</label><input data-x="org" type="text" value="${esc(x.org)}"></div>
      <div class="field"><label>${esc(t("pPlace"))}</label><input data-x="place" type="text" value="${esc(x.place)}"></div>
      <div class="field"><label>${esc(t("pDates"))}</label><input data-x="dates" type="text" value="${esc(x.dates)}"></div></div>
      <div class="field"><label>${esc(t("pBullets"))}</label><textarea data-x="bullets" rows="4">${esc(x.bullets.join("\n"))}</textarea><p class="hint">${esc(t("onePerLine"))}</p></div>
      <div class="row">${i ? `<button class="btn ghost" type="button" data-xa="up">${esc(t("moveUp"))}</button>` : ""}<button class="btn ghost danger" type="button" data-xa="rm">${esc(t("removePos"))}</button></div></fieldset>`).join("")}</div>
    <div class="row"><button class="btn" type="button" id="pAddXp">${esc(t("addPos"))}</button></div>
    ${ta("education", "pEducation", 3)}${ta("training", "pTraining", 3)}${ta("languages", "pLanguages", 3)}${ta("interests", "pInterests", 2)}
    <div class="row sticky-actions"><button class="btn primary" id="pSave">${esc(t("saveProfile"))}</button><button class="btn" id="pPreview">${esc(t("previewCv"))}</button></div>`;
  const box = $("profBox");
  box.querySelector("#pAddXp").onclick = () => { const c = collectProfile(); c.experience.push({ role: "", org: "", place: "", dates: "", bullets: [] }); renderProfile(c); };
  box.querySelector("#xpList").onclick = (e) => {
    const b = e.target.closest("[data-xa]"); if (!b) return;
    const c = collectProfile(), i = +b.closest(".xp").dataset.i;
    if (b.dataset.xa === "rm") c.experience.splice(i, 1); else [c.experience[i - 1], c.experience[i]] = [c.experience[i], c.experience[i - 1]];
    renderProfile(c);
  };
  box.querySelector("#pSave").onclick = async () => { await saveProfile(collectProfile()); toast(t("profileSaved")); };
  box.querySelector("#pPreview").onclick = async () => { await saveProfile(collectProfile()); openDocs(null); };
  const arm = (b, go) => {
    if (!hasProfile(S.profile) || b.dataset.arm) return go();
    b.dataset.arm = "1"; const old = b.textContent; b.textContent = t("fillConfirm");
    setTimeout(() => { if (b.isConnected) { delete b.dataset.arm; b.textContent = old; } }, 3500);
  };
  const fill = box.querySelector("#pFill");
  if (fill) fill.onclick = () => arm(fill, () => { renderProfile(normalizeProfile(profileFromText(S.cv.text))); toast(t("filled")); });
  const fillAi = box.querySelector("#pFillAi");
  if (fillAi) fillAi.onclick = () => arm(fillAi, async () => {
    fillAi.disabled = true; fillAi.textContent = t("aiWorking");
    try { renderProfile(normalizeProfile(await aiProfile(aiCfg(), S.cv.text))); toast(t("filled")); }
    catch (err) { toast(t("aiFail", err.message)); fillAi.disabled = false; fillAi.textContent = t("fillAi"); }
  });
}
function collectProfile() {
  const box = $("profBox"), p = emptyProfile();
  box.querySelectorAll("[data-p]").forEach((el) => (p[el.dataset.p] = el.value.trim()));
  box.querySelectorAll("[data-pl]").forEach((el) => (p[el.dataset.pl] = lines(el.value)));
  if (p.skills.length === 1 && p.skills[0].includes(",")) p.skills = p.skills[0].split(/\s*,\s*/);
  p.experience = [...box.querySelectorAll(".xp")].map((fs) => {
    const g = (k) => fs.querySelector(`[data-x="${k}"]`).value.trim();
    return { role: g("role"), org: g("org"), place: g("place"), dates: g("dates"), bullets: lines(g("bullets")) };
  });
  return p;
}
async function saveProfile(p) { S.profile = normalizeProfile(p); await db.setKV("profile", S.profile); }

// ---------- CV and letter for a job ----------
function printHtml(html) {
  const el = $("print"); el.innerHTML = html; document.body.classList.add("printing");
  const done = () => { document.body.classList.remove("printing"); el.innerHTML = ""; window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done); window.print(); setTimeout(done, 60000);
}
async function recordDoc(job, kind, template) {
  if (!job) return;
  const j = S.jobs.find((x) => x.id === job.id); if (!j) return;
  await saveJob({ ...j, docs: [...(j.docs || []), { kind, template, at: isoDay() }] });
}

function openDocs(job) {
  const dlg = $("jobDlg"), p = S.profile;
  if (!hasProfile(p)) {
    dlg.innerHTML = `<div class="sheet"><header><h2>${esc(t("needProfile"))}</h2><button type="button" class="btn ghost" data-close aria-label="${esc(t("cancel"))}">✕</button></header>
      <div class="sheet-body"><p>${esc(t("needProfileHint"))}</p><div class="row"><a class="btn primary" href="#cv" data-close>${esc(t("goProfile"))}</a></div></div></div>`;
    dlg.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => dlg.close()));
    dlg.showModal(); return;
  }
  const st = { template: templateFor(job?.country), lang: getLang(), relevantFirst: !!job, objective: !!job, tab: "cv", summary: null, letter: "" };
  const prof = () => (st.summary != null ? { ...p, summary: st.summary } : p);
  const model = () => buildCv(prof(), job, st);
  const fileBase = () => slug(p.name) + (job ? "-" + slug(job.company || job.title) : "");
  const draw = () => {
    dlg.innerHTML = `<div class="sheet"><header><h2>${esc(t("docsTitle"))}${job ? `<small>${esc(job.title)}${job.company ? ", " + esc(job.company) : ""}</small>` : ""}</h2><button type="button" class="btn ghost" data-close aria-label="${esc(t("cancel"))}">✕</button></header>
      <div class="sheet-body">
        <div class="grid3">
          <div class="field"><label for="d-tpl">${esc(t("template"))}</label><select id="d-tpl">${["gulf", "europe", "canada"].map((x) => `<option value="${x}"${x === st.template ? " selected" : ""}>${esc(t("tpl" + x[0].toUpperCase() + x.slice(1)))}</option>`).join("")}</select></div>
          <div class="field"><label for="d-lang">${esc(t("docLang"))}</label><select id="d-lang"><option value="en">English</option><option value="fr">Français</option></select></div>
        </div>
        ${job ? `<label class="check"><input type="checkbox" id="d-rel"${st.relevantFirst ? " checked" : ""}> ${esc(t("relFirst"))}</label>
        <label class="check"><input type="checkbox" id="d-obj"${st.objective ? " checked" : ""}> ${esc(t("objective"))}</label>
        <div class="tabs" role="tablist"><button role="tab" data-tab="cv" aria-selected="${st.tab === "cv"}">${esc(t("tabCv"))}</button><button role="tab" data-tab="letter" aria-selected="${st.tab === "letter"}">${esc(t("tabLetter"))}</button></div>` : ""}
        <div id="d-pane"></div>
      </div></div>`;
    $("d-lang").value = st.lang;
    dlg.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => dlg.close()));
    $("d-tpl").onchange = (e) => { st.template = e.target.value; pane(); };
    $("d-lang").onchange = (e) => { st.lang = e.target.value; st.letter = ""; pane(); };
    if (job) {
      $("d-rel").onchange = (e) => { st.relevantFirst = e.target.checked; pane(); };
      $("d-obj").onchange = (e) => { st.objective = e.target.checked; pane(); };
      dlg.querySelector(".tabs").onclick = (e) => { const b = e.target.closest("[data-tab]"); if (b) { st.tab = b.dataset.tab; draw(); } };
    }
    pane();
  };
  const aiBtn = async (btn, fn) => {
    const old = btn.textContent; btn.disabled = true; btn.textContent = t("aiWorking");
    try { await fn(); toast(t("aiDone")); } catch (err) { toast(t("aiFail", err.message)); } finally { if (btn.isConnected) { btn.disabled = false; btn.textContent = old; } }
  };
  const pane = () => {
    const el = $("d-pane");
    if (st.tab === "cv") {
      const m = model();
      el.innerHTML = `<div class="row"><button class="btn primary" id="d-word">${esc(t("dlWord"))}</button><button class="btn" id="d-pdf">${esc(t("printPdf"))}</button>
        ${job && hasAI() ? `<button class="btn" id="d-ai">${esc(t("aiSummary"))}</button>` : ""}</div>
        ${st.summary != null ? `<p class="aiwarn">${esc(t("aiUsed"))} <button class="btn ghost" id="d-undo">${esc(t("undo"))}</button></p>` : ""}
        <div class="paperwrap">${cvHtml(m)}</div>`;
      $("d-word").onclick = () => { download(`${fileBase()}-CV.docx`, cvDocx(m), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"); recordDoc(job, "cv", st.template); };
      $("d-pdf").onclick = () => { printHtml(cvHtml(m)); recordDoc(job, "cv", st.template); };
      if ($("d-ai")) $("d-ai").onclick = (e) => aiBtn(e.currentTarget, async () => { st.summary = await aiSummary(aiCfg(), p, job, st.lang); pane(); });
      if ($("d-undo")) $("d-undo").onclick = () => { st.summary = null; pane(); };
    } else {
      if (!st.letter) st.letter = buildLetter(prof(), job, st.lang);
      el.innerHTML = `<div class="row"><button class="btn primary" id="d-word">${esc(t("dlWord"))}</button><button class="btn" id="d-pdf">${esc(t("printPdf"))}</button><button class="btn" id="d-copy">${esc(t("copy"))}</button>
        ${hasAI() ? `<button class="btn" id="d-ai">${esc(t("aiLetter"))}</button>` : ""}</div>
        <textarea id="d-letter" class="letterbox" rows="22">${esc(st.letter)}</textarea>`;
      $("d-letter").oninput = (e) => (st.letter = e.target.value);
      $("d-word").onclick = () => { download(`${fileBase()}-letter.docx`, letterDocx(st.letter, p.name, st.lang), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"); recordDoc(job, "letter", st.template); };
      $("d-pdf").onclick = () => { printHtml(letterHtml(st.letter)); recordDoc(job, "letter", st.template); };
      $("d-copy").onclick = async () => { try { await navigator.clipboard.writeText(st.letter); toast(t("copied")); } catch { $("d-letter").select(); } };
      if ($("d-ai")) $("d-ai").onclick = (e) => aiBtn(e.currentTarget, async () => { st.letter = await aiLetter(aiCfg(), prof(), job, st.letter, st.lang); pane(); });
    }
  };
  draw(); dlg.showModal();
}

// ---------- Find view ----------
function renderFindView() {
  const st = S.settings, el = $("v-find");
  const titles = [...(S.an?.titles.length ? S.an.titles : DEFAULT_TITLES)];
  if (st.findTitle && !titles.includes(st.findTitle)) titles.push(st.findTitle);
  if (!st.findTitle) st.findTitle = titles[0];
  const cs = COUNTRIES.filter((c) => c !== "Other" && st.findCountries.includes(c));
  el.innerHTML = `<section class="box"><h2>${esc(t("findTitle"))}</h2><p class="hint">${esc(t("findHint"))}</p>
    <p class="lbl">${esc(t("dest"))}</p><div class="chips" id="fC">${COUNTRIES.filter((c) => c !== "Other").map((c) => `<button class="chip" data-c="${esc(c)}" aria-pressed="${st.findCountries.includes(c)}">${esc(tCountry(c))}</button>`).join("")}</div>
    <div class="field"><label for="fCity">${esc(t("city"))}</label><input id="fCity" type="text" value="${esc(st.findCity)}" placeholder="${esc(t("cityPh"))}"></div>
    <p class="lbl">${esc(t("jobTitle"))}</p><div class="chips" id="fT">${titles.map((x) => `<button class="chip" data-t="${esc(x)}" aria-pressed="${x === st.findTitle}">${esc(x)}</button>`).join("")}</div>
    <div class="row end"><div class="field grow"><label for="fCustom">${esc(t("otherTitle"))}</label><input id="fCustom" type="text" placeholder="${esc(t("otherPh"))}"></div><button class="btn" id="fUse">${esc(t("useTitle"))}</button></div></section>
    <section class="box" id="fOut">${cs.length ? cs.map((c) => `<div class="links"><h3>${esc(tCountry(c))}${st.findCity && cs.length === 1 ? ", " + esc(st.findCity) : ""}</h3><div class="linkrow">${
      searchLinks(st.findTitle, c, cs.length === 1 ? st.findCity : "", st.sites).map((l) => `<a class="btn" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.site)}</a>`).join("")}</div></div>`).join("") : `<p class="hint">${esc(t("pickOne"))}</p>`}</section>
    <section class="box"><h2>${esc(t("mySites"))}</h2><p class="hint">${esc(t("mySitesHint"))}</p>
      <div class="chips">${st.sites.map((s) => `<span class="chip plain">${esc(s)} <button class="x" data-rm="${esc(s)}" aria-label="${esc(t("remove"))} ${esc(s)}">✕</button></span>`).join("")}</div>
      <div class="row end"><div class="field grow"><label for="fSite">${esc(t("site"))}</label><input id="fSite" type="text" placeholder="${esc(t("sitePh"))}" inputmode="url"></div><button class="btn" id="fSiteAdd">${esc(t("addSite"))}</button></div></section>`;
  const save = () => { saveSettings(); renderFindView(); };
  $("fC").onclick = (e) => { const b = e.target.closest("[data-c]"); if (!b) return; const c = b.dataset.c, a = st.findCountries; st.findCountries = a.includes(c) ? a.filter((x) => x !== c) : [...a, c]; save(); };
  $("fT").onclick = (e) => { const b = e.target.closest("[data-t]"); if (b) { st.findTitle = b.dataset.t; save(); } };
  $("fCity").onchange = (e) => { st.findCity = e.target.value.trim(); save(); };
  $("fUse").onclick = () => { const v = $("fCustom").value.trim(); if (v) { st.findTitle = v; save(); } };
  $("fSiteAdd").onclick = () => {
    const v = $("fSite").value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(v) && !st.sites.includes(v)) { st.sites = [...st.sites, v]; save(); }
  };
  el.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => { st.sites = st.sites.filter((s) => s !== b.dataset.rm); save(); }));
}

// ---------- More view ----------
function renderMoreView() {
  const el = $("v-more");
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !matchMedia("(display-mode: standalone)").matches;
  el.innerHTML = `<section class="box"><h2>${esc(t("moreTitle"))}</h2>
      <div class="field"><label for="mLang">${esc(t("language"))}</label><select id="mLang"><option value="en">English</option><option value="fr">Français</option></select></div></section>
    ${S.installEvt || ios ? `<section class="box"><h2>${esc(t("install"))}</h2><p class="hint">${esc(t("installHint"))}</p>${S.installEvt ? `<div class="row"><button class="btn primary" id="mInstall">${esc(t("install"))}</button></div>` : `<p>${esc(t("iosInstall"))}</p>`}</section>` : ""}
    <section class="box"><h2>${esc(t("aiTitle"))}</h2><p class="hint">${esc(t("aiHint"))}</p>
      <div class="grid2"><div class="field"><label for="mKey">${esc(t("apiKey"))}</label><input id="mKey" type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-…" value="${esc(S.settings.apiKey)}"></div>
      <div class="field"><label for="mModel">${esc(t("model"))}</label><input id="mModel" type="text" spellcheck="false" value="${esc(S.settings.model || DEFAULT_MODEL)}"></div></div>
      <p class="hint">${esc(t("aiPrivacy"))}</p>
      <div class="row"><button class="btn" id="mKeyTest">${esc(t("testKey"))}</button>${S.settings.apiKey ? `<button class="btn danger" id="mKeyRm">${esc(t("removeKey"))}</button>` : ""}</div></section>
    <section class="box"><h2>${esc(t("backup"))}</h2><p class="hint">${esc(t("backupHint"))}</p>
      <div class="row"><button class="btn primary" id="mBackup">${esc(t("exportJson"))}</button>
      <label class="btn file"><input type="file" id="mRestore" accept=".json,application/json">${esc(t("importJson"))}</label></div>
      <div class="row"><button class="btn" id="mCsv">${esc(t("exportCsv"))}</button>
      <label class="btn file"><input type="file" id="mCsvIn" accept=".csv,text/csv">${esc(t("importCsv"))}</label></div></section>
    <section class="box"><p class="hint">${esc(t("privacy"))}</p><div class="row"><button class="btn danger" id="mWipe">${esc(t("wipe"))}</button></div></section>`;
  $("mLang").value = getLang();
  $("mLang").onchange = (e) => { S.settings.lang = e.target.value; setLang(e.target.value); saveSettings(); $("v-jobs").dataset.built = ""; render(); };
  if ($("mInstall")) $("mInstall").onclick = async () => { S.installEvt.prompt(); await S.installEvt.userChoice; S.installEvt = null; renderMoreView(); };
  $("mKeyTest").onclick = async (e) => {
    const b = e.currentTarget;
    S.settings.apiKey = $("mKey").value.trim(); S.settings.model = $("mModel").value.trim() || DEFAULT_MODEL; await saveSettings();
    if (!S.settings.apiKey) return renderMoreView(); b.disabled = true; b.textContent = t("aiWorking");
    try { await callClaude({ ...aiCfg(), maxTokens: 5, prompt: "Reply OK", system: "Reply with OK." }); toast(t("keyOk")); }
    catch (err) { toast(t("aiFail", err.message)); }
    renderMoreView();
  };
  if ($("mKeyRm")) $("mKeyRm").onclick = async () => { S.settings.apiKey = ""; await saveSettings(); renderMoreView(); toast(t("keyRemoved")); };
  $("mBackup").onclick = () => { const { apiKey, ...settings } = S.settings; backupJson(S.jobs, S.cv, settings, S.profile); };
  $("mCsv").onclick = () => exportCsv(S.jobs);
  $("mRestore").onchange = (e) => readThen(e, async (text) => {
    const d = parseBackup(text), jobs = d.jobs.map(normalizeJob);
    await db.putJobs(jobs); jobs.forEach((j) => { const i = S.jobs.findIndex((x) => x.id === j.id); i < 0 ? S.jobs.push(j) : (S.jobs[i] = j); });
    if (d.cv?.text) await setCv(d.cv.text, d.cv.fileName);
    if (d.settings) { const { apiKey, ...rest } = d.settings; S.settings = { ...S.settings, ...rest }; saveSettings(); }
    if (d.profile) await saveProfile(d.profile);
    render(); toast(t("restored", jobs.length));
  });
  $("mCsvIn").onchange = (e) => readThen(e, async (text) => {
    const jobs = parseCsv(text).filter((r) => r.title).map((r, i) => normalizeJob({ ...r, id: uid(), added: Date.now() - i }));
    S.jobs.push(...jobs); await db.putJobs(jobs); render(); toast(t("imported", jobs.length));
  });
  $("mWipe").onclick = async (e) => {
    const b = e.currentTarget;
    if (!b.dataset.arm) { b.dataset.arm = "1"; b.textContent = t("wipeConfirm"); setTimeout(() => { if (b.isConnected) { delete b.dataset.arm; b.textContent = t("wipe"); } }, 4000); return; }
    await db.wipe(); S.jobs = []; S.cv = { text: "", fileName: "" }; S.an = null; S.profile = emptyProfile(); S.settings.apiKey = ""; render(); toast(t("wiped"));
  };
}
async function readThen(e, fn) {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  try { await fn(await f.text()); } catch (err) { console.error(err); toast(t("badFile")); }
}

// ---------- shell ----------
function render() {
  document.title = t("appTitle");
  $("nav").innerHTML = VIEWS.map((v) => `<a href="#${v}" aria-current="${S.view === v ? "page" : "false"}"><span class="ico ico-${v}" aria-hidden="true"></span>${esc(t("nav" + v[0].toUpperCase() + v.slice(1)))}</a>`).join("");
  VIEWS.forEach((v) => ($("v-" + v).hidden = v !== S.view));
  $("stats").hidden = S.view !== "jobs";
  if (S.view === "jobs") { renderStats(); renderJobsView(); }
  if (S.view === "find") renderFindView();
  if (S.view === "cv") renderCvView();
  if (S.view === "more") renderMoreView();
}
function route() { const v = location.hash.slice(1); S.view = VIEWS.includes(v) ? v : "jobs"; render(); window.scrollTo(0, 0); }

function handleShare() {
  const p = new URLSearchParams(location.search);
  if (!["title", "text", "url"].some((k) => p.get(k))) return;
  const shared = { title: p.get("title") || "", text: p.get("text") || "", url: p.get("url") || "" };
  history.replaceState(null, "", location.pathname + "#jobs");
  const raw = [shared.title, shared.text, shared.url].filter(Boolean).join("\n");
  openForm(null, { paste: raw, parsed: parseAd("", shared) });
}

function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("./sw.js").then((reg) => {
    const ask = (w) => toast(t("updateReady"), { label: t("reload"), fn: () => w.postMessage("skipWaiting") });
    if (reg.waiting && navigator.serviceWorker.controller) ask(reg.waiting);
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      w?.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) ask(w); });
    });
  }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloaded) { reloaded = true; location.reload(); } });
}

async function boot() {
  $("stats").addEventListener("click", (e) => { const b = e.target.closest(".stat"); if (b) { S.f.status = b.dataset.st; renderStats(); renderList(); } });
  window.addEventListener("hashchange", route);
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); S.installEvt = e; if (S.view === "more") renderMoreView(); });
  $("jobDlg").addEventListener("close", () => { $("jobDlg").innerHTML = ""; });
  const [jobs, cv, settings, profile] = await Promise.all([db.allJobs(), db.getKV("cv"), db.getKV("settings"), db.getKV("profile")]);
  if (profile) S.profile = normalizeProfile(profile);
  S.jobs = (jobs || []).map(normalizeJob);
  if (settings) S.settings = { ...S.settings, ...settings };
  setLang(S.settings.lang || detectLang());
  if (cv?.text) { S.cv = { text: cv.text, fileName: cv.fileName || "" }; S.an = analyze(cv.text); }
  route();
  handleShare();
  db.requestPersist();
  registerSW();
}
boot();
