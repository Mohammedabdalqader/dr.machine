export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly details?: Record<string, unknown>) {
    super(message);
    this.name = 'HttpError';
  }
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/** Converts thrown errors into JSON responses; unexpected errors are logged, not leaked. */
export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return json({ error: err.message, ...err.details }, err.status);
  }
  console.error(err);
  return json({ error: 'Internal error' }, 500);
}

export async function readJSON<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'Request body must be JSON');
  }
}

export function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new HttpError(400, `${name} is required`);
  return value.trim();
}
