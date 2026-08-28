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
