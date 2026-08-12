import { track } from './analytics.ts';

type LcpElement = Pick<Element, 'id' | 'tagName' | 'getAttribute'>;
type LcpEntry = PerformanceEntry & { element?: Element };

export function describeLcpElement(element: LcpElement | null): string {
  if (!element) return 'unknown';

  const tag = element.tagName.toLowerCase();
  if (element.id) return `${tag}#${element.id}`;

  const className = element
    .getAttribute('class')
    ?.split(/\s+/)
    .find((name) => /^[A-Za-z0-9_-]+$/.test(name));
  return className ? `${tag}.${className}` : tag;
}

export function observeLcp(): void {
  if (typeof PerformanceObserver === 'undefined') return;

  let entry: LcpEntry | undefined;
  let observer: PerformanceObserver | undefined;
  let reported = false;

  const report = () => {
    if (reported || !entry) return;
    reported = true;
    observer?.disconnect();
    track('web_vital_lcp', {
      lcp_ms: Math.round(entry.startTime),
      lcp_element: describeLcpElement(entry.element ?? null),
      page_path: location.pathname,
    });
  };

  try {
    observer = new PerformanceObserver((list) => {
      const entries = list.getEntries() as LcpEntry[];
      entry = entries[entries.length - 1];
    });
    observer.observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {
    return;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') report();
  });
  window.addEventListener('pagehide', report, { once: true });
}
