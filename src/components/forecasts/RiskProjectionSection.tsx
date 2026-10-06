import { CalendarClock, Info, Loader2, Telescope } from 'lucide-react'
import { RiskBadge } from '@/components/ui/RiskBadge'
import { getTodayBusinessDateKey } from '@/lib/businessDate'
import { formatClinicalDateTime } from '@/lib/clinicalTime'
import {
  PROJECTION_COPY as C, describeProjectionResponse, formatClinicalDay, formatProjectionPercent,
  formatTargetDate, globalFallbackInfo, targetDateState, toBadgeLevel, projectionAssumptionCopy, cadenceCopy,
} from '@/lib/riskProjection'
import type { ForecastLoadState } from '@/hooks/useCurrentRiskForecast'
import type { RiskProjection, RiskProjectionSet } from '@/types'

// NEW S2E — "Proyección de riesgo cardiovascular". A section of its own,
// visually and textually separate from observed risk (gauge / Evolución del
// riesgo / Predictions) and from Alerts. CURRENT set only (A10: no history UI).
// No "calculate" button: S2D orchestrates automatically; this only reads.

// ─── section ────────────────────────────────────────────────────────────
// NEW S2E-FIX1 — no longer owns a fetch/socket consumer: PatientDetailPage
// calls useCurrentRiskForecast ONCE and passes the same load state to this
// section and to "Evolución del riesgo", so one risk_forecasts_changed
// invalidation produces one coherent refresh for both.
// NEW S2E-FIX2 — rendered inside the projection-detail modal (no longer a
// permanent block on the patient page); `embedded` drops the duplicate
// heading because the dialog title already names it.
export function RiskProjectionSection({ state, embedded = false }: { state: ForecastLoadState; embedded?: boolean }) {
  return <RiskProjectionPanel state={state} todayKey={getTodayBusinessDateKey()} embedded={embedded} />
}

// ─── presentation (pure; rendered directly by the S2E harness) ───────────
export function RiskProjectionPanel({ state, todayKey, embedded = false }: { state: ForecastLoadState; todayKey: string; embedded?: boolean }) {
  const refreshing = state.phase === 'ready' && state.refreshing
  return (
    <section
      aria-labelledby={embedded ? undefined : 'risk-projection-title'}
      aria-label={embedded ? C.sectionTitle : undefined}
      aria-busy={state.phase === 'loading' || refreshing}
      data-testid="risk-projection-section"
      className={embedded ? '' : 'bg-card rounded-xl border border-dashed border-primary/40 ui-card-density'}
    >
      <div className="flex items-start justify-between gap-2 flex-wrap mb-1">
        {embedded ? <span /> : (
          <h3 id="risk-projection-title" className="font-semibold text-foreground flex items-center gap-2">
            <Telescope className="w-4 h-4 text-primary" aria-hidden="true" />
            {C.sectionTitle}
          </h3>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-4">{C.intro}</p>

      {state.phase === 'loading' && (
        <div className="flex items-center justify-center py-8" role="status">
          <Loader2 className="w-5 h-5 text-primary animate-spin" aria-hidden="true" />
          <span className="sr-only">Cargando proyección…</span>
        </div>
      )}

      {state.phase === 'error' && (
        <p className="text-sm text-red-600 dark:text-red-400 text-center py-4" data-state="api-error">{state.message}</p>
      )}

      {state.phase === 'ready' && <ReadyBody state={state} todayKey={todayKey} />}
    </section>
  )
}

function ReadyBody({ state, todayKey }: { state: Extract<ForecastLoadState, { phase: 'ready' }>; todayKey: string }) {
  const model = describeProjectionResponse(state.response)
  return (
    <div className="ui-content-stack">
      {state.refreshing && (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5" role="status">
          <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> {C.refreshing}
        </p>
      )}
      {model.versionStale && (
        <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-lg px-3 py-2 flex items-start gap-2" data-state="version-stale">
          <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" aria-hidden="true" />
          {C.stale}
        </p>
      )}
      {model.kind === 'MESSAGE' ? (
        <div className="text-center py-4" data-state="message">
          <p className="text-sm text-foreground font-medium">{model.message.title}</p>
          {model.message.body.map((line, i) => (
            <p key={i} className="text-xs text-muted-foreground mt-1">{line}</p>
          ))}
        </div>
      ) : (
        <ProjectionsBody set={model.set} projections={model.projections} todayKey={todayKey} />
      )}
    </div>
  )
}

function ProjectionsBody({ set, projections, todayKey }: { set: RiskProjectionSet; projections: RiskProjection[]; todayKey: string }) {
  const individualized = set.riskInterpretation === 'INDIVIDUALIZED_BRIDGE'
  const fallbackInfo = individualized ? null : globalFallbackInfo(set.rBridgeReason)
  const anyCigsForcedZero = projections.some(p => p.assumptionFlags?.cigsForcedZero)
  return (
    <>
      {/* NEW S3 — future-state assumption (robust trend of REAL history;
          old S-FEAT-LOCF-1 sets keep a truthful "previous policy" note). */}
      <p className="text-xs text-foreground bg-muted/50 border border-border rounded-lg px-3 py-2" data-copy="assumption">
        {projectionAssumptionCopy(set, formatClinicalDay)}
      </p>

      <ol className="grid grid-cols-1 sm:grid-cols-3 gap-3" aria-label="Fechas objetivo de la proyección">
        {projections.map(p => {
          const dateState = targetDateState(p.targetDate, todayKey)
          return (
            <li key={p.horizonIndex} className="min-w-0 rounded-xl border border-border bg-background/40 p-3 flex flex-col gap-1.5" data-horizon={p.horizonIndex} data-date-state={dateState}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{C.horizon(p.horizonIndex)}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground">
                  {individualized ? C.interpretationTagIndividualized : C.interpretationTagGlobal}
                </span>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <CalendarClock className="w-3 h-3" aria-hidden="true" />{C.targetDateLabel}
                </p>
                <p className="text-sm font-semibold text-foreground">{formatTargetDate(p.targetDate)}</p>
                {dateState === 'PAST' && (
                  <p className="text-[11px] font-medium text-amber-700 dark:text-amber-300 mt-0.5">{C.pastTarget}</p>
                )}
                {dateState === 'TODAY' && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">{C.todayTarget}</p>
                )}
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">{C.primaryLabel}</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-2xl font-bold font-mono text-foreground">{formatProjectionPercent(p.finalRiskScore)}</span>
                  {/* Backend riskLevel is authoritative; text label, not color only. */}
                  <RiskBadge level={toBadgeLevel(p.riskLevel)} size="sm" />
                </div>
                {individualized && p.globalRiskScore !== p.finalRiskScore && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">{C.globalBaseline(formatProjectionPercent(p.globalRiskScore))}</p>
                )}
              </div>
            </li>
          )
        })}
      </ol>

      {set.generation.status === 'GENERATED_PARTIAL' && (
        <p className="text-xs text-muted-foreground" data-state="partial">{C.partial(projections.length)}</p>
      )}

      <div className="text-xs text-muted-foreground space-y-1">
        <p className="text-foreground" data-copy="interpretation">{individualized ? C.individualized : C.global}</p>
        {fallbackInfo && (
          // Ordinary bridge absence: subtle information, never an error.
          <p className="flex items-start gap-1.5" data-state="global-fallback-info">
            <Info className="w-3 h-3 flex-shrink-0 mt-0.5" aria-hidden="true" />{fallbackInfo}
          </p>
        )}
        {anyCigsForcedZero && <p>{C.cigsForcedZero}</p>}
        {/* NEW S4 — multimodal: "Frecuencia multimodal detectada" + projected intervals; never one fake cadence. */}
        {cadenceCopy(set.cadence)?.map((line, i) => <p key={i} data-copy="cadence">Frecuencia: {line}</p>)}
        <p>Incertidumbre: {C.uncertainty}</p>
        <p>{C.computedAt(formatClinicalDateTime(set.createdAt))}</p>
      </div>
    </>
  )
}
