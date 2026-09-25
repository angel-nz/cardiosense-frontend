// V6.3 §4/§5/§15 — country metadata for the CountryPhoneInput selector.
// Deliberately NOT a hand-maintained translation map: country codes come
// from libphonenumber-js's own supported-region list (so the selector can
// never offer a country the phone parser doesn't understand), and Spanish
// names come from the standard `Intl.DisplayNames` browser/Node API — no
// new dependency, no manually-authored list to keep in sync.
import { getCountries } from 'libphonenumber-js/min'
import { callingCodeFor, type CountryCode } from './phone'

export interface CountryOption {
  code: CountryCode
  name: string       // Spanish display name, e.g. "México"
  flag: string        // Unicode regional-indicator flag, e.g. "🇲🇽"
  callingCode: string  // e.g. "52" (no leading '+')
  // Precomputed lowercase, diacritic-stripped name — search reuses this on
  // every keystroke instead of recomputing it (§15: don't rebuild
  // expensive structures on every keystroke; the list itself is built once
  // at module load, filtering it is a cheap O(n) pass over ~200 items).
  searchName: string
}

function flagEmoji(iso2: string): string {
  // Each letter A-Z maps to a Unicode regional-indicator symbol
  // (U+1F1E6..U+1F1FF); two of them next to each other render as that
  // country's flag in virtually every modern platform/browser — no image
  // asset, no flag package, per §5's explicit instruction.
  return String.fromCodePoint(
    ...iso2.toUpperCase().split('').map(ch => 0x1f1e6 + ch.charCodeAt(0) - 65),
  )
}

function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

let cachedOptions: CountryOption[] | null = null

// Module-level memoized — built once, on first call, not on every render or
// keystroke (§15). `Intl.DisplayNames` is constructed once here rather than
// once per country.
export function getCountryOptions(): CountryOption[] {
  if (cachedOptions) return cachedOptions

  const displayNames = typeof Intl !== 'undefined' && 'DisplayNames' in Intl
    ? new Intl.DisplayNames(['es'], { type: 'region' })
    : null

  cachedOptions = getCountries()
    .map((code): CountryOption => {
      const name = displayNames?.of(code) ?? code
      return {
        code,
        name,
        flag: flagEmoji(code),
        callingCode: callingCodeFor(code),
        searchName: stripDiacritics(name.toLowerCase()),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))

  return cachedOptions
}

// Matches by (accent-insensitive) Spanish name or by calling code, with or
// without a leading '+' — e.g. "mex", "méxico", "52", "+52" all find México.
export function searchCountries(query: string): CountryOption[] {
  const options = getCountryOptions()
  const q = stripDiacritics(query.trim().toLowerCase()).replace(/^\+/, '')
  if (!q) return options
  return options.filter(opt =>
    opt.searchName.includes(q) || opt.callingCode.includes(q),
  )
}
