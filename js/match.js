// CV ↔ job matching, ported from v1. Each entry: key, label, pattern (EN + FR), weight.
export const SKILLS = [
  ["commissioning", "commissioning", /commission|mise en service/, 3],
  ["installation", "installation", /install|erection|montage/, 3],
  ["startup", "start-up", /start[- ]?up|démarrage/, 2],
  ["field", "field service", /field (service|engineer)|site (engineer|supervis)|ingénieur terrain|service après[- ]vente/, 2],
  ["maintenance", "maintenance", /maintenanc|maintain/, 3],
  ["preventive", "preventive maintenance", /preventive|predictive|préventive|prédictive/, 2],
  ["troubleshooting", "troubleshooting", /troubleshoot|diagnos|fault[- ]find|dépannage/, 2],
  ["repair", "repair and overhaul", /repair|overhaul|réparation|révision/, 2],
  ["mechanical", "mechanical", /mechanical|mécani/, 2],
  ["rca", "root cause analysis", /root cause|\brca\b|cause racine/, 1.5],
  ["cmms", "CMMS", /cmms|maximo|gmao/, 1.5],
  ["production", "production", /production/, 3],
  ["planning", "production planning", /production planning|scheduling|planification/, 2],
  ["plant", "plant operations", /plant (manager|supervis|operations)|chef d'usine|directeur d'usine/, 2],
  ["operations", "operations", /operations|exploitation/, 1.5],
  ["lean", "Lean", /\blean\b/, 2.5],
  ["sixsigma", "Six Sigma", /six sigma|6 sigma|green belt|black belt/, 2.5],
  ["kaizen", "continuous improvement", /kaizen|continuous improvement|amélioration continue/, 2],
  ["oee", "OEE", /\boee\b|\btrs\b/, 2],
  ["quality", "quality", /quality|qualité/, 2],
  ["iso", "ISO standards", /iso ?(9001|14001|45001)/, 2],
  ["hse", "HSE and safety", /\bhse\b|\behs\b|\bqhse\b|safety|sécurité|nebosh|iosh/, 2],
  ["sap", "SAP", /\bsap\b/, 2],
  ["erp", "ERP", /\berp\b/, 1.5],
  ["plc", "PLC and automation", /\bplc\b|automate|siemens|schneider|allen[- ]bradley|automation|automatisme/, 2],
  ["scada", "SCADA", /scada|\bhmi\b|\bihm\b/, 1.5],
  ["cad", "CAD", /autocad|solidworks|catia|\bcad\b|\bdao\b/, 1.5],
  ["leadership", "team leadership", /team (lead|manag)|supervis|leadership|manag(er|ed|ing)|chef d'équipe|encadrement|responsable/, 2],
  ["training", "training", /training|train(ed|ing)\b|formation/, 1],
  ["project", "project management", /project (management|manager)|\bpmp\b|gestion de projet|chef de projet/, 2],
  ["budget", "budget and cost", /budget|cost (reduction|saving)|réduction des coûts/, 1.5],
  ["supplier", "suppliers and procurement", /supplier|vendor|procurement|fournisseur|achats/, 1],
  ["paper", "paper converting", /paper|paperboard|corrugat|converting|papier|carton|transformation du papier/, 2],
  ["packaging", "packaging", /packaging|packing|emballage|conditionnement/, 2],
  ["plastics", "plastics", /plastic|\bpet\b|polymer|injection mold|extrusion|plastique/, 2],
  ["blow", "blow molding", /blow ?mold|blowing|soufflage|souffleuse/, 2],
  ["recycling", "recycling", /recycl/, 1.5],
  ["automotive", "automotive", /automotive|\boem\b|tier[- ]?1|automobile/, 2.5],
  ["renewable", "renewable energy", /renewable|solar|wind (energy|turbine|farm)|photovoltaic|green energy|renouvelable|solaire|éolien/, 2.5],
  ["thermal", "thermal and HVAC", /thermal|hvac|heat exchanger|boiler|refrigerat|thermique|chaudière|climatisation/, 2],
  ["oilgas", "oil and gas", /\boil\b|\bgas\b|petrochem|refiner|sonatrach|aramco|\blng\b|pétrol|\bgaz\b|raffiner/, 2],
  ["rotating", "pumps and compressors", /pump|compressor|turbine|turbo|pompe|compresseur/, 2],
  ["food", "food and beverage", /food|beverage|fmcg|bottling|filling|agroalimentaire|embouteillage|remplissage/, 1.5],
  ["manufacturing", "manufacturing", /manufactur|fabrication|industrie/, 2.5],
  ["german", "German language", /german|deutsch|allemand/, 1.5],
  ["french", "French language", /french|fran[cç]ais/, 1],
  ["arabic", "Arabic language", /arabic|arabe/, 1],
  ["english", "English language", /english|anglais/, 0.5],
];

const TITLE_RULES = [
  [["commissioning", "installation"], ["Commissioning Engineer", "Installation Engineer", "Field Service Engineer"]],
  [["maintenance"], ["Maintenance Engineer", "Mechanical Maintenance Engineer"]],
  [["production"], ["Production Engineer", "Production Manager", "Plant Supervisor"]],
  [["lean", "sixsigma", "kaizen"], ["Continuous Improvement Engineer"]],
  [["paper", "packaging"], ["Packaging Machine Engineer", "Converting Line Engineer"]],
  [["renewable"], ["Renewable Energy Engineer"]],
  [["automotive"], ["Manufacturing Engineer Automotive"]],
  [["sap", "planning"], ["Production Planner"]],
];
export const DEFAULT_TITLES = ["Production Engineer", "Maintenance Engineer", "Commissioning Engineer", "Field Service Engineer", "Production Manager", "Plant Supervisor"];

const STOP = new Set(("with from that this have will your their they them were been into over also than then such more most some other about which would could should being these those there where when what while within without across must able including etc and the for are our you not but all any can per via new use used using work works working job role team years year experience required requirements responsibilities skills ability strong good well plus based company candidate position " +
  "avec dans pour vous nous sont être avoir plus tout tous toute toutes votre notre leur leurs elle ils une des les par sur aux ces cette entre sans sous chez poste profil mission missions années expérience requis compétences entreprise candidat").split(" "));

const WORD_RE = /\p{L}[\p{L}\-]{3,}/gu;
const YEARS_RE = /(\d{1,2})\+?\s*(?:years|yrs|ans)/g;

function maxYears(l) {
  let y = 0;
  for (const m of l.matchAll(YEARS_RE)) { const n = parseInt(m[1], 10); if (n > y && n < 45) y = n; }
  return y;
}

export function analyze(text) {
  const l = (text || "").toLowerCase();
  if (!l.trim()) return null;
  const keys = new Set(SKILLS.filter((s) => s[2].test(l)).map((s) => s[0]));
  const freq = {};
  for (const w of l.match(WORD_RE) || []) if (!STOP.has(w)) freq[w] = (freq[w] || 0) + 1;
  const top = new Set(Object.keys(freq).sort((a, b) => freq[b] - freq[a]).slice(0, 90));
  const titles = [];
  for (const [ks, ts] of TITLE_RULES) if (ks.some((k) => keys.has(k))) for (const x of ts) if (!titles.includes(x)) titles.push(x);
  return { keys, top, years: maxYears(l), titles, words: (l.match(/\S+/g) || []).length };
}

// Returns null when no CV is loaded.
export function score(an, title, text, extra) {
  if (!an) return null;
  const tl = (title || "").toLowerCase();
  const body = `${title || ""} ${title || ""} ${extra || ""} ${text || ""}`.toLowerCase();
  let jw = 0, mw = 0;
  const matched = [], missing = [];
  for (const [k, label, re, w0] of SKILLS) {
    if (!re.test(body)) continue;
    const w = w0 * (re.test(tl) ? 1.5 : 1);
    jw += w;
    if (an.keys.has(k)) { mw += w; matched.push([label, w]); } else missing.push([label, w]);
  }
  const toks = new Set((body.match(WORD_RE) || []).filter((w) => !STOP.has(w)));
  let hit = 0;
  toks.forEach((w) => { if (an.top.has(w)) hit++; });
  const ov = Math.min(1, hit / Math.max(8, Math.min(toks.size, 30)));
  let s = jw > 0 ? 100 * (0.7 * (mw / jw) + 0.3 * ov) : 80 * ov;
  const flags = [];
  const jy = maxYears(body);
  if (jy && an.years && jy > an.years + 1) { s -= Math.min(20, (jy - an.years) * 4); flags.push({ years: jy, cv: an.years }); }
  const words = `${text || ""} ${extra || ""}`.split(/\s+/).filter(Boolean).length;
  const byW = (a, b) => b[1] - a[1];
  return {
    score: Math.max(0, Math.min(100, Math.round(s))),
    matched: matched.sort(byW).map((x) => x[0]),
    missing: missing.sort(byW).filter((x) => x[1] >= 1.5).map((x) => x[0]),
    flags,
    low: words < 20 && !jw ? true : words < 12,
  };
}

export function skillLabels(an) { return an ? SKILLS.filter((s) => an.keys.has(s[0])).map((s) => s[1]) : []; }
export function skillKeys(text) { const l = (text || "").toLowerCase(); return new Set(SKILLS.filter((s) => s[2].test(l)).map((s) => s[0])); }
