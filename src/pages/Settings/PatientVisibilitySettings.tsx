import { useState, useEffect, useCallback, useRef } from 'react'
import { isAxiosError } from 'axios'
import { Loader2, RotateCcw, EyeOff, Eye, ChevronLeft, ChevronRight, Search, Users } from 'lucide-react'
import { cn, calcAge, sexLabel } from '@/lib/utils'
import { SettingsSection } from '@/components/settings/SettingsSection'
import { Dialog } from '@/components/ui/Dialog'
import { useActionNotify } from '@/context/ToastContext'
import { patientService } from '@/services/patientService'
import type { HiddenPatientSummary, PatientVisibilitySummary } from '@/types'

// Z8 §15/§16/§17/§18/§19 — Settings -> Pacientes. The ONE normal
// Doctor-facing surface intended specifically to manage hidden patients
// (§15). This page never exposes clinical history (§16) — it reads/writes
// visibility only, through the dedicated visibility-management endpoints,
// which are the one deliberate exception allowed to resolve a hidden
// patient (§26).
//
// Terminology is exactly Mostrar/Ocultar (§2) — never
// Eliminar/Borrar/Restaurar eliminado/Papelera.

const HIDDEN_PAGE_LIMIT = 10

export default function PatientVisibilitySettings() {
  const { notifySuccess, notifyError } = useActionNotify()

  // ── Summary counts ──────────────────────────────────────────────────────
  const [summary, setSummary] = useState<PatientVisibilitySummary | null>(null)
  const [summaryLoadState, setSummaryLoadState] = useState<'loading' | 'error' | 'ready'>('loading')

  // ── Hidden list (paginated/searchable) ──────────────────────────────────
  const [hiddenPatients, setHiddenPatients] = useState<HiddenPatientSummary[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [listLoadState, setListLoadState] = useState<'loading' | 'error' | 'ready'>('loading')

  // Debounce search, same 350ms convention as PatientsPage.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 350)
    return () => clearTimeout(t)
  }, [searchInput])

  // X2-FIX1-style staleness guard — same established pattern as
  // usePatients.ts, since this page issues its own overlapping requests
  // (page/search changes, plus refetches after mutations).
  const requestIdRef = useRef(0)

  const loadAll = useCallback(() => {
    const requestId = ++requestIdRef.current
    setSummaryLoadState('loading')
    setListLoadState('loading')
    Promise.all([
      patientService.getVisibilitySummary(),
      patientService.listHidden({ page, limit: HIDDEN_PAGE_LIMIT, search: search || undefined }),
    ]).then(([summaryResult, listResult]) => {
      if (requestId !== requestIdRef.current) return
      setSummary(summaryResult)
      setSummaryLoadState('ready')
      setHiddenPatients(listResult.data)
      setTotal(listResult.total)
      setTotalPages(listResult.totalPages)
      setListLoadState('ready')
    }).catch(() => {
      if (requestId !== requestIdRef.current) return
      setSummaryLoadState('error')
      setListLoadState('error')
    })
  }, [page, search])

  useEffect(loadAll, [loadAll])

  // ── Individual "Mostrar" ────────────────────────────────────────────────
  // §22 — reversible operation, no strong confirmation needed; fires
  // directly. One ActionNotification per row, never a persisted Alert.
  const [rowBusyId, setRowBusyId] = useState<string | null>(null)
  const handleShow = async (patient: HiddenPatientSummary) => {
    if (rowBusyId) return
    setRowBusyId(patient.id)
    try {
      await patientService.setVisibility(patient.id, false)
      notifySuccess(`${patient.firstName} ${patient.lastName} vuelve a mostrarse.`)
      loadAll()
    } catch (err) {
      if (isAxiosError(err) && err.response?.data?.error) {
        notifyError(err.response.data.error)
      } else {
        notifyError('No se pudo mostrar al paciente. Intenta de nuevo.')
      }
    } finally {
      setRowBusyId(null)
    }
  }

  // ── Bulk hide / show ─────────────────────────────────────────────────────
  // §19/§20/§23 — one ActionNotification per bulk call, never one per
  // patient; affectedCount=0 uses the same neutral feedback as any other
  // success path (a plain, honest "0 pacientes" message, not an error).
  const [bulkBusy, setBulkBusy] = useState(false)
  const [confirmBulkHideOpen, setConfirmBulkHideOpen] = useState(false)
  const [confirmBulkShowOpen, setConfirmBulkShowOpen] = useState(false)

  const handleBulkHide = async () => {
    setBulkBusy(true)
    try {
      const { affectedCount } = await patientService.bulkSetVisibility(true)
      setConfirmBulkHideOpen(false)
      notifySuccess(
        affectedCount === 0
          ? 'No había pacientes inactivos visibles por ocultar.'
          : `${affectedCount} ${affectedCount === 1 ? 'paciente inactivo fue ocultado' : 'pacientes inactivos fueron ocultados'}.`,
      )
      loadAll()
    } catch (err) {
      if (isAxiosError(err) && err.response?.data?.error) {
        notifyError(err.response.data.error)
      } else {
        notifyError('No se pudo ocultar a los pacientes inactivos. Intenta de nuevo.')
      }
    } finally {
      setBulkBusy(false)
    }
  }

  const handleBulkShow = async () => {
    setBulkBusy(true)
    try {
      const { affectedCount } = await patientService.bulkSetVisibility(false)
      setConfirmBulkShowOpen(false)
      notifySuccess(
        affectedCount === 0
          ? 'No había pacientes ocultos por mostrar.'
          : `${affectedCount} ${affectedCount === 1 ? 'paciente volvió a mostrarse' : 'pacientes volvieron a mostrarse'}.`,
      )
      loadAll()
    } catch (err) {
      if (isAxiosError(err) && err.response?.data?.error) {
        notifyError(err.response.data.error)
      } else {
        notifyError('No se pudo mostrar a los pacientes ocultos. Intenta de nuevo.')
      }
    } finally {
      setBulkBusy(false)
    }
  }

  return (
    // PRE-R2E §10 — `allowOverflow` opts this one SettingsSection out of
    // its normal `overflow-hidden` wrapper, which would otherwise silently
    // defeat `position: sticky` on the search bar below by making THIS
    // card (not the window) its sticky containing block — see
    // SettingsSection.tsx's own comment on the prop for the full
    // reasoning. Nothing in this page's content touches the card's edge,
    // so this has no visible effect beyond re-enabling sticky.
    <SettingsSection title="Pacientes" allowOverflow>
      <div className="ui-content-stack">
        {/* ── Counts + bulk actions ──────────────────────────────────────── */}
        {summaryLoadState === 'loading' ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="w-4 h-4 animate-spin" />
            Cargando resumen...
          </div>
        ) : summaryLoadState === 'error' || !summary ? (
          <div className="flex items-center justify-between gap-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 rounded-lg px-3 py-2.5">
            <p className="text-xs text-red-700 dark:text-red-300">No se pudo cargar el resumen de visibilidad.</p>
            <button
              type="button"
              onClick={loadAll}
              className="flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-300 hover:text-red-800 dark:hover:text-red-300 flex-shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reintentar
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-background rounded-lg border border-border px-4 py-3 text-center">
                <p className="text-2xl font-bold text-foreground">{summary.visibleInactive}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Inactivos visibles</p>
              </div>
              <div className="bg-background rounded-lg border border-border px-4 py-3 text-center">
                <p className="text-2xl font-bold text-foreground">{summary.hiddenInactive}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Inactivos ocultos</p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={() => setConfirmBulkHideOpen(true)}
                disabled={bulkBusy}
                className="flex-1 flex items-center justify-center gap-2 px-4 ui-compact-control-density rounded-lg text-sm font-medium border border-amber-700 dark:border-amber-800/60 text-amber-700 dark:text-amber-300 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/15 dark:hover:bg-amber-950/60 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <EyeOff className="w-4 h-4 text-amber-700 dark:text-amber-300" />
                Ocultar todos los pacientes inactivos
              </button>
              <button
                type="button"
                onClick={() => setConfirmBulkShowOpen(true)}
                disabled={bulkBusy}
                className="flex-1 flex items-center justify-center gap-2 px-4 ui-compact-control-density rounded-lg text-sm font-medium border border-teal-700 dark:border-teal-800/60 text-teal-700 dark:text-teal-300 bg-teal-50 hover:bg-teal-100 dark:bg-teal-950/15 dark:hover:bg-teal-950/60 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <Eye className="w-4 h-4 text-teal-700 dark:text-teal-300" />
                Mostrar todos los pacientes ocultos
              </button>
            </div>
          </>
        )}

        {/* ── Hidden list ──────────────────────────────────────────────────── */}
        <div className="pt-2 border-t border-border">
          <p className="text-sm font-medium text-foreground mb-2">Pacientes ocultos</p>

          {/* PRE-R2E §10 — sticky. bg-card matches this SettingsSection's
              own card background (not the page's bg-background) so nothing
              mismatches once this detaches from normal flow while stuck;
              see the allowOverflow note above for why sticky works here at
              all.
              PRE-R2E-FIX3 — `bg-card` → `bg-card/80`, matching Topbar's
              translucent treatment (same card token family, just with the
              shared alpha); blur centralized in `.ui-sticky-toolbar`. */}
          {/* Tailwind's `relative` utility (layer: utilities) would
              silently win the `position` cascade over `.ui-sticky-toolbar`
              (layer: components) if both were applied to this same
              element, defeating the sticky entirely — `position: sticky`
              is itself a "positioned" value, so it already provides the
              Search icon below a valid containing block on its own; no
              separate `relative` is needed or used here. */}
          <div
            className="ui-sticky-toolbar mb-3 bg-card/80 border-b border-border"
            style={{ paddingTop: 'var(--ui-secondary-control-padding-y)', paddingBottom: 'var(--ui-secondary-control-padding-y)' }}
          >
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="Buscar por nombre o CURP..."
              className="w-full pl-9 pr-4 ui-control-density text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
            />
          </div>

          <div className="border border-border rounded-lg overflow-hidden">
            {listLoadState === 'loading' ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" />
                Cargando pacientes ocultos...
              </div>
            ) : listLoadState === 'error' ? (
              <div className="flex items-center justify-between gap-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 px-3 py-2.5">
                <p className="text-xs text-red-700 dark:text-red-300">No se pudo cargar la lista de pacientes ocultos.</p>
                <button
                  type="button"
                  onClick={loadAll}
                  className="flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-300 hover:text-red-800 dark:hover:text-red-300 flex-shrink-0"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reintentar
                </button>
              </div>
            ) : hiddenPatients.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Users className="w-8 h-8 text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">
                  {search ? `No hay pacientes ocultos que coincidan con "${search}"` : 'No hay pacientes ocultos'}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {hiddenPatients.map(patient => (
                  <div key={patient.id} className="flex items-center justify-between gap-3 px-4 ui-row-density">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">
                        {patient.firstName} {patient.lastName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {calcAge(patient.birthDate)} años · {sexLabel(patient.sex)}
                        {patient.curp && <span className="font-mono"> · {patient.curp}</span>}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleShow(patient)}
                      disabled={rowBusyId !== null}
                      className="flex items-center gap-1.5 text-xs font-medium text-primary hover:bg-primary/10 px-2.5 ui-secondary-control-density rounded-lg transition-colors flex-shrink-0 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {rowBusyId === patient.id && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      Mostrar
                    </button>
                  </div>
                ))}
              </div>
            )}
            {listLoadState === 'ready' && hiddenPatients.length > 0 && (
              <div className={cn(
                'px-4 ui-table-header-density border-t border-border',
                'flex items-center justify-between text-xs text-muted-foreground',
              )}>
                <span>Página {page} de {totalPages} · {total} ocultos en total</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="rounded-lg border border-border hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ padding: 'var(--ui-secondary-control-padding-y)' }}
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="rounded-lg border border-border hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ padding: 'var(--ui-secondary-control-padding-y)' }}
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* §23 — bulk hide requires confirmation with the count when available. */}
      <Dialog
        open={confirmBulkHideOpen}
        onOpenChange={setConfirmBulkHideOpen}
        title="¿Ocultar todos los pacientes inactivos?"
        description={
          summary
            ? `Se ocultarán ${summary.visibleInactive} ${summary.visibleInactive === 1 ? 'paciente inactivo' : 'pacientes inactivos'}. Su información clínica permanecerá almacenada, desaparecerán de las vistas normales y podrás volver a mostrarlos más tarde.`
            : 'Su información clínica permanecerá almacenada, desaparecerán de las vistas normales y podrás volver a mostrarlos más tarde.'
        }
        preventClose={bulkBusy}
      >
        <div className="flex justify-end gap-2 mt-2">
          <button
            onClick={() => setConfirmBulkHideOpen(false)}
            disabled={bulkBusy}
            className="px-4 ui-compact-control-density text-sm font-medium rounded-lg border border-border hover:bg-accent transition-colors disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            onClick={handleBulkHide}
            disabled={bulkBusy}
            className="flex items-center gap-2 px-4 ui-compact-control-density text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {bulkBusy && <Loader2 className="w-4 h-4 animate-spin" />}
            Ocultar todos
          </button>
        </div>
      </Dialog>

      {/* §23 — bulk show may use a lighter confirmation (non-destructive,
          fully reversible either way). */}
      <Dialog
        open={confirmBulkShowOpen}
        onOpenChange={setConfirmBulkShowOpen}
        title="¿Mostrar todos los pacientes ocultos?"
        description="Volverán a aparecer en las vistas de Inactivos y Todos."
        preventClose={bulkBusy}
      >
        <div className="flex justify-end gap-2 mt-2">
          <button
            onClick={() => setConfirmBulkShowOpen(false)}
            disabled={bulkBusy}
            className="px-4 ui-compact-control-density text-sm font-medium rounded-lg border border-border hover:bg-accent transition-colors disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            onClick={handleBulkShow}
            disabled={bulkBusy}
            className="flex items-center gap-2 px-4 ui-compact-control-density text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {bulkBusy && <Loader2 className="w-4 h-4 animate-spin" />}
            Mostrar todos
          </button>
        </div>
      </Dialog>
    </SettingsSection>
  )
}
