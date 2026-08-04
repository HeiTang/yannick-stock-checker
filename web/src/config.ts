export const SITE_URL = 'https://yannick.purr.tw';
export const SITE_HOSTNAME = new URL(SITE_URL).hostname;
export const GITHUB_REPOSITORY_URL = 'https://github.com/HeiTang/yannick-stock-checker';
export const GA_MEASUREMENT_ID = 'G-DNGFFM0MPH';
export const DEV_API_PROXY_TARGET = 'http://localhost:8080';
export const STATUS_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
export const GEOLOCATION_OPTIONS = {
  enableHighAccuracy: false,
  timeout: 8000,
  maximumAge: 60_000,
} satisfies PositionOptions;
