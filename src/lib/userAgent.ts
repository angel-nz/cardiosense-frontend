// Y5.3 — small, pure, dependency-free User-Agent → friendly label parser for
// the Active Sessions UI. No UA-parsing library was installed (this block's
// expected dependency change is NONE) — this is a deliberately narrow
// heuristic covering only the browser/OS families this block asks for
// (Edge/Chrome/Firefox/Safari × Windows/macOS/Linux/Android/iOS), not a
// general-purpose UA database. It never attempts to name a precise device
// model, and never touches IP/geolocation — those are explicitly out of
// scope (Y5.3 §10).
//
// Detection order is the load-bearing part of this file, not incidental:
//  - Edge's Chromium UA string ("...Chrome/1xx.../Edg/1xx...") ALSO contains
//    "Chrome/", so Edge must be matched before the generic Chrome check —
//    otherwise every Edge session would be mislabeled "Chrome" (Y5.3 §10's
//    explicit warning).
//  - Chrome/Firefox on iOS identify themselves as "CriOS/"/"FxiOS/" but
//    STILL carry a "Safari/" token (WebKit is the only rendering engine
//    Apple allows on iOS) — checked before the generic Safari check, so
//    Chrome-on-iOS is reported as Chrome, not casually conflated with
//    Safari (Y5.3 §10's other explicit warning).
//  - iOS UA strings contain the literal substring "like Mac OS X" (e.g.
//    "...CPU iPhone OS 17_0 like Mac OS X..."), so the iPhone/iPad/iPod
//    check must run before the macOS "Mac OS X"/"Macintosh" check, or every
//    iOS session would be mislabeled macOS.
//  - Android UA strings contain the literal substring "Linux" (e.g.
//    "...(Linux; Android 13; Pixel 7)..."), so the Android check must run
//    before the generic Linux check, or every Android session would be
//    mislabeled Linux.
export interface ParsedUserAgent {
  browser: string
  os: string
  label: string
}

const UNKNOWN_BROWSER = 'Navegador desconocido'
const UNKNOWN_OS = 'Sistema desconocido'

function detectBrowser(ua: string): string | null {
  if (/Edg\//.test(ua)) return 'Edge'
  if (/FxiOS\//.test(ua)) return 'Firefox'
  if (/CriOS\//.test(ua)) return 'Chrome'
  if (/Firefox\//.test(ua)) return 'Firefox'
  if (/Chrome\//.test(ua) || /Chromium\//.test(ua)) return 'Chrome'
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return 'Safari'
  return null
}

function detectOS(ua: string): string | null {
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS'
  if (/Android/.test(ua)) return 'Android'
  if (/Windows NT/.test(ua)) return 'Windows'
  if (/Macintosh|Mac OS X/.test(ua)) return 'macOS'
  if (/Linux/.test(ua)) return 'Linux'
  return null
}

// Pure and testable, per this block's explicit instruction — no DOM/browser
// globals referenced, so it can be (and is, this block) unit-tested outside
// a browser runtime.
export function parseUserAgent(userAgent: string | null): ParsedUserAgent {
  if (!userAgent || !userAgent.trim()) {
    return { browser: UNKNOWN_BROWSER, os: UNKNOWN_OS, label: 'Dispositivo desconocido' }
  }

  const browser = detectBrowser(userAgent) ?? UNKNOWN_BROWSER
  const os = detectOS(userAgent) ?? UNKNOWN_OS
  return { browser, os, label: `${browser} · ${os}` }
}
