// Structured CV profile. Filled from the CV text by simple rules (user reviews it), or by AI.

export const emptyProfile = () => ({
  name: "", headline: "", location: "", phone: "", email: "", linkedin: "",
  nationality: "", availability: "", licence: "",
  summary: "", skills: [], achievements: [],
  experience: [], // { role, org, place, dates, bullets: [] }
  education: [], training: [], languages: [], interests: [],
});

export const hasProfile = (p) => !!(p && p.name && (p.experience.length || p.summary));

const HEADINGS = [
  ["summary", /^(professional\s+)?(summary|profile|about me|objective)$|^profil( professionnel)?$|^résumé$/i],
  ["achievements", /^(key\s+)?achievements$|^réalisations( clés)?$/i],
  ["skills", /^(core\s+|key\s+|technical\s+)?skills$|^compétences( clés| techniques)?$/i],
  ["experience", /^(professional\s+|work\s+)?experience$|^work history$|^employment$|^expérience(s)?( professionnelle(s)?)?$|^parcours professionnel$/i],
  ["education", /^education$|^formation$|^diplômes$|^education and training$/i],
  ["training", /^(industrial\s+)?training$|^certifications?$|^stages?( industriels)?$|^internships?$/i],
  ["languages", /^languages$|^langues$/i],
  ["interests", /^interests$|^hobbies$|^centres d'intérêt$|^loisirs$/i],
];
const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|janv|févr|fevr|mars|avr|mai|juin|juil|août|aout|déc)[a-zéû]*\\.?";
export const DATE_RANGE = new RegExp(`(?:${MONTH}\\s*)?\\d{4}\\s*(?:-|–|—|to|à)\\s*(?:(?:${MONTH}\\s*)?\\d{4}|present|présent|current|now|aujourd'hui|today)`, "i");

const clean = (l) => l.replace(/^#{1,6}\s*/, "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
const bullet = (l) => /^[-•*▪◦·]\s*/.test(l);
const unbullet = (l) => l.replace(/^[-•*▪◦·]\s*/, "").trim();
const splitList = (s) => s.split(/\s*[,;|]\s*|\s+·\s+/).map((x) => x.trim()).filter(Boolean);

export function profileFromText(text) {
  const p = emptyProfile();
  const lines = (text || "").split(/\r?\n/).map(clean).filter(Boolean);
  const sections = { head: [] };
  let cur = "head";
  for (const l of lines) {
    const h = l.length <= 40 && HEADINGS.find(([, re]) => re.test(l.replace(/[:：]$/, "")));
    if (h) { cur = h[0]; sections[cur] = sections[cur] || []; continue; }
    (sections[cur] = sections[cur] || []).push(l);
  }
  const all = lines.join("\n");
  p.email = (all.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [""])[0];
  p.linkedin = (all.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[\w-]+/i) || [""])[0];
  p.phone = ((sections.head.join("\n").match(/\+?\d[\d\s().-]{7,}\d/) || all.match(/\+?\d[\d\s().-]{7,}\d/)) || [""])[0].trim();
  const field = (re) => { const m = all.match(re); return m ? m[1].split("|")[0].trim() : ""; };
  p.nationality = field(/(?:nationality|nationalité)\s*:\s*([^\n|]+)/i);
  p.availability = field(/(?:availability|disponibilité)\s*:\s*([^\n|]+)/i);
  p.licence = field(/(?:driving licen[cs]e|permis(?: de conduire)?)\s*:\s*([^\n|]+)/i);

  const head = sections.head;
  const nameLine = head.find((l) => l.split(" ").length <= 5 && !/\d|@|\|/.test(l));
  p.name = nameLine || "";
  const after = head.slice(head.indexOf(nameLine) + 1);
  p.headline = (after.find((l) => !/@|\d{4,}|:/.test(l) && l.length < 140) || "");
  const contact = head.find((l) => l.includes("@") && l.includes("|"));
  if (contact) { const first = contact.split("|")[0].trim(); if (!/@|\d{5,}/.test(first)) p.location = first; }

  p.summary = (sections.summary || []).join(" ");
  p.achievements = (sections.achievements || []).map(unbullet);
  p.skills = [...new Set((sections.skills || []).flatMap((l) => splitList(unbullet(l).replace(/^[^:,]{2,40}:\s*/, ""))))];
  p.experience = parseExperience(sections.experience || []);
  p.education = (sections.education || []).map(unbullet);
  p.training = (sections.training || []).map(unbullet);
  p.languages = (sections.languages || []).flatMap((l) => splitList(unbullet(l)));
  p.interests = (sections.interests || []).flatMap((l) => splitList(unbullet(l)));
  return p;
}

function splitRoleOrg(s) {
  const m = s.match(/^(.+?)\s*(?:,|\bat\b|\bchez\b| - | – )\s*(.+)$/i);
  return m ? { role: m[1].trim(), org: m[2].trim() } : { role: s.trim(), org: "" };
}

export function parseExperience(lines) {
  const out = [];
  let e = null;
  const prevLine = (i) => {
    if (i === 0) return "";
    const pl = lines[i - 1];
    if (bullet(pl)) return "";
    if (e) { if (e.bullets[e.bullets.length - 1] === unbullet(pl)) return e.bullets.pop(); return ""; }
    return pl;
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], dm = !bullet(l) && l.match(DATE_RANGE);
    if (!dm) { if (e) e.bullets.push(unbullet(l)); continue; }
    const dates = dm[0].trim(), parts = l.split(/\s*\|\s*/).filter(Boolean);
    let n;
    if (parts.length > 1) {
      const rest = parts.filter((x) => !DATE_RANGE.test(x));
      if (rest.length >= 3) n = { role: rest[0], org: rest[1], place: rest[2] };
      else if (rest.length === 2) n = /,/.test(rest[1]) ? { ...splitRoleOrg(rest[0]), place: rest[1] } : { role: rest[0], org: rest[1], place: "" };
      else n = { ...splitRoleOrg(prevLine(i)), place: rest[0] || "" };
    } else {
      const txt = l.replace(dm[0], "").replace(/^[\s,–—(-]+|[\s,–—(-]+$/g, "").replace(/\(\s*\)$/, "").trim();
      n = txt.length > 3 ? { ...splitRoleOrg(txt), place: "" } : { ...splitRoleOrg(prevLine(i)), place: "" };
    }
    e = { ...n, dates, bullets: [] };
    out.push(e);
  }
  return out.filter((x) => x.role || x.bullets.length);
}

// Keep lists tidy when saving from the form.
export function normalizeProfile(p) {
  const n = { ...emptyProfile(), ...p };
  for (const k of ["skills", "achievements", "education", "training", "languages", "interests"]) n[k] = (n[k] || []).map((x) => String(x).trim()).filter(Boolean);
  n.experience = (n.experience || []).map((e) => ({ role: e.role || "", org: e.org || "", place: e.place || "", dates: e.dates || "", bullets: (e.bullets || []).map((b) => String(b).trim()).filter(Boolean) })).filter((e) => e.role || e.bullets.length);
  return n;
}
