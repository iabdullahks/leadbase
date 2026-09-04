// Proxy all scraper service calls from Next.js → Flask (port 5001)
const SCRAPER_BASE = process.env.SCRAPER_SERVICE_URL || 'http://localhost:5001';

export async function proxyToScraper(path: string, init?: RequestInit) {
  const url = `${SCRAPER_BASE}${path}`;
  const res = await fetch(url, { ...init, cache: 'no-store' });
  const data = await res.json();
  return { data, status: res.status };
}
