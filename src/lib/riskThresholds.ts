// R5-FIX1 — Risk Evolution reference lines.
//
// Display-only mirror of the CURRENT global-risk classification contract,
// whose source of truth is the AI Service artifact
// ai-service/artifacts/skorp-beta-0.1/risk_thresholds.json
//   { "low_max": 0.2, "moderate_max": 0.35 }
// applied by ai-service/app/inference.py::risk_level():
//   score <  0.20 → low
//   score <  0.35 → moderate
//   score >= 0.35 → high
// (also recorded in metadata.json `risk_thresholds` and scripts/train.py
// RISK_THRESHOLDS). The API does not publish these numbers, so they are
// mirrored here for drawing only.
//
// The frontend NEVER classifies a score with these values (V4A rule:
// Prediction.riskLevel, as persisted, is the sole source of truth for the
// level of each prediction, including historical ones). The values are on
// the same 0–1 scale as Prediction.riskScore — never 20/35.
import type { RiskLevel } from '@/types'

export const CURRENT_MODEL_RISK_THRESHOLDS = {
  lowMax: 0.20,      // moderate starts here
  moderateMax: 0.35, // high starts here
} as const

export interface RiskReferenceLine {
  value: number            // 0–1 risk-score scale
  startsLevel: RiskLevel   // the level that BEGINS at this boundary
  label: string
  color: string
}

// Colors are the same tier colors the chart already used for these lines.
export const RISK_REFERENCE_LINES: readonly RiskReferenceLine[] = [
  { value: CURRENT_MODEL_RISK_THRESHOLDS.lowMax,      startsLevel: 'moderate', label: 'Umbral moderado', color: '#D97706' },
  { value: CURRENT_MODEL_RISK_THRESHOLDS.moderateMax, startsLevel: 'high',     label: 'Umbral alto',     color: '#DC2626' },
]
