import { WheelDatePicker } from '@/components/ui/WheelDatePicker'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { Calendar, ChevronLeft, ChevronRight, Cpu, History, Loader2 } from 'lucide-react'
import { RiskBadge } from '@/components/ui/RiskBadge'
import { RiskGauge } from '@/components/charts/RiskGauge'
import { ClinicalSourceDisclosure } from '@/components/predictions/ClinicalSourceDisclosure'
import { formatRelativeBusinessDate, formatRelativeBusinessDateTime } from '@/lib/utils'
import { clinicalTimeLabel, predictionClinicalInstant } from '@/lib/clinicalTime'
import { getBusinessDateKey, BUSINESS_TIMEZONE } from '@/lib/businessDate'
import { predictionService } from '@/services/predictionService'
import { useSocket } from '@/context/SocketContext'
import type { Prediction, PredictionRiskFilter } from '@/types'

// W5.2 — fixed page size for this patient-scoped view (binding product
// requirement: exactly 10/page). No page-size selector exists or is added;
// the shared PatientPredictionQueryDto default (20, used elsewhere) is left
// untouched — this page simply requests limit=10 explicitly on every call
// (§8/§9 of the W5.2 block; per the accepted W5.1 diagnosis §3/§36, changing
// the shared endpoint default was explicitly NOT preferred).
const PAGE_LIMIT = 10

// W5.2 §13/§21 — duplicated verbatim from PredictionsPage.tsx's
// GlobalPredictionHistory (not imported — that component and its helpers
// are not exported, and Global Prediction History is explicitly left
// untouched per the accepted W5.1 diagnosis: a small, intentional
// duplication rather than a shared-utility refactor). Same noon-UTC anchor
// trick to avoid a calendar-day rollover when reformatted in
// BUSINESS_TIMEZONE.
const MONTH_FORMATTER = new Intl.DateTimeFormat('es-MX', { timeZone: BUSINESS_TIMEZONE, month: 'long', year: 'numeric' })
const DAY_FORMATTER   = new Intl.DateTimeFormat('es-MX', { timeZone: BUSINESS_TIMEZONE, weekday: 'long', day: 'numeric' })

function monthLabel(dateKey: string): string {
  const label = MONTH_FORMATTER.format(new Date(`${dateKey}T12:00:00Z`))
  return label.charAt(0).toUpperCase() + label.slice(1)
}
function dayLabel(dateKey: string): string {
  const label = DAY_FORMATTER.format(new Date(`${dateKey}T12:00:00Z`))
  return label.charAt(0).toUpperCase() + label.slice(1)
}

// Rendered inside PredictionsPage's "Historial" tab, so it reads :patientId
// from the same matched route (/predictions/:patientId) — no separate route
// needed. GET /api/predictions/patient/:patientId (INT-12).
export default function PredictionHistoryPage() {
  const { patientId } = useParams<{ patientId: string }>()
  const { lastPrediction, clearLastPrediction } = useSocket()

  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // W5.2 §2/§4/§10/§20 — from/to/riskLevel filters, component-local state
  // per the accepted W5.1 §20 decision (no URL search params — matches this
  // page's existing convention; page/targetId are not URL-backed either).
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [riskLevel, setRiskLevel] = useState<PredictionRiskFilter | ''>('')

  const hasActiveFilters = !!(from || to || riskLevel)
  // §11 — frontend-only guard: an invalid range is never sent to the
  // server. Plain string comparison is safe here because both values are
  // literal "YYYY-MM-DD" — that sorts lexicographically identically to
  // chronologically. Backend `PatientPredictionQueryDto`'s own refine is
  // kept as an independent, authoritative defense (§2).
  const invalidRange = !!from && !!to && from > to

  const requestIdRef = useRef(0)
  const load = useCallback(async (silent = false) => {
    if (!patientId) return
    if (invalidRange) return // §11 — no request while the range is invalid
    const requestId = ++requestIdRef.current
    if (!silent) setLoading(true)
    setError(null)
    try {
      const result = await predictionService.getHistory(patientId, {
        page, limit: PAGE_LIMIT,
        from: from || undefined,
        to: to || undefined,
        riskLevel: riskLevel || undefined,
      })
      // §12 — stale-response guard: a newer load() may have started (a
      // filter/page change, or a realtime refetch) since this one did.
      if (requestId !== requestIdRef.current) return
      setPredictions(result.data)
      setTotal(result.total)
      setTotalPages(result.totalPages)
      // §8 — out-of-range correction after a filter/refetch narrows the
      // result set — the exact pattern already used by
      // GlobalPredictionHistory's own load().
      if (result.total > 0 && page > result.totalPages) {
        setPage(result.totalPages)
      } else if (result.total === 0 && page !== 1) {
        setPage(1)
      }
    } catch {
      if (requestId !== requestIdRef.current) return
      if (!silent) setError('No se pudo cargar el historial de predicciones')
      // A silent background refresh failing quietly is acceptable here —
      // the list just stays as-is; the user can still navigate away/back
      // or the next real fetch will retry. Surfacing an error banner for a
      // background refresh they didn't ask for would be more disruptive
      // than helpful.
    } finally {
      if (requestId === requestIdRef.current && !silent) setLoading(false)
    }
  }, [patientId, page, from, to, riskLevel, invalidRange])

  useEffect(() => { load() }, [load])

  // §10 — any filter change resets to page 1; every OTHER active filter is
  // kept (each is independent state — nothing here touches the others).
  useEffect(() => { setPage(1) }, [from, to, riskLevel])

  // INT-19/§18 — prediction_completed: refresh the history list in place
  // (silent — no loading spinner), using the CURRENT page/limit/filters
  // (captured by `load`'s own dependency array), rather than fabricate a
  // Prediction from the event's partial payload. Scoped to the currently
  // open patient only. The server — never this handler — decides whether
  // the new prediction belongs in the active filtered page; nothing is
  // inserted client-side. §19 — W4 auto-generated predictions reach the
  // exact same persisted Prediction table/endpoint, so they appear here
  // through this same canonical refetch with no special branch.
  useEffect(() => {
    if (!patientId || !lastPrediction || lastPrediction.patientId !== patientId) return
    load(true)
    clearLastPrediction()
  }, [patientId, lastPrediction, load, clearLastPrediction])

  const clearFilters = () => { setFrom(''); setTo(''); setRiskLevel('') }

  // §13 — presentation-only grouping of the CURRENT page's already
  // chronologically-ordered predictions, by business month/day. Pagination
  // is never altered here and rows are never re-sorted — a contiguous-run
  // merge only, duplicated verbatim from GlobalPredictionHistory's own
  // algorithm (see module-level comment above).
  const groups: { monthKey: string; dayKey: string; items: Prediction[] }[] = []
  for (const pred of predictions) {
    const dayKey = getBusinessDateKey(predictionClinicalInstant(pred))   // NEW S3 — clinical day
    const monthKey = dayKey.slice(0, 7)
    const last = groups[groups.length - 1]
    if (last && last.dayKey === dayKey) {
      last.items.push(pred)
    } else {
      groups.push({ monthKey, dayKey, items: [pred] })
    }
  }

  return (
    <div className="ui-content-stack">
      {/* §10 — filter controls, ported from GlobalPredictionHistory's proven
          pattern: date/select changes apply immediately, no debounce, no
          free-text search (the patient is already scoped by the route). */}
      <div className="bg-card rounded-xl border border-border p-4 space-y-2">
        <div className="flex items-end gap-2 flex-wrap">
          <WheelDatePicker label="Desde"
            id="history-from"
            compact
            className="w-full max-w-full flex-none sm:w-56"
            value={from}
            maxYear={Number(getBusinessDateKey(new Date().toISOString()).slice(0, 4))}
            max={to || undefined}
            onValueChange={setFrom}
          />
          <WheelDatePicker label="Hasta"
            id="history-to"
            compact
            className="w-full max-w-full flex-none sm:w-56"
            value={to}
            maxYear={Number(getBusinessDateKey(new Date().toISOString()).slice(0, 4))}
            min={from || undefined}
            onValueChange={setTo}
          />
          <div className="w-36 max-w-full flex-none">
            <label htmlFor="history-risk" className="mb-1 block text-xs font-medium text-muted-foreground">Nivel de riesgo</label>
            <select
              id="history-risk"
              value={riskLevel}
              onChange={e => setRiskLevel(e.target.value as PredictionRiskFilter | '')}
              className="w-full px-2.5 ui-secondary-control-density text-xs rounded-lg border border-border bg-card cursor-pointer"
            >
            <option value="">Todos los niveles</option>
            <option value="LOW">Bajo</option>
            <option value="MODERATE">Moderado</option>
              <option value="HIGH">Alto</option>
            </select>
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs text-primary hover:underline ml-auto"
            >
              Limpiar filtros
            </button>
          )}
        </div>
        {/* §11 — inline validation only; the request is simply never sent
            (see `invalidRange` guard in load() above) and current filters/
            results stay exactly as they were — no silent date swapping. */}
        {invalidRange && (
          <p className="text-[11px] text-red-600 dark:text-red-400">
            La fecha "Desde" no puede ser posterior a "Hasta".
          </p>
        )}
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="w-7 h-7 text-primary animate-spin mb-3" />
          <p className="text-sm text-muted-foreground">Cargando historial...</p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="font-medium text-red-600 dark:text-red-400">{error}</p>
          <button
            onClick={() => load()}
            className="mt-3 px-4 ui-compact-control-density text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
          >
            Reintentar
          </button>
        </div>
      ) : predictions.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-8 text-center">
          <History className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
          {/* §15 — two distinct empty states: no predictions at all for
              this patient (copy unchanged from before W5.2) vs. active
              filters producing zero matches. Never a fake row either way. */}
          {hasActiveFilters ? (
            <>
              <p className="font-medium text-foreground">Sin resultados</p>
              <p className="text-sm text-muted-foreground mt-1">
                No hay predicciones que coincidan con los filtros seleccionados.
              </p>
            </>
          ) : (
            <>
              <p className="font-medium text-foreground">Sin predicciones aún</p>
              <p className="text-sm text-muted-foreground mt-1">
                Este paciente no tiene predicciones registradas todavía
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="ui-content-stack">
          {groups.map(group => (
            <div key={group.dayKey} className="space-y-3">
              {(groups.indexOf(group) === 0 || groups[groups.indexOf(group) - 1].monthKey !== group.monthKey) && (
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {monthLabel(group.monthKey + '-01')}
                </div>
              )}
              <div className="text-[11px] font-medium text-muted-foreground">
                {/* §14 — day heading: Hoy/Ayer for the current/previous
                    business day, otherwise the absolute weekday+day style
                    (dayLabel) — never "Hoy 25". Month heading above always
                    stays absolute. */}
                {formatRelativeBusinessDate(group.dayKey, d => dayLabel(String(d))).label}
              </div>
              <div className="space-y-3">
                {group.items.map(pred => (
                  <div key={pred.id} className="bg-card rounded-xl border border-border ui-card-density">
                    <div className="flex items-start ui-element-gap">
                      <div className="flex-shrink-0 hidden sm:block">
                        <RiskGauge score={pred.riskScore} level={pred.riskLevel} size={80} showLabel={false} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <RiskBadge level={pred.riskLevel} showScore />
                          {pred.isAnomaly && (
                            <span className="text-[10px] font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60 px-2 py-0.5 rounded-full">
                              ⚠ Anomalía
                            </span>
                          )}
                        </div>
                        <div className="flex items-center ui-element-gap mt-3 text-xs text-muted-foreground flex-wrap">
                          {pred.modelVersion && (
                            <span className="flex items-center gap-1">
                              <Cpu className="w-3.5 h-3.5" />
                              Modelo {pred.modelVersion}
                            </span>
                          )}
                          <span className="flex items-center gap-1" data-testid="prediction-clinical-time">
                            <Calendar className="w-3.5 h-3.5" />
                            {/* NEW S3 — clinical time of the source record; the
                                calculation time is secondary. */}
                            {pred.healthRecord ? clinicalTimeLabel(pred.healthRecord) : `Sin registro vinculado · ${formatRelativeBusinessDateTime(pred.predictedAt)}`}
                          </span>
                          <span className="text-[11px]">Calculada {formatRelativeBusinessDateTime(pred.predictedAt)}</span>
                        </div>
                        {/* featureImportance isn't persisted on the Prediction row, so
                            it's never present on historical entries — no fallback data
                            is fabricated here (see report, INT-12 divergence). */}

                        {/* V7 — additive clinical-source context, visually
                            subordinate to the result above (collapsed by default,
                            smaller type, muted border-top separator). */}
                        <ClinicalSourceDisclosure
                          healthRecord={pred.healthRecord}
                          className="mt-3 pt-3 border-t border-border"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* §8 — server-authoritative pagination; no client-side slicing. */}
          {totalPages > 1 && (
            <div className="px-4 py-3 bg-card border border-border rounded-xl flex items-center justify-between text-xs text-muted-foreground">
              <span>Página {page} de {totalPages} · {total} {total === 1 ? 'predicción' : 'predicciones'}</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="p-1.5 rounded-lg border border-border hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="p-1.5 rounded-lg border border-border hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
