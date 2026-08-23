"use client";

/**
 * Calling the app's own API routes.
 *
 * These used to be Firebase callable functions, which attached the caller's ID
 * token for us. A plain fetch does not, so this is the one place that knows to
 * send it — and the server verifies it rather than trusting anything else in
 * the request.
 *
 * Moving them into the Next app means Vercel deploys the server logic with the
 * site: one push, one deploy, instead of a separate Firebase release that the
 * app silently did not work without.
 */

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function idToken(): Promise<string | null> {
  const { getAuthClient } = await import("@/lib/storage/firebaseAuth");
  const user = getAuthClient().currentUser;
  return user ? user.getIdToken() : null;
}

/**
 * POSTs to an API route as the signed-in user.
 *
 * Throws ApiError carrying the server's own message, so callers can show
 * something true rather than "request failed".
 */
export async function callApi<T>(path: string, body: unknown = {}): Promise<T> {
  const token = await idToken();
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(
      response.status,
      (payload as { error?: string }).error ?? "Something went wrong."
    );
  }
  return payload as T;
}

export async function getApi<T>(path: string): Promise<T> {
  const token = await idToken();
  const response = await fetch(path, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(response.status, (payload as { error?: string }).error ?? "Something went wrong.");
  }
  return payload as T;
}
