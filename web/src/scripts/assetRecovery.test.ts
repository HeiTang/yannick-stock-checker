import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import source from './assetRecovery.js?raw';

const key = 'ytm.asset-recovery.reloaded';
const asset = 'https://example.test/_astro/page.abc12345.js';
type Handler = (event: Record<string, unknown>) => unknown;

function page(options: {
  storage?: Map<string, string>;
  status?: number;
  storageBlocked?: boolean;
  storageDiscarded?: boolean;
  bodyMissing?: boolean;
} = {}) {
  const storage = options.storage ?? new Map<string, string>();
  const listeners = new Map<string, Handler>();
  const node = () => ({
    style: { cssText: '' },
    setAttribute: vi.fn(), append: vi.fn(), addEventListener: vi.fn(),
  });
  const body = node();
  const document = {
    body: options.bodyMissing ? null : body,
    createElement: vi.fn(node), addEventListener: vi.fn(),
  };
  class Script {
    constructor(public src: string) {}
  }
  class Link {
    relList = { contains: (name: string) => name === 'stylesheet' };
    constructor(public href: string) {}
  }
  const fetch = vi.fn().mockResolvedValue({ status: options.status ?? 404 });
  const reload = vi.fn();
  const entries: { name: string; responseStatus: number }[] = [];
  runInNewContext(source, {
    URL, AbortSignal,
    window: { addEventListener: (name: string, handler: Handler) => listeners.set(name, handler) },
    document, HTMLScriptElement: Script, HTMLLinkElement: Link,
    location: { href: 'https://example.test/query/?view=stations&s=S2#query', origin: 'https://example.test', reload },
    performance: { getEntriesByType: () => entries },
    fetch,
    sessionStorage: {
      getItem: (name: string) => {
        if (options.storageBlocked) throw new Error('blocked');
        return storage.get(name) ?? null;
      },
      setItem: (name: string, value: string) => {
        if (!options.storageDiscarded) storage.set(name, value);
      },
    },
  });
  return {
    storage, body, document, fetch, reload, entries, listeners,
    scriptError: (url = asset) => listeners.get('error')!({ target: new Script(url) }),
    cssError: () => listeners.get('error')!({ target: new Link('https://example.test/_astro/page.abc12345.css') }),
  };
}

describe('inline asset recovery', () => {
  it('confirms missing CSS and shares one reload budget across simultaneous failures', async () => {
    const p = page();
    p.cssError();
    p.scriptError();
    await vi.waitFor(() => expect(p.reload).toHaveBeenCalledTimes(1));
    expect(p.storage.get(key)).toBe('1');
    expect(p.fetch.mock.calls[0][1]).toMatchObject({ method: 'HEAD', cache: 'no-store', redirect: 'error' });
  });

  it('survives actual page reinitialization and never resets the reload budget', async () => {
    const first = page();
    first.scriptError();
    await vi.waitFor(() => expect(first.reload).toHaveBeenCalledTimes(1));
    const next = page({ storage: first.storage });
    next.cssError();
    next.scriptError();
    await vi.waitFor(() => expect(next.body.append).toHaveBeenCalledTimes(1));
    expect(next.reload).not.toHaveBeenCalled();
    expect(next.storage.get(key)).toBe('1');
    const notice = next.body.append.mock.calls[0][0];
    const button = notice.append.mock.calls[0][1];
    button.addEventListener.mock.calls[0][1]();
    expect(next.reload).toHaveBeenCalledTimes(1);
    expect(next.storage.get(key)).toBe('1');
  });

  it('handles a failed dependency even when its entry module still exists', async () => {
    const p = page();
    p.entries.push({ name: 'https://example.test/_astro/chunk.abc12345.js', responseStatus: 404 });
    p.scriptError();
    await vi.waitFor(() => expect(p.reload).toHaveBeenCalledTimes(1));
    expect(p.fetch.mock.calls[0][0]).toContain('chunk.');
  });

  it('checks failures arriving while an earlier resource is being verified', async () => {
    const p = page();
    p.fetch.mockResolvedValueOnce({ status: 200 }).mockResolvedValueOnce({ status: 404 });
    p.scriptError();
    p.cssError();
    await vi.waitFor(() => expect(p.reload).toHaveBeenCalledTimes(1));
    expect(p.fetch).toHaveBeenCalledTimes(2);
  });

  it('checks the next missing resource after an earlier HEAD request fails', async () => {
    const p = page();
    p.fetch.mockRejectedValueOnce(new Error('network failure')).mockResolvedValueOnce({ status: 404 });
    p.scriptError();
    p.cssError();
    await vi.waitFor(() => expect(p.reload).toHaveBeenCalledTimes(1));
    expect(p.fetch).toHaveBeenCalledTimes(2);
    expect(p.fetch.mock.calls[1][0]).toBe('https://example.test/_astro/page.abc12345.css');
    expect(p.storage.get(key)).toBe('1');
    expect(p.body.append).not.toHaveBeenCalled();
  });

  it('handles Vite dynamic import failures and 410 responses', async () => {
    const p = page({ status: 410 });
    p.listeners.get('vite:preloadError')!({ payload: new Error(`Failed to fetch dynamically imported module: ${asset}`) });
    await vi.waitFor(() => expect(p.reload).toHaveBeenCalledTimes(1));
  });

  it('handles native dynamic import rejection without reacting to ordinary application errors', async () => {
    const p = page();
    p.listeners.get('unhandledrejection')!({ reason: new Error('API failed') });
    expect(p.fetch).not.toHaveBeenCalled();
    p.listeners.get('unhandledrejection')!({ reason: new Error(`error loading dynamically imported module: ${asset}`) });
    await vi.waitFor(() => expect(p.reload).toHaveBeenCalledTimes(1));
  });

  it.each([200, 403, 500])('does not auto-reload an unconfirmed failure (%s)', async (status) => {
    const p = page({ status });
    p.scriptError();
    await vi.waitFor(() => expect(p.body.append).toHaveBeenCalledTimes(1));
    expect(p.reload).not.toHaveBeenCalled();
    expect(p.storage.size).toBe(0);
  });

  it.each([{ storageBlocked: true }, { storageDiscarded: true }])('requires a durable reload marker', async (options) => {
    const p = page(options);
    p.cssError();
    await vi.waitFor(() => expect(p.body.append).toHaveBeenCalledTimes(1));
    expect(p.reload).not.toHaveBeenCalled();
  });

  it('does not auto-reload offline or timed-out requests', async () => {
    const p = page();
    p.fetch.mockRejectedValue(new Error('offline'));
    p.scriptError();
    await vi.waitFor(() => expect(p.body.append).toHaveBeenCalledTimes(1));
    expect(p.reload).not.toHaveBeenCalled();
  });

  it('ignores third-party scripts, API failures, and ordinary runtime errors', () => {
    const p = page();
    p.scriptError('https://cdn.example.test/_astro/page.abc12345.js');
    p.scriptError('https://example.test/api/missing.js');
    p.listeners.get('error')!({ target: {}, message: 'runtime error' });
    expect(p.fetch).not.toHaveBeenCalled();
    expect(p.reload).not.toHaveBeenCalled();
  });

  it('waits for a body when failure occurs during head parsing', async () => {
    const p = page({ bodyMissing: true, storage: new Map([[key, '1']]) });
    p.cssError();
    await vi.waitFor(() => expect(p.document.addEventListener).toHaveBeenCalledTimes(1));
    expect(p.body.append).not.toHaveBeenCalled();
    p.document.body = p.body;
    p.document.addEventListener.mock.calls[0][1]();
    expect(p.body.append).toHaveBeenCalledTimes(1);
  });
});
