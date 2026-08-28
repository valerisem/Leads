import { EnvHttpProxyAgent, type Dispatcher } from "undici";

/**
 * Railway needs no proxy, but sandboxed dev environments route outbound HTTPS
 * through one. Node's global fetch ignores HTTP(S)_PROXY, so opt in explicitly
 * when those variables are present and stay on the default dispatcher otherwise.
 */
const proxyConfigured = Boolean(
  process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy,
);

const dispatcher: Dispatcher | undefined = proxyConfigured
  ? new EnvHttpProxyAgent()
  : undefined;

export interface FetchJsonOptions {
  timeoutMs: number;
  headers?: Record<string, string>;
}

/** GET a JSON document with a hard timeout. Throws on non-2xx or timeout. */
export async function fetchJson<T>(
  url: string,
  { timeoutMs, headers }: FetchJsonOptions,
): Promise<T> {
  const response = await fetchWithTimeout(url, { timeoutMs, headers });
  if (!response.ok) {
    throw new Error(`GET ${url} responded ${response.status}`);
  }
  return (await response.json()) as T;
}

/** GET a plain-text document with a hard timeout. Throws on non-2xx or timeout. */
export async function fetchText(
  url: string,
  { timeoutMs, headers }: FetchJsonOptions,
): Promise<string> {
  const response = await fetchWithTimeout(url, { timeoutMs, headers });
  if (!response.ok) {
    throw new Error(`GET ${url} responded ${response.status}`);
  }
  return await response.text();
}

async function fetchWithTimeout(
  url: string,
  { timeoutMs, headers }: FetchJsonOptions,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers,
      signal: controller.signal,
      ...(dispatcher ? { dispatcher } : {}),
    } as RequestInit);
  } finally {
    clearTimeout(timer);
  }
}

export interface FetchRawOptions {
  timeoutMs: number;
  /** Stop reading the body after this many bytes. */
  maxBytes?: number;
}

export interface RawResponse {
  ok: boolean;
  status: number;
  finalUrl: string;
  body: string;
}

/**
 * GET a page for liveness checking. Follows redirects, caps how much of the
 * body is read, and never throws for HTTP errors — only for transport failure.
 */
export async function fetchPage(
  url: string,
  { timeoutMs, maxBytes = 65_536 }: FetchRawOptions,
): Promise<RawResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        // Some hosts serve a different page, or nothing, to an unknown client.
        "user-agent":
          "Mozilla/5.0 (compatible; HoM-LeadValidator/1.0; +https://houseofmarketers.com)",
        accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      },
      ...(dispatcher ? { dispatcher } : {}),
    } as RequestInit);

    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url || url,
      body: await readCapped(response, maxBytes),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.length;
      }
    }
  } catch {
    // A truncated body is fine — we only need enough to spot a parking page.
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString("utf8").slice(0, maxBytes);
}
