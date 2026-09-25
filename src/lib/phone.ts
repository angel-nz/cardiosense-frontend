// V6.2 — frontend phone domain foundation. Pure functions only — no UI
// (CountryPhoneInput belongs to V6.3, not built here).
//
// Uses libphonenumber-js's `/min` metadata build deliberately: it drops
// per-country example numbers and some extended metadata that only the
// backend's authoritative validation needs, keeping this out of the
// frontend bundle (the project already has an existing >500kB Vite
// chunk-size warning — see V6.2 report §19 — unrelated to this change,
// not solved here). The backend (backend/src/lib/phone.ts) deliberately
// uses the full/default import instead, since it is the authoritative
// validation boundary (V6.1 §10, V6.2 §7).
//
// Mirrors the backend's canonical contract (see backend/src/lib/phone.ts):
// a Patient.phone value is canonical only when it is E.164-formatted with
// no spaces/punctuation and no extension. These functions do not enforce
// that contract themselves (that's the backend's job) — they exist so a
// later block (V6.3/V6.4) can build CountryPhoneInput without re-deriving
// this logic, per V6.2 §8's "expose the pure functions later blocks will
// need" instruction.
import {
  parsePhoneNumberFromString,
  AsYouType,
  getCountryCallingCode,
  type CountryCode,
} from 'libphonenumber-js/min'

// Parses a canonical (or any) stored phone string and returns the full
// libphonenumber-js PhoneNumber object, or `null` if it doesn't parse to a
// valid number. Never assumes a default country — an unparseable/ambiguous
// legacy value (V6.1 §13/§15, V6.2 §4) must come back `null`, not be
// silently coerced into some guessed country.
export function parseStoredPhone(value: string) {
  const parsed = parsePhoneNumberFromString(value)
  if (!parsed || !parsed.isValid()) return null
  return parsed
}

// Infers the ISO country (e.g. "MX") from a canonical stored phone, or
// `null` when it can't be determined (unparseable/legacy value) — the
// caller (a later block's edit-form logic) decides what to do with `null`
// rather than this function guessing Mexico or any other default.
export function inferCountry(value: string): CountryCode | null {
  return parseStoredPhone(value)?.country ?? null
}

// Human-readable "+52 33 1234 5678"-style international display.
// Returns the raw input unchanged if it doesn't parse — never fabricates a
// plausible-looking format for a legacy/unparseable value (V6.1 §16).
export function formatInternationalDisplay(value: string): string {
  const parsed = parseStoredPhone(value)
  return parsed ? parsed.formatInternational() : value
}

// Country-aware national display, e.g. "33 1234 5678" for MX. Returns the
// raw input unchanged if it doesn't parse, for the same reason as above.
export function formatNationalDisplay(value: string): string {
  const parsed = parseStoredPhone(value)
  return parsed ? parsed.formatNational() : value
}

// V6.5 — read-side display contract for PatientDetailPage (and any future
// read-only phone surface): a single call gives both the human-readable
// text AND the safe tel: target, so no page has to re-derive "is this
// parseable" logic itself (§2/§10/§11 — no duplicated parsing).
//
// - Parseable (canonical OR legacy-but-safely-parseable, e.g. a spaced
//   "+52 33 1234 5678") → human-readable formatInternational() text, and a
//   machine-usable canonical E.164 tel: href — even when the STORED string
//   itself isn't byte-identical E.164 (display is intentionally more
//   permissive than the write contract; V6.2's canonical-equality rule is
//   about what may be PERSISTED on a new/changed write, not about what may
//   be safely read and shown — §5).
// - Unparseable/ambiguous (no default country ever assumed — §4) → the raw
//   stored value verbatim as text, and `telHref: null`. §3's decision:
//   an ambiguous/legacy value is never given a fabricated tel: target,
//   since that would present unverified data as though it were a
//   known-good, click-to-call number. Plain, non-actionable text is the
//   safer default for data we can't confirm is even dialable as stored.
export interface PhoneDisplay {
  text: string
  telHref: string | null
}

export function getPhoneDisplay(value: string): PhoneDisplay {
  const parsed = parseStoredPhone(value)
  if (parsed) {
    return { text: parsed.formatInternational(), telHref: `tel:${parsed.format('E.164')}` }
  }
  // Never throws on malformed input — parseStoredPhone already swallows
  // parse failures and returns null (§2's "do not throw for malformed
  // legacy values").
  return { text: value, telHref: null }
}

// Turns a selected country + the national digits the user is typing into
// the canonical E.164 string CardioSense persists, or `null` while the
// input isn't yet a valid, complete number for that country. Intended for
// a later CountryPhoneInput (V6.3) to call on submit, not on every
// keystroke (see `formatAsYouType` below for the live-typing case).
export function canonicalizeNationalInput(country: CountryCode, nationalNumber: string): string | null {
  const parsed = parsePhoneNumberFromString(nationalNumber, country)
  if (!parsed || !parsed.isValid()) return null
  return parsed.format('E.164')
}

// Live "as-you-type" formatting for a given country's national input —
// what a future CountryPhoneInput would feed into the visible text field
// while the user is still typing (never what gets persisted — that's
// always canonicalizeNationalInput's E.164 output on submit).
export function formatAsYouType(country: CountryCode, partialNationalInput: string): string {
  const formatter = new AsYouType(country)
  return formatter.input(partialNationalInput)
}

// The country calling code (e.g. "52" for MX) — for a country selector to
// show alongside the flag/name.
export function callingCodeFor(country: CountryCode): string {
  return getCountryCallingCode(country)
}

export type { CountryCode }
