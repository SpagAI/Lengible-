// Calls one of Lengible's API routes and always returns { status, message }, even when the
// server times out or sends back an error page instead of JSON.
export async function postJSON<T extends { status: string; message?: string }>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST" });
  } catch {
    return { status: "error", message: "No connection. Check your internet and try again." } as T;
  }
  try {
    return (await res.json()) as T;
  } catch {
    const message =
      res.status === 504 || res.status === 408
        ? "The AI took too long to answer. Tap again; anything already done is kept."
        : res.status === 401 || res.redirected
          ? "Your sign-in expired. Reload the page and sign in again."
          : `The server had a problem (error ${res.status}). Please try again.`;
    return { status: "error", message } as T;
  }
}
