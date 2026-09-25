// V6.3 — pure, framework-free phone-input state logic. CountryPhoneInput.tsx
// is a thin React wrapper around these functions: every derivation/
// transition rule lives here so it's directly testable (V6.3-F01..11)
// without rendering a component or DOM, matching how V6.2/V7/V3 verified
// their own logic — and so no numbering-plan logic is duplicated (this
// module never parses/validates anything itself; it only calls the V6.2
// utilities in lib/phone.ts, which wrap libphonenumber-js).
import {
  parseStoredPhone, formatAsYouType, canonicalizeNationalInput,
  type CountryCode,
} from './phone'

export type PhoneInputStatus = 'empty' | 'valid' | 'invalid' | 'legacy'

// V6.3 §9 — the only shape a parent (V6.4) ever sees. No libphonenumber-js
// object (PhoneNumber, Metadata, etc.) is ever assigned to any of these
// fields — every field is a plain string/boolean/null (V6.3-F20).
export interface PhoneInputState {
  status: PhoneInputStatus
  // The canonical E.164 value — the ONLY thing V6.4 should ever persist as
  // Patient.phone. Non-null only when status === 'valid'.
  canonical: string | null
  // Selected/inferred ISO country. `null` ONLY for an unresolved legacy
  // value where no country could be determined at all (V6.3 §3/§11) — this
  // is the field V6.4/UI must check before ever assuming a country, never
  // defaulting it to MX on their own.
  country: CountryCode | null
  // The original persisted string, preserved verbatim. Non-null only when
  // status === 'legacy' — this is what V6.4 should resend unchanged if the
  // user never touched this control (V6.2's service-layer guard already
  // accepts an identical resend of a legacy value on an unrelated edit).
  raw: string | null
  // False only for the state object initializePhoneInput() derives purely
  // from the incoming `value` prop. Every state produced by an actual user
  // interaction (applyNationalInput/applyCountryChange) is `touched: true`.
  // This is how V6.4 distinguishes "existing legacy untouched" from "user
  // actively edited this phone" (V6.3 §11/§14) without guessing.
  touched: boolean
}

export interface PhoneInputInit {
  // Selector's starting position. `null` means "no country resolved — show
  // a neutral 'unresolved' placeholder, never a silently-assumed MX flag"
  // (V6.3 §3). MX only appears here for a genuinely blank value.
  country: CountryCode | null
  // What the national-number field should display initially.
  nationalText: string
  state: PhoneInputState
}

export interface PhoneInteractionResult {
  nationalText: string
  state: PhoneInputState
}

const DEFAULT_COUNTRY: CountryCode = 'MX'

// V6.3 §3/§6/§7/§8/§12 — derives the component's starting selector/field/
// state from whatever is currently persisted, WITHOUT ever being the thing
// that calls onChange (the React component never invokes the onChange prop
// from this function's result on mount/reinit — see CountryPhoneInput.tsx).
export function initializePhoneInput(value: string | null | undefined): PhoneInputInit {
  if (!value) {
    return {
      country: DEFAULT_COUNTRY,
      nationalText: '',
      state: { status: 'empty', canonical: null, country: DEFAULT_COUNTRY, raw: null, touched: false },
    }
  }

  const parsed = parseStoredPhone(value)
  if (!parsed || !parsed.country) {
    // Ambiguous/unparseable legacy value — country intentionally left
    // `null` everywhere (selector placeholder AND state.country), never
    // defaulted to MX just because MX is the new-number default.
    return {
      country: null,
      nationalText: value, // shown verbatim — nothing we can safely reformat
      state: { status: 'legacy', canonical: null, country: null, raw: value, touched: false },
    }
  }

  const country = parsed.country as CountryCode
  const isAlreadyCanonical = parsed.format('E.164') === value
  return {
    country,
    nationalText: parsed.formatNational(),
    state: isAlreadyCanonical
      ? { status: 'valid', canonical: value, country, raw: null, touched: false }
      // Parseable but NOT byte-identical to its own canonical form (V6.3
      // §12, e.g. "+52 33 1234 5678" with spaces) — country is confidently
      // known and shown nicely, but this is still 'legacy': canonical stays
      // null and raw preserves the original string exactly, so nothing
      // here implies the persisted value has already been normalized.
      : { status: 'legacy', canonical: null, country, raw: value, touched: false },
  }
}

// V6.3 §7/§8 — the user is typing/editing the national-number field for an
// already-selected `country`. Always `touched: true` (only ever called from
// an actual input event). `typedValue` is the field's FULL current text
// (not an incremental keystroke) — matches how AsYouType is designed to be
// re-run on each change (see lib/phone.ts::formatAsYouType).
export function applyNationalInput(country: CountryCode, typedValue: string): PhoneInteractionResult {
  if (!typedValue.trim()) {
    return {
      nationalText: '',
      state: { status: 'empty', canonical: null, country, raw: null, touched: true },
    }
  }

  const displayText = formatAsYouType(country, typedValue)
  const canonical = canonicalizeNationalInput(country, typedValue)

  if (canonical) {
    return { nationalText: displayText, state: { status: 'valid', canonical, country, raw: null, touched: true } }
  }
  // Incomplete or impossible for this country — NEVER canonical, NEVER
  // silently accepted (V6.3 §8: "do not treat an incomplete number as
  // canonical", "do not emit a fake canonical value while typing").
  return { nationalText: displayText, state: { status: 'invalid', canonical: null, country, raw: null, touched: true } }
}

// V6.3 §7 — explicit country change. Documented behavior: REINTERPRET, not
// reset — whatever text is currently in the national field (a partial
// number the user was typing, a formatted national number, or an
// unresolved legacy value's raw text) is kept and re-run through the newly
// selected country's rules, rather than being silently cleared. This is
// the one explicit interaction that lets a doctor resolve a previously
// LEGACY_UNRESOLVED value: picking a country reinterprets its raw text
// under that country's numbering plan; whether that succeeds (valid),
// stays incomplete (invalid), or needs further editing is then reported
// exactly like normal typing — never auto-assumed.
export function applyCountryChange(newCountry: CountryCode, currentNationalText: string): PhoneInteractionResult {
  return applyNationalInput(newCountry, currentNationalText)
}
