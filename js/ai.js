// Optional AI features. The user's own Anthropic API key is stored on this device only and sent only to api.anthropic.com.
export const DEFAULT_MODEL = "claude-sonnet-5-5";

export async function callClaude({ key, model, system, prompt, maxTokens = 1500 }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
    body: JSON.stringify({ model: model || DEFAULT_MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: prompt }] }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}

const NO_INVENT = "Use only facts present in the candidate's CV or profile. Never invent employers, dates, numbers, degrees, certifications, tools or achievements. If something the job asks for is not in the CV, leave it out.";
const lang = (l) => (l === "fr" ? "French" : "English");

export async function aiProfile(cfg, cvText) {
  const out = await callClaude({ ...cfg, maxTokens: 4000,
    system: `You convert a CV into JSON. ${NO_INVENT} Copy wording as written. Reply with JSON only, no code fences.`,
    prompt: `Return one JSON object with keys: name, headline, location, phone, email, linkedin, nationality, availability, licence, summary (string), skills (string[]), achievements (string[]), experience ([{role, org, place, dates, bullets: string[]}], most recent first), education (string[]), training (string[]), languages (string[]), interests (string[]). Use "" or [] when absent.\n\nCV:\n${cvText}` });
  return JSON.parse(out.replace(/^```(?:json)?\s*|\s*```$/g, ""));
}

export function aiSummary(cfg, profile, job, l) {
  return callClaude({ ...cfg, maxTokens: 600,
    system: `You are a careful CV editor. ${NO_INVENT} Reply with the summary text only.`,
    prompt: `Rewrite this professional summary in ${lang(l)} for the job below: 3 to 4 sentences, plain and factual, no buzzwords, end with the role sought.\n\nCurrent summary:\n${profile.summary}\n\nCandidate profile (JSON):\n${JSON.stringify(profile)}\n\nJob title: ${job.title}\nCompany: ${job.company || "-"}\nCountry: ${job.country || "-"}\nJob ad:\n${(job.desc || "").slice(0, 6000)}` });
}

export function aiLetter(cfg, profile, job, draft, l) {
  return callClaude({ ...cfg, maxTokens: 1200,
    system: `You write concise, specific cover letters. ${NO_INVENT} Plain text only, no markdown.`,
    prompt: `Improve this cover letter draft in ${lang(l)}: under 300 words, keep the sender block, date, subject, greeting and sign-off, connect the candidate's real experience to the job's main requirements, no clichés.\n\nDraft:\n${draft}\n\nCandidate profile (JSON):\n${JSON.stringify(profile)}\n\nJob title: ${job.title}\nCompany: ${job.company || "-"}\nJob ad:\n${(job.desc || "").slice(0, 6000)}` });
}
