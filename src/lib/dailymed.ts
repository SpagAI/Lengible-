import "server-only";

// NIH DailyMed (US National Library of Medicine) publishes official drug labels with their images.
// https://dailymed.nlm.nih.gov/dailymed/app-support-web-services.cfm
const BASE = process.env.DAILYMED_BASE_URL || "https://dailymed.nlm.nih.gov/dailymed";

export type OfficialImage = { url: string; name: string; title: string; sourceUrl: string };

async function getJSON<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

// Search names to try: the full name, then the first part of a combination ("Artemether–lumefantrine" → "artemether").
export function searchTerms(drugName: string) {
  const base = drugName.replace(/\(.*?\)/g, "").trim();
  const first = base.split(/[\/–—+,]| with /i)[0].trim();
  return [...new Set([base, first].filter((t) => t.length > 2))];
}

export async function findOfficialImages(drugName: string, limit = 12): Promise<OfficialImage[] | null> {
  let reachable = false;
  const out: OfficialImage[] = [];
  for (const term of searchTerms(drugName)) {
    const list = await getJSON<{ data: { setid: string; title: string }[] }>(
      `${BASE}/services/v2/spls.json?drug_name=${encodeURIComponent(term)}&pagesize=6`,
    );
    if (!list) continue;
    reachable = true;
    for (const spl of list.data.slice(0, 6)) {
      const media = await getJSON<{ data: { media: { name: string; mime_type: string; url: string }[] } }>(
        `${BASE}/services/v2/spls/${spl.setid}/media.json`,
      );
      for (const m of media?.data.media ?? []) {
        if (!/image\/(jpe?g|png)/.test(m.mime_type) || out.some((o) => o.url === m.url)) continue;
        out.push({ url: m.url, name: m.name, title: spl.title, sourceUrl: `${BASE}/drugInfo.cfm?setid=${spl.setid}` });
        if (out.length >= limit) return out;
      }
    }
    if (out.length) break;
  }
  return reachable ? out : null;
}
