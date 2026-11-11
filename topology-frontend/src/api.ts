export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000';

let csrfToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

/** Register handler called when any API call returns 401. Returns unsubscribe. */
export function onUnauthorized(fn: () => void) {
  unauthorizedHandler = fn;
  return () => {
    if (unauthorizedHandler === fn) unauthorizedHandler = null;
  };
}

interface ApiOptions extends Omit<RequestInit, 'body'> {
  json?: unknown;
  /** skip global 401 handling (login, session check) */
  noAuthRedirect?: boolean;
}

export async function apiFetch(path: string, options: ApiOptions = {}): Promise<Response> {
  const { json, noAuthRedirect, ...init } = options;
  const method = (init.method || 'GET').toUpperCase();
  const headers = new Headers(init.headers);

  let body: string | undefined;
  if (json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(json);
  }
  if (method !== 'GET' && method !== 'HEAD' && csrfToken) {
    headers.set('X-CSRF-Token', csrfToken);
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    method,
    headers,
    body,
    credentials: 'include',
  });

  if (res.status === 401 && !noAuthRedirect) {
    csrfToken = null;
    unauthorizedHandler?.();
  }
  return res;
}

export async function errorMessage(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => ({}));
  return data.error || fallback;
}