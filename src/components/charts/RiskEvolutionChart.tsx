import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, X } from 'lucide-react'
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Customized,
} from 'recharts'
import { RISK_REFERENCE_LINES } from '@/lib/riskThresholds'
import { RISK_CONFIG, cn } from '@/lib/utils'
import { BUSINESS_TIMEZONE } from '@/lib/businessDate'
import { formatClinicalDateTime, LEGACY_TIME_NOTE } from '@/lib/clinicalTime'
import { PROJECTION_COPY, formatProjectionPercent, formatTargetDate, toBadgeLevel } from '@/lib/riskProjection'
import { ORIGIN_LABEL, pointKey, type ProjectedRiskPoint, type RealRiskPoint, type RiskEvolutionModel, type RiskEvolutionRow, type RiskPoint } from '@/lib/riskEvolution'

// NEW S2E-FIX1 — "Evolución del riesgo" on a CLINICAL time axis.
//   REAL series: solid line, filled markers — risk calculated from REAL
//     clinical records, positioned at the record's clinical time.
//   PROJECTION series: dashed line, hollow markers — CURRENT projected
//     targets only. No uncertainty band (S uncertainty = NOT_QUANTIFIED).
// v1 relationship: the REAL line ends at its latest REAL point; projected
// points are joined only to each other (dashed). No synthetic cutoff point,
// no h0 and no connector between the two series (no implied observed
// transition).

export const SERIES_LABELS = {
  real: 'Riesgo real',
  projected: 'Proyección',
} as const

const SERIES_COLOR = 'hsl(var(--primary))'
const PROJECTED_DASH = '6 4'

const TICK_FORMATTER = new Intl.DateTimeFormat('es-MX', { timeZone: BUSINESS_TIMEZONE, day: '2-digit', month: 'short' })
// Axis ticks are instants rendered as Guadalajara calendar days (never the
// viewer's local day).
export const formatChartTick = (t: number) => {
  const parts = TICK_FORMATTER.formatToParts(new Date(t))
  const day = parts.find(x => x.type === 'day')?.value ?? ''
  const month = (parts.find(x => x.type === 'month')?.value ?? '').replace('.', '')
  return `${day} ${month}`
}

function RealTooltip({ p }: { p: RealRiskPoint }) {
  return (
    <>
      <p className="font-semibold">{formatProjectionPercent(p.score)} · {RISK_CONFIG[p.level].label}</p>
      {p.source === 'MEASURED' && <p>Medición: {formatClinicalDateTime(p.instant)}</p>}
      {p.source === 'LEGACY_ENTRY' && <p>Captura: {formatClinicalDateTime(p.instant)} — {LEGACY_TIME_NOTE}</p>}
      {p.source === 'UNLINKED' && <p>Sin registro clínico vinculado — fecha de la predicción: {formatClinicalDateTime(p.instant)}</p>}
      <p className="text-muted-foreground">{SERIES_LABELS.real} · {ORIGIN_LABEL[p.origin]}</p>
    </>
  )
}

function ProjectedTooltip({ p }: { p: ProjectedRiskPoint }) {
  return (
    <>
      <p className="font-semibold">{PROJECTION_COPY.primaryLabel}: {formatProjectionPercent(p.score)} · {RISK_CONFIG[toBadgeLevel(p.level)].label}</p>
      <p>{PROJECTION_COPY.targetDateLabel}: {formatTargetDate(p.targetDate)}</p>
      {p.dateState === 'PAST' && <p className="font-medium">{PROJECTION_COPY.pastTarget}</p>}
      {p.dateState === 'TODAY' && <p>{PROJECTION_COPY.todayTarget}</p>}
      <p className="text-muted-foreground">
        {SERIES_LABELS.projected} · {p.interpretation === 'INDIVIDUALIZED_BRIDGE' ? PROJECTION_COPY.interpretationTagIndividualized : PROJECTION_COPY.interpretationTagGlobal}
      </p>
    </>
  )
}

export function RiskEvolutionTooltipBody({ row }: { row: RiskEvolutionRow }) {
  return row.point.kind === 'REAL' ? <RealTooltip p={row.point} /> : <ProjectedTooltip p={row.point} />
}

function ChartTooltip({ active, payload, fontSize }: { active?: boolean; payload?: { payload: RiskEvolutionRow }[]; fontSize: number }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  return (
    <div
      className="rounded-lg border px-3 py-2 space-y-0.5"
      style={{ backgroundColor: 'hsl(var(--popover))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--popover-foreground))', fontSize }}
      data-tooltip-kind={row.point.kind}
    >
      <RiskEvolutionTooltipBody row={row} />
    </div>
  )
}

// Text legend + line/marker swatches: distinguishable without color.
export function RiskEvolutionLegend({ hasReal, hasProjected }: { hasReal: boolean; hasProjected: boolean }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground" aria-label="Leyenda de la gráfica">
      {hasReal && (
        <li className="flex items-center gap-1.5" data-legend="real">
          <svg width="28" height="10" aria-hidden="true">
            <line x1="0" y1="5" x2="28" y2="5" stroke={SERIES_COLOR} strokeWidth="2.5" />
            <circle cx="14" cy="5" r="3.5" fill={SERIES_COLOR} />
          </svg>
          {SERIES_LABELS.real}
        </li>
      )}
      {hasProjected && (
        <li className="flex items-center gap-1.5" data-legend="projected">
          <svg width="28" height="10" aria-hidden="true">
            <line x1="0" y1="5" x2="28" y2="5" stroke={SERIES_COLOR} strokeWidth="2" strokeDasharray={PROJECTED_DASH} />
            <circle cx="14" cy="5" r="3.5" fill="hsl(var(--card))" stroke={SERIES_COLOR} strokeWidth="2" />
          </svg>
          {SERIES_LABELS.projected}
        </li>
      )}
    </ul>
  )
}



// NEW S2E-FIX2 — evenly spaced axis ticks across the clinical-time domain
// (Recharts otherwise ticks at data points: dense histories repeated/overlapped
// labels). Distinct calendar days only.
export function evenTimeTicks(domain: [number, number], count: number): number[] {
  const [a, b] = domain
  const raw = count <= 1 || b <= a ? [a] : Array.from({ length: count }, (_, i) => a + ((b - a) * i) / (count - 1))
  const seen = new Set<string>()
  return raw.filter(t => { const k = formatChartTick(t); if (seen.has(k)) return false; seen.add(k); return true })
}

// Accessible name per point (REAL: risk calculated from a REAL record, its
// clinical date, %, level, origin; PROJECTION: target date, projected %, level).
export function pointAriaLabel(p: RiskPoint): string {
  if (p.kind === 'REAL') {
    const when = p.source === 'MEASURED' ? `medición ${formatClinicalDateTime(p.instant)}`
      : p.source === 'LEGACY_ENTRY' ? `captura ${formatClinicalDateTime(p.instant)}, ${LEGACY_TIME_NOTE}`
        : `sin registro clínico vinculado, fecha de la predicción ${formatClinicalDateTime(p.instant)}`
    return `Predicción con registro real, ${when}: riesgo ${formatProjectionPercent(p.score)}, ${RISK_CONFIG[p.level].label}. ${ORIGIN_LABEL[p.origin]}.`
  }
  const due = p.dateState === 'PAST' ? ` ${PROJECTION_COPY.pastTarget}.` : p.dateState === 'TODAY' ? ' Fecha objetivo: hoy, sigue siendo una proyección.' : ''
  return `Proyección, fecha objetivo estimada ${formatTargetDate(p.targetDate)}: riesgo estimado ${formatProjectionPercent(p.score)}, ${RISK_CONFIG[toBadgeLevel(p.level)].label}.${due}`
}

// ─── NEW S2E-FIX4 — point selection model ───────────────────────────────
// ONE canonical selected point per rendered chart, reachable by:
//   1. mouse click on a marker;
//   2. keyboard — a single roving tab stop on the point collection
//      (listbox/option): Tab enters at the selected point (or the default
//      anchor), Tab / Shift+Tab leave; ←/→ previous/next, Home/End first/last,
//      Enter/Space (re)select. Selection follows focus. No positive tabIndex;
//   3. four icon buttons (first / previous / next / last).
// All three use the SAME ordered collection: model.rows (chronological X;
// ties broken deterministically by the risk-evolution model).
// Boundaries stop (no wrap). The selected point's description is a floating
// box next to the marker (concise in the compact card, complete in the full
// modal); it stays until another point is chosen or it is closed, so it is
// readable without hover. While a point is selected the Recharts hover
// tooltip is suppressed, so mouse and keyboard never show two descriptions.

interface AxisLike { scale: (v: number) => number }
interface PointLayerProps {
  xAxisMap?: Record<string, AxisLike>
  yAxisMap?: Record<string, AxisLike>
  rows: RiskEvolutionRow[]
  selectedKey: string | null
  anchorKey: string | null
  describedById: string
  listLabel: string
  onPointFocus: (key: string) => void
  onPointSelect: (key: string) => void
  onPointKey: (key: string, e: React.KeyboardEvent) => void
}

// Rendered through <Customized> (receives the axis scales). Passed as an
// ELEMENT so Recharts clones it: re-renders never remount the points (focus
// is never lost while moving between them).
function PointLayer({ xAxisMap, yAxisMap, rows, selectedKey, anchorKey, describedById, listLabel, onPointFocus, onPointSelect, onPointKey }: PointLayerProps) {
  const xs = xAxisMap ? Object.values(xAxisMap)[0] : undefined
  const ys = yAxisMap ? Object.values(yAxisMap)[0] : undefined
  if (!xs || !ys) return null
  return (
    <g role="listbox" aria-label={listLabel} aria-orientation="horizontal" data-testid="risk-point-layer">
      {rows.map(row => {
        const key = pointKey(row.point)
        const x = xs.scale(row.t), y = ys.scale(row.point.score)
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null
        const selected = key === selectedKey
        return (
          <g
            key={key}
            role="option"
            aria-selected={selected}
            tabIndex={key === anchorKey ? 0 : -1}
            aria-label={pointAriaLabel(row.point)}
            aria-describedby={selected ? describedById : undefined}
            data-point-key={key}
            data-point-kind={row.point.kind}
            data-selected={selected ? 'true' : undefined}
            style={{ outline: 'none', cursor: 'pointer' }}
            onFocus={() => onPointFocus(key)}
            onClick={() => onPointSelect(key)}
            onKeyDown={e => onPointKey(key, e)}
          >
            {/* generous transparent hit target */}
            <circle data-hit="true" cx={x} cy={y} r={10} fill="transparent" />
            {selected && (
              // Selection indicator independent of colour: thick double ring + halo.
              <g data-focus-ring="true" pointerEvents="none">
                <circle cx={x} cy={y} r={13} fill="none" stroke="hsl(var(--card))" strokeWidth={5} />
                <circle cx={x} cy={y} r={11} fill="none" stroke="hsl(var(--foreground))" strokeWidth={2.5} />
              </g>
            )}
          </g>
        )
      })}
    </g>
  )
}

function NavButton({ label, disabled, onClick, children, testId }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode; testId: string }) {
  // aria-disabled (not the disabled attribute): a button that becomes
  // disabled while focused keeps focus (no focus loss to <body>, which a
  // dialog focus trap would otherwise pull back to the dialog container).
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-disabled={disabled || undefined}
      data-testid={testId}
      onClick={() => { if (!disabled) onClick() }}
      className={cn(
        'p-1.5 rounded-md border border-border text-muted-foreground transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-card',
        disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-accent hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

interface BoxPos { key: string; left: number; top: number; maxHeight: number | null; width?: number }
const RING_R = 14
const BOX_GAP = 10

interface Props {
  model: RiskEvolutionModel
  // Deep-link / calendar target: red marker (unchanged FIX1/FIX2 behaviour).
  selectedPredictionId: string | null
  textSizes: { axisTick: number; tooltip: number; refLine: number }
  height?: number
  // 'compact' → concise floating description; 'full' → complete description
  // (renderPointDetail), scrollable inside the floating box.
  variant?: 'compact' | 'full'
  chartLabel?: string
  // Point selected on first availability (full modal: the deep-linked Prediction).
  initialSelectedKey?: string | null
  renderPointDetail?: (point: RiskPoint) => ReactNode
}

export function RiskEvolutionChart({
  model, selectedPredictionId, textSizes, height = 180, variant = 'compact', chartLabel = 'Evolución del riesgo',
  initialSelectedKey = null, renderPointDetail,
}: Props) {
  const rows = model.rows
  const keys = useMemo(() => rows.map(r => pointKey(r.point)), [rows])
  const keysSig = keys.join('|')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const lastKeyRef = useRef<string | null>(null)
  const suppressFocusSelectRef = useRef(false)
  const appliedInitialRef = useRef<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [boxPos, setBoxPos] = useState<BoxPos | null>(null)
  const [layoutTick, setLayoutTick] = useState(0)
  const boxId = `${useId()}-point-description`
  const full = variant === 'full'

  const selectedIndex = selectedKey ? keys.indexOf(selectedKey) : -1
  const selectedRow = selectedIndex >= 0 ? rows[selectedIndex] : null

  // NAV16 — a refresh / patient switch / lazy history load reconciles the
  // selection: kept while its point still exists, cleared otherwise.
  useEffect(() => {
    if (selectedKey && !keys.includes(selectedKey)) setSelectedKey(null)
    if (lastKeyRef.current && !keys.includes(lastKeyRef.current)) lastKeyRef.current = null
  }, [keysSig]) // eslint-disable-line react-hooks/exhaustive-deps

  // Initial selection (full modal deep link) — applied once when it appears.
  useEffect(() => {
    if (!initialSelectedKey || appliedInitialRef.current === initialSelectedKey) return
    if (keys.includes(initialSelectedKey)) {
      appliedInitialRef.current = initialSelectedKey
      lastKeyRef.current = initialSelectedKey
      setSelectedKey(initialSelectedKey)
    }
  }, [initialSelectedKey, keysSig]) // eslint-disable-line react-hooks/exhaustive-deps

  // Roving tab stop: the selected point; else the last selected one; else the
  // deep-linked Prediction; else the latest REAL point; else the first point.
  const anchorKey = useMemo(() => {
    if (selectedKey && keys.includes(selectedKey)) return selectedKey
    if (lastKeyRef.current && keys.includes(lastKeyRef.current)) return lastKeyRef.current
    const linked = selectedPredictionId ? `r:${selectedPredictionId}` : null
    if (linked && keys.includes(linked)) return linked
    for (let i = rows.length - 1; i >= 0; i--) if (rows[i].point.kind === 'REAL') return keys[i]
    return keys[0] ?? null
  }, [selectedKey, keysSig, selectedPredictionId]) // eslint-disable-line react-hooks/exhaustive-deps

  const select = useCallback((key: string | null) => {
    if (key) lastKeyRef.current = key
    setSelectedKey(key)
  }, [])
  const focusPoint = useCallback((key: string) => {
    containerRef.current?.querySelector<SVGGElement>(`[data-point-key="${key}"]`)?.focus()
  }, [])

  const onPointKey = (key: string, e: React.KeyboardEvent) => {
    const i = keys.indexOf(key)
    let next = -1
    if (e.key === 'ArrowRight') next = Math.min(keys.length - 1, i + 1)
    else if (e.key === 'ArrowLeft') next = Math.max(0, i - 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = keys.length - 1
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(key); return }
    else return
    e.preventDefault()
    if (next < 0) return
    select(keys[next])
    focusPoint(keys[next])
  }

  const closeBox = () => {
    const key = selectedKey
    select(null)
    if (key) { suppressFocusSelectRef.current = true; focusPoint(key); suppressFocusSelectRef.current = false }
  }

  // Re-measure on size changes (responsive container, dialog resize).
  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setLayoutTick(t => t + 1))
    ro.observe(el)
    // NEW S3 — the full box is centred in the VISIBLE dialog area: follow the
    // dialog's own scrolling / resizing.
    const dlg = el.closest('[role="dialog"]') as HTMLElement | null
    const onScroll = () => setLayoutTick(t => t + 1)
    dlg?.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    if (dlg) ro.observe(dlg)
    return () => { ro.disconnect(); dlg?.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll) }
  }, [])

  // Floating box placement. Candidates: beside the marker (right / left),
  // above, below — each kept inside the chart container BELOW the navigation
  // toolbar (never clipped by an ancestor, never covering the icon buttons),
  // with an internal max-height so long content scrolls inside the box.
  // Candidates that would cover the SELECTED marker are rejected while any
  // other fits; among the rest the one hiding the fewest OTHER markers wins
  // (ties: the side facing the larger half, then above, then below).
  useLayoutEffect(() => {
    const c = containerRef.current, b = boxRef.current
    if (!selectedKey || !c || !b) { if (boxPos) setBoxPos(null); return }
    const hit = c.querySelector<SVGCircleElement>(`[data-point-key="${selectedKey}"] circle[data-hit]`)
    if (!hit) return
    const cr = c.getBoundingClientRect()
    if (full) {
      // NEW S3 — FULL detail: centred (horizontally + vertically) in the
      // visible dialog area (viewport when there is no dialog), responsive
      // width, height bounded to that area, internal scroll. Never adjacent
      // to the marker; never outside the dialog / viewport.
      const dlg = c.closest('[role="dialog"]') as HTMLElement | null
      const PAD = 16
      const area = dlg
        ? (() => { const r = dlg.getBoundingClientRect(); return { left: r.left + dlg.clientLeft, top: r.top + dlg.clientTop, width: dlg.clientWidth, height: dlg.clientHeight } })()
        : { left: 0, top: 0, width: document.documentElement.clientWidth, height: window.innerHeight }
      const width = Math.max(0, Math.min(560, area.width - 2 * PAD))
      const maxHeight = Math.max(0, area.height - 2 * PAD)
      const h = Math.min(b.scrollHeight, maxHeight)
      const r = (v: number) => Math.round(v)
      const next: BoxPos = {
        key: selectedKey, width: r(width), maxHeight: r(maxHeight),
        left: r(area.left + (area.width - width) / 2 - cr.left),
        top: r(area.top + (area.height - h) / 2 - cr.top),
      }
      if (!boxPos || boxPos.key !== next.key || boxPos.left !== next.left || boxPos.top !== next.top || boxPos.maxHeight !== next.maxHeight || boxPos.width !== next.width) setBoxPos(next)
      return
    }
    const center = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2 - cr.left, y: r.top + r.height / 2 - cr.top } }
    const { x, y } = center(hit)
    const others = Array.from(c.querySelectorAll<SVGCircleElement>('[data-point-key] circle[data-hit]')).filter(el => el !== hit).map(center)
    const navEl = c.querySelector<HTMLElement>('[data-testid="point-nav"]')
    const top0 = navEl ? navEl.offsetTop + navEl.offsetHeight + 2 : 0
    const cw = c.clientWidth, ch = c.clientHeight, bw = b.offsetWidth, natural = b.scrollHeight
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)))
    const avail = Math.max(0, ch - top0)
    // Compact: the concise box is never height-capped (it is click-through, so
    // it must show all of its few lines); it may extend past the chart bottom.
    // Full: capped to the chart area, content scrolls inside.
    const cap = (space: number) => (full ? Math.min(natural, space) : natural)
    type Cand = { left: number; top: number; h: number; maxHeight: number | null; pref: number }
    const side = (left: number, pref: number): Cand => { const h = cap(avail); return { left, top: clamp(y - h / 2, top0, full ? ch - h : Math.max(top0, ch - h)), h, maxHeight: full ? avail : null, pref } }
    const cands: Cand[] = []
    const rightFirst = x <= cw / 2
    if (x + RING_R + BOX_GAP + bw <= cw) cands.push(side(x + RING_R + BOX_GAP, rightFirst ? 0 : 1))
    if (x - RING_R - BOX_GAP - bw >= 0) cands.push(side(x - RING_R - BOX_GAP - bw, rightFirst ? 1 : 0))
    const cx = clamp(x - bw / 2, 0, cw - bw)
    const above = Math.floor(y - RING_R - BOX_GAP - top0), below = Math.floor(ch - (y + RING_R + BOX_GAP))
    const minUseful = full ? Math.min(natural, 96) : natural
    if (above >= minUseful) { const h = Math.min(natural, above); cands.push({ left: cx, top: y - RING_R - BOX_GAP - h, h, maxHeight: full ? above : null, pref: 2 }) }
    if (below >= minUseful) { const h = Math.min(natural, below); cands.push({ left: cx, top: y + RING_R + BOX_GAP, h, maxHeight: full ? below : null, pref: 3 }) }
    // Compact card only: when nothing else fits, float BELOW the marker past
    // the chart's bottom edge (over the legend / next content) rather than
    // covering the selected marker. Never inside the dialog (its scroll
    // container would grow).
    if (!full) cands.push({ left: cx, top: y + RING_R + BOX_GAP, h: natural, maxHeight: null, pref: 4 })
    let chosen: Cand
    if (cands.length === 0) {
      // No room anywhere: cover is unavoidable (very small charts).
      const h = Math.min(natural, avail)
      chosen = { left: cx, top: clamp(y - h / 2, top0, ch - h), h, maxHeight: avail, pref: 9 }
    } else {
      const hidden = (k: Cand) => others.filter(o => o.x >= k.left - 6 && o.x <= k.left + bw + 6 && o.y >= k.top - 6 && o.y <= k.top + k.h + 6).length
      // full → show as much of the complete description as possible first
      // (60 px buckets), then hide the fewest other markers; compact → stay
      // inside the chart when possible, then hide the fewest other markers.
      const outside = (k: Cand) => (k.top + k.h > ch + 1 ? 1 : 0)
      const key = (k: Cand) => (full ? [-Math.floor(k.h / 60), hidden(k), k.pref] : [outside(k), hidden(k), k.pref])
      chosen = [...cands].sort((p, q) => { const a = key(p), b = key(q); for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0 })[0]
    }
    const r = (v: number) => Math.round(v)
    const next: BoxPos = { key: selectedKey, left: r(chosen.left), top: r(chosen.top), maxHeight: chosen.maxHeight == null ? null : Math.max(0, r(chosen.maxHeight)) }
    if (!boxPos || boxPos.key !== next.key || boxPos.left !== next.left || boxPos.top !== next.top || boxPos.maxHeight !== next.maxHeight) setBoxPos(next)
  })
  void layoutTick

  if (!model.domain) return null
  const ticks = evenTimeTicks(model.domain, height >= 300 ? 7 : 5)
  const n = keys.length
  const atFirst = selectedIndex <= 0, atLast = selectedIndex < 0 || selectedIndex >= n - 1
  const go = (i: number) => select(keys[Math.max(0, Math.min(n - 1, i))])
  const detail = selectedRow && full && renderPointDetail ? renderPointDetail(selectedRow.point) : null

  return (
    <div ref={containerRef} data-testid="risk-evolution-chart" data-variant={variant} data-real-points={model.real.length} data-projected-points={model.projected.length} className="relative">
      <div className="flex items-center justify-end gap-1 mb-1" role="group" aria-label={`Navegación de la gráfica: ${chartLabel}`} data-testid="point-nav">
        <span className="text-[11px] text-muted-foreground mr-1 tabular-nums" data-testid="point-position">
          {selectedIndex >= 0 ? `${selectedIndex + 1} de ${n}` : `${n}`}
        </span>
        <NavButton testId="nav-first" label="Ir al primero" disabled={n === 0 || selectedIndex === 0} onClick={() => go(0)}><ChevronsLeft className="w-3.5 h-3.5" aria-hidden="true" /></NavButton>
        <NavButton testId="nav-prev" label="Ir al anterior" disabled={atFirst} onClick={() => go(selectedIndex - 1)}><ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" /></NavButton>
        <NavButton testId="nav-next" label="Ir al siguiente" disabled={atLast} onClick={() => go(selectedIndex + 1)}><ChevronRight className="w-3.5 h-3.5" aria-hidden="true" /></NavButton>
        <NavButton testId="nav-last" label="Ir al último" disabled={n === 0 || selectedIndex === n - 1} onClick={() => go(n - 1)}><ChevronsRight className="w-3.5 h-3.5" aria-hidden="true" /></NavButton>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={rows}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="t" type="number" scale="time" domain={model.domain}
            ticks={ticks} interval="preserveStartEnd" minTickGap={12}
            tickFormatter={formatChartTick}
            tick={{ fontSize: textSizes.axisTick, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false}
          />
          <YAxis
            domain={[0, 1]}
            tickFormatter={v => `${(v * 100).toFixed(0)}%`}
            tick={{ fontSize: textSizes.axisTick, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false}
          />
          {/* Hover description only while nothing is selected (no competing boxes). */}
          <Tooltip cursor={!selectedRow} content={selectedRow ? () => null : <ChartTooltip fontSize={textSizes.tooltip} />} />
          {/* Display-only thresholds (lib/riskThresholds.ts); no point is reclassified. */}
          {RISK_REFERENCE_LINES.map(line => (
            <ReferenceLine key={line.startsLevel} y={line.value} stroke={line.color} strokeDasharray="4 4"
              label={{ value: line.label, fill: line.color, fontSize: textSizes.refLine }} />
          ))}
          {/* Series A — REAL: solid stroke, filled markers. */}
          <Line
            type="monotone" dataKey="real" name={SERIES_LABELS.real} connectNulls isAnimationActive={false}
            stroke={SERIES_COLOR} strokeWidth={2.5}
            dot={(d: { cx?: number; cy?: number; payload?: RiskEvolutionRow; index?: number }) => {
              const pt = d.payload?.point
              if (!pt || pt.kind !== 'REAL' || d.cx == null || d.cy == null) return <g key={`r-none-${d.index}`} />
              const isLinked = pt.predictionId === selectedPredictionId
              return (
                <circle key={`r-${pt.predictionId}`} data-series="real" data-source={pt.source}
                  cx={d.cx} cy={d.cy} r={isLinked ? 7 : 4}
                  fill={isLinked ? '#DC2626' : SERIES_COLOR} stroke="hsl(var(--card))" strokeWidth={isLinked ? 3 : 2} />
              )
            }}
            activeDot={selectedRow ? false : { r: 6 }}
          />
          {/* Series B — PROJECTION: dashed stroke, hollow markers. */}
          <Line
            type="linear" dataKey="projected" name={SERIES_LABELS.projected} connectNulls isAnimationActive={false}
            stroke={SERIES_COLOR} strokeWidth={2} strokeDasharray={PROJECTED_DASH}
            dot={(d: { cx?: number; cy?: number; payload?: RiskEvolutionRow; index?: number }) => {
              const pt = d.payload?.point
              if (!pt || pt.kind !== 'PROJECTION' || d.cx == null || d.cy == null) return <g key={`p-none-${d.index}`} />
              return (
                <circle key={`p-${pt.horizonIndex}`} data-series="projected" data-date-state={pt.dateState}
                  cx={d.cx} cy={d.cy} r={4.5} fill="hsl(var(--card))" stroke={SERIES_COLOR} strokeWidth={2} />
              )
            }}
            activeDot={selectedRow ? false : { r: 6, fill: 'hsl(var(--card))', stroke: SERIES_COLOR, strokeWidth: 2 }}
          />
          <Customized
            component={
              <PointLayer
                rows={rows}
                selectedKey={selectedRow ? selectedKey : null}
                anchorKey={anchorKey}
                describedById={boxId}
                listLabel={`Puntos de la gráfica: ${chartLabel}. Flechas izquierda y derecha para recorrerlos, Inicio y Fin para el primero y el último.`}
                onPointFocus={key => {
                  if (suppressFocusSelectRef.current) return
                  select(key)
                }}
                onPointSelect={key => select(key)}
                onPointKey={onPointKey}
              />
            }
          />
        </ComposedChart>
      </ResponsiveContainer>
      {selectedRow && (
        // The description of the selected point: a floating box associated
        // with the marker (aria-describedby on the selected option). Not a
        // live region: arrowing quickly never spams announcements, and focus
        // never jumps into it.
        <div
          ref={boxRef}
          id={boxId}
          role="group"
          aria-label="Descripción del punto seleccionado"
          data-testid="risk-point-box"
          data-box-kind={selectedRow.point.kind}
          data-box-variant={variant}
          tabIndex={full ? 0 : undefined}
          // NEW S3 — point navigation keeps working while the (centred) full
          // box has focus: ←/→/Home/End move the selection; ↑/↓ scroll the box.
          onKeyDown={full ? e => {
            const map: Record<string, number> = { ArrowLeft: selectedIndex - 1, ArrowRight: selectedIndex + 1, Home: 0, End: n - 1 }
            if (!(e.key in map)) return
            e.preventDefault()
            if (map[e.key] >= 0 && map[e.key] <= n - 1) go(map[e.key])
          } : undefined}
          className={cn(
            'absolute z-20 rounded-lg border shadow-lg overflow-y-auto overscroll-contain',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
            // Compact box is click-through (only its close button is
            // interactive) so markers under it stay clickable; the full box
            // keeps pointer events for scrolling its complete content.
            full ? 'p-4 z-30' : 'w-[17rem] max-w-[calc(100%-0.5rem)] px-3 py-2 pointer-events-none',
          )}
          style={{
            left: boxPos?.key === selectedKey ? boxPos.left : 0,
            top: boxPos?.key === selectedKey ? boxPos.top : 0,
            maxHeight: boxPos?.key === selectedKey && boxPos.maxHeight != null ? boxPos.maxHeight : undefined,
            width: full ? (boxPos?.key === selectedKey && boxPos.width ? boxPos.width : 560) : undefined,
            visibility: boxPos?.key === selectedKey ? 'visible' : 'hidden',
            backgroundColor: 'hsl(var(--popover))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--popover-foreground))', fontSize: textSizes.tooltip,
          }}
        >
          <div className="flex items-start justify-between gap-2 mb-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {full
                ? (selectedRow.point.kind === 'REAL' ? 'Riesgo real' : 'Proyección')
                : (selectedRow.point.kind === 'REAL' ? 'Riesgo real' : 'Proyección')}
              <span className="ml-1 font-normal normal-case tracking-normal">· {selectedIndex + 1}/{n}</span>
            </p>
            {full && (
              // Mouse navigation inside the centred box (the chart's own icon
              // buttons may sit underneath it).
              <span className="flex items-center gap-1 -mt-0.5 ml-auto" data-testid="box-nav">
                <button type="button" aria-label="Punto anterior" title="Punto anterior" aria-disabled={selectedIndex <= 0 || undefined} onClick={() => { if (selectedIndex > 0) go(selectedIndex - 1) }}
                  className={cn('p-0.5 rounded text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary', selectedIndex <= 0 ? 'opacity-40 cursor-not-allowed' : 'hover:text-foreground hover:bg-accent')}>
                  <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
                <button type="button" aria-label="Punto siguiente" title="Punto siguiente" aria-disabled={selectedIndex >= n - 1 || undefined} onClick={() => { if (selectedIndex < n - 1) go(selectedIndex + 1) }}
                  className={cn('p-0.5 rounded text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary', selectedIndex >= n - 1 ? 'opacity-40 cursor-not-allowed' : 'hover:text-foreground hover:bg-accent')}>
                  <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </span>
            )}
            <button
              type="button"
              onClick={closeBox}
              aria-label="Cerrar descripción del punto"
              title="Cerrar descripción del punto"
              className="pointer-events-auto -mt-0.5 -mr-1 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
          {detail ?? <div className="space-y-0.5"><RiskEvolutionTooltipBody row={selectedRow} /></div>}
        </div>
      )}
      <RiskEvolutionLegend hasReal={model.real.length > 0} hasProjected={model.projected.length > 0} />
    </div>
  )
}
