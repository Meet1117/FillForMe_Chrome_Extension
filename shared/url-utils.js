/**
 * URL helpers shared by the content scripts, the service worker and the side panel.
 * Written as a classic script that attaches to `globalThis.FPShared`, so it works
 * both as a content script and via `import '../shared/url-utils.js'` in modules.
 */
(function (root) {
  'use strict';
  const FP = (root.FPShared = root.FPShared || {});
  if (FP.Url) return;

  /** Words in a hostname that mean "this is not production". */
  const NON_PROD_HINTS = ['localhost', '127.0.0.1', 'dev', 'test', 'staging', 'uat', 'qa'];

  function safeUrl(url) {
    try { return new URL(url); } catch { return null; }
  }

  /** True for pages FillForMe can work on at all (http, https, file). */
  function isSupported(url) {
    const u = safeUrl(url);
    return !!u && ['http:', 'https:', 'file:'].includes(u.protocol);
  }

  /**
   * Heuristic: a host that doesn't contain any non-prod hint is treated as a live site.
   * Private network addresses and *.local hosts are also treated as non-production.
   */
  function isLikelyProduction(url) {
    const u = safeUrl(url);
    if (!u || u.protocol === 'file:') return false;
    const host = u.hostname.toLowerCase();
    if (NON_PROD_HINTS.some((h) => host.includes(h))) return false;
    if (/^(0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return false;
    if (host.endsWith('.local') || host.endsWith('.localhost') || host === '[::1]') return false;
    return true;
  }

  /** Permission match pattern for a URL, e.g. "http://localhost/*" (ports are not part of patterns). */
  function originPattern(url) {
    const u = safeUrl(url);
    if (!u) return null;
    if (u.protocol === 'file:') return 'file:///*';
    return `${u.protocol}//${u.hostname}/*`;
  }

  /** Key used to link recordings and per-site data to a site (includes the port). */
  function siteKey(url) {
    const u = safeUrl(url);
    if (!u) return '';
    if (u.protocol === 'file:') return 'file://';
    return u.origin;
  }

  /** Human readable site name for the UI. */
  function siteLabel(url) {
    const u = safeUrl(url);
    if (!u) return '';
    if (u.protocol === 'file:') return 'Local file';
    return u.host;
  }

  /**
   * Page pattern used to remember AI field selections: origin + path where
   * numeric / uuid-like segments are replaced by "*" (so /orders/123/edit == /orders/456/edit).
   */
  function pagePattern(url) {
    const u = safeUrl(url);
    if (!u) return '';
    const path = u.pathname
      .split('/')
      .map((seg) => (/^\d+$|^[0-9a-f]{8,}(-[0-9a-f]{4,})*$/i.test(seg) ? '*' : seg))
      .join('/');
    return siteKey(url) + path;
  }

  /** URL without its #hash. */
  function stripHash(url) {
    const i = String(url || '').indexOf('#');
    return i === -1 ? String(url || '') : String(url).slice(0, i);
  }

  /** Same page "route": origin + path + hash, ignoring the query string. */
  function sameRoute(a, b) {
    const x = safeUrl(a);
    const y = safeUrl(b);
    if (!x || !y) return false;
    return x.origin === y.origin && x.pathname === y.pathname && x.hash === y.hash;
  }

  /** Does a granted permission origin pattern cover this URL? */
  function patternMatches(pattern, url) {
    const u = safeUrl(url);
    if (!u) return false;
    if (pattern === '<all_urls>') return isSupported(url);
    const m = /^(\*|https?|file):\/\/([^/]*)\/(.*)$/.exec(pattern);
    if (!m) return false;
    const [, scheme, host] = m;
    if (scheme === 'file') return u.protocol === 'file:';
    if (scheme === '*' ? !['http:', 'https:'].includes(u.protocol) : u.protocol !== scheme + ':') return false;
    if (host === '*') return true;
    if (host.startsWith('*.')) {
      const base = host.slice(2);
      return u.hostname === base || u.hostname.endsWith('.' + base);
    }
    return u.hostname === host;
  }

  FP.Url = {
    isSupported, isLikelyProduction, originPattern, siteKey, siteLabel,
    pagePattern, stripHash, sameRoute, patternMatches,
  };
})(globalThis);
