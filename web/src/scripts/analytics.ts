type EventParams = Record<string, string | number | boolean>;

declare global {
  interface Window {
    gtag?: (command: 'event', eventName: string, params?: EventParams) => void;
  }
}

export function track(eventName: string, params: EventParams = {}): void {
  window.gtag?.('event', eventName, params);
}
