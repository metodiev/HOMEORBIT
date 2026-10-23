import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ValidationError } from "@/lib/errors";

export type SearchResult = { title: string; url: string; snippet: string };
export type SearchResponse = {
  configured: boolean;
  provider: "searxng" | "brave" | "none";
  results: SearchResult[];
  note: string;
};

export type PageContent = {
  url: string;
  title: string;
  text: string;
  truncated: boolean;
  untrusted: true;
};

const MAX_PAGE_BYTES = 1_000_000;
const MAX_TEXT_CHARS = 12_000;
const FETCH_TIMEOUT_MS = 15_000;

function searxngBase(): string | null {
  const value = process.env.SEARXNG_URL?.trim();
  return value ? value.replace(/\/+$/, "") : null;
}

function braveKey(): string | null {
  return process.env.BRAVE_SEARCH_API_KEY?.trim() || null;
}

export function searchConfigured(): boolean {
  return Boolean(searxngBase() || braveKey());
}

export function searchProviderName(): "searxng" | "brave" | "none" {
  if (searxngBase()) return "searxng";
  if (braveKey()) return "brave";
  return "none";
}

function cleanSnippet(value: string | undefined): string {
  return (value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
}

export async function webSearch(query: string, limit = 5): Promise<SearchResponse> {
  const trimmed = query.trim();
  if (!trimmed) throw new ValidationError("Enter something to search for.");
  if (trimmed.length > 400) throw new ValidationError("Search queries are limited to 400 characters.");
  const base = searxngBase();
  if (base) {
    try {
      const url = new URL(`${base}/search`);
      url.searchParams.set("q", trimmed);
      url.searchParams.set("format", "json");
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`SearXNG returned ${response.status}.`);
      const payload = (await response.json()) as { results?: { title?: string; url?: string; content?: string }[] };
      return {
        configured: true,
        provider: "searxng",
        results: (payload.results ?? []).slice(0, limit).map((entry) => ({
          title: cleanSnippet(entry.title) || entry.url || "Untitled",
          url: entry.url ?? "",
          snippet: cleanSnippet(entry.content),
        })).filter((entry) => entry.url.startsWith("http")),
        note: "Results from the household SearXNG instance. Snippets are untrusted web content.",
      };
    } catch (error) {
      return {
        configured: true,
        provider: "searxng",
        results: [],
        note: `SearXNG could not be reached: ${error instanceof Error ? error.message : "unknown error"}`,
      };
    }
  }
  const key = braveKey();
  if (key) {
    try {
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", trimmed);
      url.searchParams.set("count", String(Math.min(10, limit)));
      const response = await fetch(url, {
        headers: { Accept: "application/json", "X-Subscription-Token": key },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Brave Search returned ${response.status}.`);
      const payload = (await response.json()) as {
        web?: { results?: { title?: string; url?: string; description?: string }[] };
      };
      return {
        configured: true,
        provider: "brave",
        results: (payload.web?.results ?? []).slice(0, limit).map((entry) => ({
          title: cleanSnippet(entry.title) || entry.url || "Untitled",
          url: entry.url ?? "",
          snippet: cleanSnippet(entry.description),
        })).filter((entry) => entry.url.startsWith("http")),
        note: "Results from Brave Search (external service). Snippets are untrusted web content.",
      };
    } catch (error) {
      return {
        configured: true,
        provider: "brave",
        results: [],
        note: `Brave Search could not be reached: ${error instanceof Error ? error.message : "unknown error"}`,
      };
    }
  }
  return {
    configured: false,
    provider: "none",
    results: [],
    note: "Web search is not configured. Ask the household administrator to set SEARXNG_URL or BRAVE_SEARCH_API_KEY.",
  };
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) return isPrivateIpv4(address);
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fe80") || normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("::ffff:")) return isPrivateIpv4(normalized.slice(7));
  return false;
}

async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError("That is not a valid web address.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ValidationError("Only http and https web pages can be fetched.");
  }
  if (url.username || url.password) throw new ValidationError("Web addresses with embedded credentials are blocked.");
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new ValidationError("Local and private network addresses cannot be fetched.");
  }
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new ValidationError("Local and private network addresses cannot be fetched.");
  } else {
    const addresses = await lookup(hostname, { all: true, verbatim: true }).catch(() => []);
    if (addresses.length === 0) throw new ValidationError("That hostname could not be resolved.");
    if (addresses.some((entry) => isPrivateAddress(entry.address))) {
      throw new ValidationError("Local and private network addresses cannot be fetched.");
    }
  }
  const blockedPorts = new Set(["22", "23", "25", "3306", "5432", "6379", "8188", "11434", "11211", "27017"]);
  if (blockedPorts.has(url.port)) throw new ValidationError("That network port is blocked for web fetching.");
  return url;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

export function htmlToText(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]).replace(/\s+/g, " ").trim() : "";
  const text = decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title: title.slice(0, 300), text };
}

export async function fetchWebPage(rawUrl: string): Promise<PageContent> {
  let url = await assertPublicUrl(rawUrl.trim());
  let response: Response | null = null;
  for (let redirect = 0; redirect < 4; redirect += 1) {
    response = await fetch(url, {
      redirect: "manual",
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
        "User-Agent": "HomeOrbit/1.0 (private family assistant; +self-hosted)",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) break;
      url = await assertPublicUrl(new URL(location, url).toString());
      continue;
    }
    break;
  }
  if (!response) throw new ValidationError("The page could not be fetched.");
  if (!response.ok) throw new ValidationError(`The page returned HTTP ${response.status}.`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!/text\/html|application\/xhtml\+xml|text\/plain/i.test(contentType)) {
    throw new ValidationError("Only text web pages can be fetched.");
  }
  const lengthHeader = Number(response.headers.get("content-length") ?? "0");
  if (lengthHeader > MAX_PAGE_BYTES) throw new ValidationError("That page is too large to fetch.");
  const reader = response.body?.getReader();
  if (!reader) throw new ValidationError("The page returned no content.");
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      received += value.byteLength;
      if (received > MAX_PAGE_BYTES) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
  }
  const html = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
  const { title, text } = htmlToText(html);
  const truncated = text.length > MAX_TEXT_CHARS;
  return {
    url: url.toString(),
    title: title || url.hostname,
    text: truncated ? `${text.slice(0, MAX_TEXT_CHARS)}…` : text,
    truncated,
    untrusted: true,
  };
}

export async function webResearch(query: string): Promise<{
  search: SearchResponse;
  pages: PageContent[];
  external: true;
}> {
  const search = await webSearch(query, 5);
  const pages: PageContent[] = [];
  for (const result of search.results.slice(0, 2)) {
    try {
      pages.push(await fetchWebPage(result.url));
    } catch {
      // Individual pages often block automated fetches; the snippets still help.
    }
  }
  return { search, pages, external: true };
}
