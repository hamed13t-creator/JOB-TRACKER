// Pulls title, company, location, salary, link and a category guess out of pasted or shared ad text.
import { skillKeys } from "./match.js";

const PLACES = {
  "Saudi Arabia": ["saudi arabia", "ksa", "arabie saoudite", "riyadh", "riyad", "jeddah", "djeddah", "dammam", "khobar", "jubail", "yanbu", "neom", "mecca", "makkah", "medina", "madinah", "tabuk", "abha", "qassim", "dhahran"],
  Oman: ["oman", "muscat", "mascate", "sohar", "salalah", "duqm", "nizwa"],
  Qatar: ["qatar", "doha", "ras laffan", "mesaieed", "al wakrah", "lusail"],
  UAE: ["united arab emirates", "uae", "émirats", "emirates", "dubai", "dubaï", "abu dhabi", "abou dabi", "sharjah", "ajman", "ras al khaimah", "fujairah", "jebel ali", "al ain"],
  Kuwait: ["kuwait", "koweït", "ahmadi"],
  Bahrain: ["bahrain", "bahreïn", "manama"],
  Germany: ["germany", "deutschland", "allemagne", "berlin", "munich", "münchen", "hamburg", "stuttgart", "frankfurt", "cologne", "köln", "düsseldorf", "dresden", "leipzig", "hannover", "nuremberg", "nürnberg", "bremen", "essen", "dortmund"],
  Austria: ["austria", "österreich", "autriche", "vienna", "wien", "vienne", "linz", "graz", "salzburg", "innsbruck"],
  Canada: ["canada", "toronto", "montreal", "montréal", "calgary", "vancouver", "edmonton", "ottawa", "winnipeg", "quebec", "québec", "halifax", "ontario", "alberta"],
};
const COUNTRY_WORDS = new Set(["saudi arabia", "ksa", "arabie saoudite", "oman", "qatar", "united arab emirates", "uae", "émirats", "emirates", "kuwait", "koweït", "bahrain", "bahreïn", "germany", "deutschland", "allemagne", "austria", "österreich", "autriche", "canada", "ontario", "alberta"]);

const CAT_RULES = [
  [["commissioning", "installation", "startup"], "Installation and commissioning"],
  [["field"], "Field and service engineering"],
  [["maintenance", "repair", "troubleshooting"], "Maintenance"],
  [["automotive"], "Automotive"],
  [["renewable"], "Renewable energy"],
  [["oilgas"], "Oil, gas and energy"],
  [["paper", "packaging"], "Paper and packaging"],
  [["plastics", "blow", "recycling"], "Plastics and recycling"],
  [["lean", "sixsigma", "kaizen", "quality"], "Quality and Lean"],
  [["project"], "Project engineering"],
  [["production", "manufacturing", "plant"], "Production and operations"],
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function findPlace(text) {
  const l = text.toLowerCase();
  let best = null;
  for (const [country, words] of Object.entries(PLACES)) {
    for (const w of words) {
      const m = new RegExp(`(^|[^\\p{L}])${esc(w)}($|[^\\p{L}])`, "u").exec(l);
      if (m && (!best || m.index < best.index)) best = { country, index: m.index, city: COUNTRY_WORDS.has(w) ? "" : w };
    }
  }
  if (!best) return { country: "", city: "" };
  const city = best.city ? best.city.replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase()) : "";
  return { country: best.country, city };
}

const CUR = "(?:SAR|SR|AED|QAR|QR|OMR|RO|KWD|KD|BHD|BD|EUR|€|CAD|C\\$|USD|US\\$|\\$)";
const NUM = "\\d[\\d,.\\s]*\\d(?:\\s?[kK])?|\\d(?:\\s?[kK])?";
const SAL_RE = new RegExp(`(${CUR}\\s?(?:${NUM})(?:\\s?(?:-|–|to|à)\\s?(?:${CUR}\\s?)?(?:${NUM}))?|(?:${NUM})(?:\\s?(?:-|–|to|à)\\s?(?:${NUM}))?\\s?${CUR})(?:\\s?(?:/|per|par)\\s?(?:month|mois|year|an|annum|hour|heure|h))?`, "i");

export function parseAd(raw, shared = {}) {
  const full = [raw, shared.title, shared.text, shared.url].filter(Boolean).join("\n").trim();
  const urlM = (shared.url || "").match(/https?:\/\/\S+/) || full.match(/https?:\/\/[^\s)"'<>]+/);
  const lines = full.split(/\n+/).map((s) => s.trim()).filter((s) => s && !/^https?:\/\//.test(s));
  let title = (shared.title || "").trim(), company = "", city = "";

  // LinkedIn share: "Company is hiring Title in City" / "Company recrute : Title à City"
  const hiring = full.match(/^(.+?) (?:is hiring|recrute)\s*:?\s*(?:an? |un |une )?([^\n.!]+?)(?: (?:in|à|en) ([^\n.!]+?))?\s*(?:[.!]|\n|$)/im);
  if (hiring) { company = hiring[1].trim(); title = hiring[2].trim(); city = (hiring[3] || "").trim(); }

  if (!title) title = lines.find((l) => l.length <= 90 && /\p{L}{3}/u.test(l)) || "";
  // "Title at Company", "Title - Company", "Title | Company"
  const split = title.match(/^(.+?)\s+(?:at|chez|@|-|–|\|)\s+(.+)$/i);
  if (split && !company) { title = split[1].trim(); company = split[2].replace(/\s*[-|–].*$/, "").trim(); }
  if (!company) { const m = full.match(/(?:company|employer|entreprise|société|employeur)\s*[:\-–]\s*([^\n]{2,60})/i); if (m) company = m[1].trim(); }

  const place = findPlace(full);
  const sal = full.match(SAL_RE);
  const keys = skillKeys(`${title}\n${full}`);
  const cat = (CAT_RULES.find(([ks]) => ks.some((k) => keys.has(k))) || [, ""])[1];
  return {
    title: title.slice(0, 140),
    company: company.slice(0, 80),
    country: place.country,
    city: city || place.city,
    salary: sal ? sal[0].trim().replace(/\s+/g, " ") : "",
    link: urlM ? urlM[0].replace(/[.,;]+$/, "") : "",
    category: cat,
    desc: full,
  };
}
