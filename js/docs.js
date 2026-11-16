// Builds a tailored CV and a cover-letter draft from the user's own profile. Never adds facts:
// tailoring only reorders the user's skills and bullet points and states the target role.
import { analyze, skillKeys } from "./match.js";
import { makeDocx } from "./docx.js";

const GULF = ["Saudi Arabia", "Oman", "Qatar", "UAE", "Kuwait", "Bahrain"];
export const TEMPLATES = ["gulf", "europe", "canada"];
export const templateFor = (country) => (GULF.includes(country) ? "gulf" : country === "Canada" ? "canada" : "europe");

const H = {
  en: { summary: "Professional Summary", achievements: "Key Achievements", skills: "Core Skills", experience: "Professional Experience", education: "Education", training: "Industrial Training", languages: "Languages", interests: "Interests",
    nationality: "Nationality", availability: "Availability", licence: "Driving licence", relocate: (c) => `Open to relocation to ${c}`, seeking: (t, c) => `Seeking ${t} roles${c ? " in " + c : ""}.` },
  fr: { summary: "Profil professionnel", achievements: "Réalisations clés", skills: "Compétences clés", experience: "Expérience professionnelle", education: "Formation", training: "Stages industriels", languages: "Langues", interests: "Centres d'intérêt",
    nationality: "Nationalité", availability: "Disponibilité", licence: "Permis de conduire", relocate: (c) => `Mobilité : ${c}`, seeking: (t, c) => `Je recherche un poste de ${t}${c ? " (" + c + ")" : ""}.` },
};
const COUNTRY_FR = { "Saudi Arabia": "Arabie saoudite", UAE: "Émirats arabes unis", Kuwait: "Koweït", Bahrain: "Bahreïn", Germany: "Allemagne", Austria: "Autriche" };
const cName = (c, lang) => (lang === "fr" ? COUNTRY_FR[c] || c : c);

function relevance(job) {
  const text = `${job?.title || ""} ${job?.title || ""} ${job?.desc || ""}`;
  if (!text.trim()) return () => 0;
  const keys = skillKeys(text), top = analyze(text)?.top || new Set();
  return (s) => {
    let r = 0; skillKeys(s).forEach((k) => keys.has(k) && (r += 3));
    for (const w of (s.toLowerCase().match(/\p{L}[\p{L}\-]{3,}/gu) || [])) if (top.has(w)) r += 1;
    return r;
  };
}
const byRel = (list, rel) => list.map((v, i) => ({ v, i, r: rel(v) })).sort((a, b) => b.r - a.r || a.i - b.i).map((x) => x.v);
const OBJECTIVE = /(^|(?<=[.!?]\s))(seeking|looking for|open to|je recherche|à la recherche|recherche)[^.!?]*[.!?]?/i;

// opts: { template, lang, relevantFirst, objective }
export function buildCv(p, job, opts) {
  const L = H[opts.lang] || H.en, tpl = opts.template, rel = relevance(job);
  const country = job?.country && job.country !== "Other" ? cName(job.country, opts.lang) : "";
  let summary = p.summary || "";
  if (opts.objective && job?.title) {
    const s = L.seeking(job.title, country);
    summary = OBJECTIVE.test(summary) ? summary.replace(OBJECTIVE, (m, pre) => `${pre}${s}`) : `${summary} ${s}`.trim();
  }
  const order = (list) => (opts.relevantFirst && job ? byRel(list, rel) : list);
  const extra = [];
  if (tpl === "gulf" && p.nationality) extra.push(`${L.nationality}: ${p.nationality}`);
  if (p.availability) extra.push(`${L.availability}: ${p.availability}`);
  if (tpl !== "canada" && p.licence) extra.push(`${L.licence}: ${p.licence}`);
  if (tpl === "gulf" && country) extra.push(L.relocate(country));
  const sections = [];
  if (summary) sections.push({ key: "summary", title: L.summary, text: summary });
  if (p.achievements.length) sections.push({ key: "achievements", title: L.achievements, items: order(p.achievements) });
  if (p.skills.length) sections.push({ key: "skills", title: L.skills, text: order(p.skills).join(", ") });
  if (p.experience.length) sections.push({ key: "experience", title: L.experience, entries: p.experience.map((e) => ({ ...e, bullets: order(e.bullets) })) });
  if (p.education.length) sections.push({ key: "education", title: L.education, items: p.education });
  if (p.training.length) sections.push({ key: "training", title: L.training, items: p.training });
  if (p.languages.length) sections.push({ key: "languages", title: L.languages, text: p.languages.join(", ") });
  if (p.interests.length && tpl !== "canada") sections.push({ key: "interests", title: L.interests, text: p.interests.join(", ") });
  return {
    name: p.name, headline: p.headline,
    contact: [p.location, p.phone, p.email, p.linkedin].filter(Boolean).join(" | "),
    extra: extra.join(" | "), sections, lang: opts.lang,
  };
}

const e = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export function cvHtml(m) {
  const sec = (s) => `<section><h2>${e(s.title)}</h2>${s.text ? `<p>${e(s.text)}</p>` : ""}${s.items ? `<ul>${s.items.map((i) => `<li>${e(i)}</li>`).join("")}</ul>` : ""}${s.entries ? s.entries.map((x) => `<div class="entry"><div class="et"><b>${e([x.role, x.org].filter(Boolean).join(", "))}</b><span>${e(x.dates)}</span></div>${x.place ? `<div class="es">${e(x.place)}</div>` : ""}<ul>${x.bullets.map((b) => `<li>${e(b)}</li>`).join("")}</ul></div>`).join("") : ""}</section>`;
  return `<article class="paper" lang="${e(m.lang)}"><h1>${e(m.name)}</h1>${m.headline ? `<p class="hl">${e(m.headline)}</p>` : ""}<p class="ct">${e(m.contact)}</p>${m.extra ? `<p class="ct">${e(m.extra)}</p>` : ""}${m.sections.map(sec).join("")}</article>`;
}

export function cvText(m) {
  return [m.name, m.headline, m.contact, m.extra, ...m.sections.flatMap((s) => ["", s.title.toUpperCase(), s.text || "", ...(s.items || []).map((i) => "- " + i),
    ...(s.entries || []).flatMap((x) => [[x.role, x.org].filter(Boolean).join(", ") + " | " + [x.place, x.dates].filter(Boolean).join(" | "), ...x.bullets.map((b) => "- " + b)])])].filter((l) => l !== undefined).join("\n").replace(/\n{3,}/g, "\n\n");
}

export function cvDocx(m) {
  const P = [{ style: "Title", text: m.name }];
  if (m.headline) P.push({ style: "Subtitle", text: m.headline });
  P.push({ style: "Contact", text: m.contact });
  if (m.extra) P.push({ style: "Contact", text: m.extra });
  for (const s of m.sections) {
    P.push({ style: "Heading1", text: s.title });
    if (s.text) P.push({ text: s.text });
    (s.items || []).forEach((i) => P.push({ style: "Bullet", text: i }));
    (s.entries || []).forEach((x) => {
      P.push({ style: "Entry", text: [x.role, x.org].filter(Boolean).join(", "), right: x.dates });
      if (x.place) P.push({ style: "EntrySub", text: x.place });
      x.bullets.forEach((b) => P.push({ style: "Bullet", text: b }));
    });
  }
  return makeDocx(P, { title: `${m.name} CV`, author: m.name, lang: m.lang === "fr" ? "fr-FR" : "en-GB" });
}

// ---------- cover letter (draft from the user's own bullets) ----------
const LT = {
  en: { dear: "Dear Hiring Manager,", subj: (t) => `Application for ${t}`, open: (t, co, where) => `I am writing to apply for the ${t} position${co ? ` at ${co}` : ""}${where ? ` in ${where}` : ""}.`,
    bring: "Relevant to this role:", as: (r, o) => `as ${r}${o ? " at " + o : ""}`, bg: "My background: ", avail: (a) => `My availability: ${a}.`, reloc: "I am open to relocation.", close: "I would welcome the opportunity to discuss how my experience can support your team. Thank you for your time and consideration.", sign: "Yours sincerely," },
  fr: { dear: "Madame, Monsieur,", subj: (t) => `Candidature au poste de ${t}`, open: (t, co, where) => `Je vous adresse ma candidature au poste de ${t}${co ? ` chez ${co}` : ""}${where ? ` (${where})` : ""}.`,
    bring: "En lien avec ce poste :", as: (r, o) => `en tant que ${r}${o ? " chez " + o : ""}`, bg: "Mon parcours : ", avail: (a) => `Disponibilité : ${a}.`, reloc: "Je suis prêt à m'installer à l'étranger.", close: "Je serais heureux d'échanger avec vous sur la manière dont mon expérience peut contribuer à votre équipe. Je vous prie d'agréer, Madame, Monsieur, mes salutations distinguées.", sign: "" },
};

export function buildLetter(p, job, lang) {
  const L = LT[lang] || LT.en, rel = relevance(job);
  const where = [job?.city, job?.country && job.country !== "Other" ? cName(job.country, lang) : ""].filter(Boolean).join(", ");
  const firstSentence = (p.summary.match(/^[^.!?]+[.!?]/) || [""])[0];
  const pool = p.experience.flatMap((x) => x.bullets.map((b) => ({ b, src: L.as(x.role, x.org), r: rel(b) })));
  const bg = !firstSentence || /^(I|Je|J')\b/.test(firstSentence) ? firstSentence : L.bg + firstSentence[0].toLowerCase() + firstSentence.slice(1);
  const picks = pool.filter((x) => x.r > 0).sort((a, b) => b.r - a.r).slice(0, 3);
  const date = new Date().toLocaleDateString(lang === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "long", year: "numeric" });
  return [
    p.name, [p.location, p.phone, p.email].filter(Boolean).join(" | "), "", date, "",
    job?.company || "", where, "", L.subj(job?.title || ""), "", L.dear, "",
    `${L.open(job?.title || "", job?.company, where)} ${bg}`.trim(), "",
    ...(picks.length ? [L.bring, ...picks.map((x) => `- ${x.b.replace(/\.$/, "")}, ${x.src}`), ""] : []),
    [p.availability ? L.avail(p.availability) : "", L.reloc].filter(Boolean).join(" "), "",
    L.close, "", L.sign, p.name,
  ].filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n").trim();
}

export function letterDocx(text, name, lang) {
  const P = text.split("\n").map((l) => (/^[-•]\s/.test(l) ? { style: "Bullet", text: l.replace(/^[-•]\s/, "") } : { text: l }));
  if (P[0]) P[0] = { style: "Entry", text: P[0].text };
  return makeDocx(P, { title: `${name} cover letter`, author: name, lang: lang === "fr" ? "fr-FR" : "en-GB" });
}
export function letterHtml(text) {
  return `<article class="paper letter">${text.split("\n").map((l) => (l ? `<p>${e(l)}</p>` : "<br>")).join("")}</article>`;
}
