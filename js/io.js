// Files in and out: JSON backup, CSV (v1-compatible), .ics reminders. Plus job-site search links.

export function download(filename, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const stamp = () => new Date().toISOString().slice(0, 10);

export function backupJson(jobs, cv, settings, profile) {
  download(`job-tracker-backup-${stamp()}.json`, JSON.stringify({ app: "expat-job-tracker", version: 2, exported: new Date().toISOString(), jobs, cv, settings, profile }, null, 1), "application/json");
}
export function parseBackup(text) {
  const d = JSON.parse(text);
  if (d.app !== "expat-job-tracker" || !Array.isArray(d.jobs)) throw new Error("format");
  return d;
}

const CSV_COLS = ["title", "company", "country", "city", "category", "status", "salary", "link", "followUp", "notes", "desc"];
const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
export function exportCsv(jobs) {
  download(`job-tracker-${stamp()}.csv`, "\ufeff" + [CSV_COLS.join(","), ...jobs.map((j) => CSV_COLS.map((c) => q(j[c])).join(","))].join("\r\n"), "text/csv");
}
export function parseCsv(text) {
  const rows = []; let row = [], f = "", inQ = false;
  text = text.replace(/^\ufeff/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else inQ = false; } else f += c; }
    else if (c === '"') inQ = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const head = (rows.shift() || []).map((h) => h.trim());
  if (!head.includes("title")) throw new Error("format");
  return rows.filter((r) => r.some((x) => x.trim())).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || "").trim()])));
}

// All-day calendar event on the follow-up date.
export function followUpIcs(job) {
  const d = job.followUp.replace(/-/g, "");
  const next = new Date(job.followUp + "T00:00:00Z"); next.setUTCDate(next.getUTCDate() + 1);
  const e = (s) => String(s || "").replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Expat Job Tracker//EN", "BEGIN:VEVENT",
    `UID:${job.id}-${d}@expat-job-tracker`, `DTSTAMP:${now}`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, "")}`,
    `SUMMARY:${e("Follow up: " + job.title + (job.company ? " – " + job.company : ""))}`,
    `DESCRIPTION:${e([job.link, job.notes].filter(Boolean).join("\n"))}`,
    "BEGIN:VALARM", "TRIGGER:PT9H", "ACTION:DISPLAY", "DESCRIPTION:Follow up", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  download(`follow-up-${(job.company || job.title).replace(/[^\p{L}\d]+/gu, "-").slice(0, 40)}.ics`, ics, "text/calendar");
}

// --- Search links ---
const INDEED = { "Saudi Arabia": "sa", Oman: "om", Qatar: "qa", UAE: "ae", Kuwait: "kw", Bahrain: "bh", Germany: "de", Austria: "at", Canada: "ca" };
const GULF = ["bayt.com", "gulftalent.com", "naukrigulf.com"];
const LOCAL = {
  "Saudi Arabia": GULF, Oman: GULF, Qatar: GULF, UAE: GULF, Kuwait: GULF, Bahrain: GULF,
  Germany: ["arbeitsagentur.de", "stepstone.de"], Austria: ["karriere.at", "ams.at"], Canada: ["jobbank.gc.ca", "workopolis.com"],
};
const google = (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;

export function searchLinks(title, country, city, extraSites) {
  const where = city ? `${city}, ${country}` : country;
  const qt = encodeURIComponent(title);
  const out = [
    { site: "LinkedIn", url: `https://www.linkedin.com/jobs/search/?keywords=${qt}&location=${encodeURIComponent(where)}` },
    INDEED[country] && { site: "Indeed", url: `https://${INDEED[country]}.indeed.com/jobs?q=${qt}${city ? "&l=" + encodeURIComponent(city) : ""}` },
    { site: "Google Jobs", url: google(`${title} jobs in ${where}`) + "&ibp=htl;jobs" },
  ].filter(Boolean);
  for (const d of [...(LOCAL[country] || []), ...extraSites]) if (!out.some((o) => o.site === d)) out.push({ site: d, url: google(`${title} ${where} site:${d}`) });
  return out;
}
