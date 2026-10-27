// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NativePublishPanel } from "./NativePublishPanel.js";
let root: Root;
const scenario = { version: "draft-current", phases: [] };
const exportScenario = vi.fn(() => scenario);
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>'; root = createRoot(document.querySelector('#root')!);
  exportScenario.mockReset().mockReturnValue(scenario);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });
async function render(active = false) {
  await act(async () => root.render(<NativePublishPanel token="operator-token" exportScenario={exportScenario} active={active} onClose={() => {}} />));
}
async function submit() { await act(async () => { document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); }
it("publishes the current draft with operator credentials to the selected channel", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, revision: 'a'.repeat(64), fileCount: 3, scenarioVersion: 'draft-current' })));
  vi.stubGlobal('fetch', fetcher); await render();
  const select = document.querySelector('select')!;
  await act(async () => { select.value = 'production'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await submit();
  expect(exportScenario).toHaveBeenCalledOnce();
  expect(fetcher).toHaveBeenCalledWith('/api/admin/native-shows/publish', expect.objectContaining({ method: 'POST',
    headers: expect.objectContaining({ Authorization: 'Bearer operator-token' }), body: JSON.stringify({ channel: 'production', scenario }) }));
  expect(document.querySelector('[role="status"]')?.textContent).toContain('Published production');
  expect(document.querySelector('[role="status"]')?.textContent).toContain('3 audio files');
});
it("shows a missing-media error without claiming success", async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'native_publish_failed', message: 'Sync missing MP3s first.' }), { status: 422 })));
  await render(); await submit(); expect(document.querySelector('[role="alert"]')?.textContent).toContain('Sync missing MP3s');
  expect(document.querySelector('[role="status"]')).toBeNull();
});
it("does not send invalid exports or publish during a live show", async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); await render(true); await submit();
  expect(fetcher).not.toHaveBeenCalled();
  await render(false); exportScenario.mockImplementation(() => { throw new Error('Broken graph'); }); await submit();
  expect(fetcher).not.toHaveBeenCalled(); expect(document.querySelector('[role="alert"]')?.textContent).toBe('Broken graph');
});
it("prevents duplicate submissions while a publication is pending", async () => {
  let resolve!: (response: Response) => void;
  const fetcher = vi.fn(() => new Promise<Response>(done => { resolve = done; })); vi.stubGlobal('fetch', fetcher);
  await render(); await submit(); await submit(); expect(fetcher).toHaveBeenCalledOnce();
  expect(document.querySelector('select')!.disabled).toBe(true);
  await act(async () => resolve(new Response(JSON.stringify({ revision: 'b'.repeat(64), fileCount: 0, scenarioVersion: 'draft-current' }))));
});
