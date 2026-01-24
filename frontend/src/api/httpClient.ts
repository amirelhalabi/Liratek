type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export type ApiError = {
  status: number;
  message: string;
  details?: unknown;
};

function getBaseUrl(): string {
  // Prefer runtime override (works in both Vite and Jest typecheck)
  const fromGlobal = (globalThis as any).__LIRATEK_BACKEND_URL as string | undefined;
  return (fromGlobal || 'http://localhost:3000').replace(/\/$/, '');
}

function getToken(): string | null {
  return localStorage.getItem('liratek.jwt');
}

export function setToken(token: string | null): void {
  if (!token) {
    localStorage.removeItem('liratek.jwt');
    return;
  }
  localStorage.setItem('liratek.jwt', token);
}

export async function requestJson<T>(
  path: string,
  options?: {
    method?: HttpMethod;
    body?: unknown;
    auth?: boolean;
  },
): Promise<T> {
  const url = `${getBaseUrl()}${path.startsWith('/') ? '' : '/'}${path}`;
  const method = options?.method ?? 'GET';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (options?.auth !== false) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: options?.body !== undefined ? JSON.stringify(options.body) : null,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const err: ApiError = {
      status: res.status,
      message: data?.error || data?.message || `Request failed (${res.status})`,
      details: data,
    };
    throw err;
  }

  return data as T;
}
