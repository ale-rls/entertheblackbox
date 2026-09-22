/** Explicit preview links select a separate runtime; ordinary device URLs stay live. */
export function rehearsalId(search = (globalThis as { location?: { search: string } }).location?.search ?? ""): string | null {
  const id = new URLSearchParams(search).get("rehearsal");
  return id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : id === null ? null : "invalid";
}

export function runtimeApi(path: string, search?: string): string {
  const id = rehearsalId(search);
  if (!id) return path;
  return `/api/rehearsals/${id}/${path.replace(/^\/(api\/)?/, "")}`;
}

export function runtimeWebSocket(location: { protocol: string; host: string; search: string }): string {
  const id = rehearsalId(location.search);
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws${id ? `?rehearsal=${id}` : ""}`;
}
