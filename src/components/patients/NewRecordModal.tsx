import { useState, useEffect, useRef } from 'react'
import { Save } from 'lucide-react'
import { isAxiosError } from 'axios'
import { Dialog } from '@/components/ui/Dialog'
import { cn, calcAge } from '@/lib/utils'
import { recordService } from '@/services/recordService'
import { useActionNotify } from '@/context/ToastContext'
import type { HealthRecord, CreateHealthRecordRequest } from '@/types'

const inputClass = cn(
  'w-full px-3 py-2 text-sm rounded-lg border border-border bg-card',
  'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary',
  'transition-all placeholder:text-muted-foreground',
)

interface RecordFormState {
  currentSmoker: boolean
  cigsPerDay: string
  bpMeds: boolean
  diabetes: boolean
  totChol: string
  sysBP: string
  diaBP: string
  bmi: string
  heartRate: string
  glucose: string
  notes: string
}

// U3.2 — same blank defaults as the previous inline form's RECORD_INITIAL,
// used only when the patient has no prior HealthRecord to prefill from.
const BLANK_FORM: RecordFormState = {
  currentSmoker: false, cigsPerDay: '0', bpMeds: false, diabetes: false,
  totChol: '', sysBP: '', diaBP: '', bmi: '', heartRate: '', glucose: '',
  notes: '',
}

// U4.2A — local age calculation moved to the shared frontend helper
// (lib/utils.ts::calcAge) — this component no longer keeps its own copy.

function prefillFromLatest(latest: HealthRecord): RecordFormState {
  // Nullish-safe (`??`, never `||`) — 0/false are legitimate persisted
  // values that `||` would incorrectly discard.
  return {
    currentSmoker: latest.currentSmoker ?? false,
    cigsPerDay: String(latest.cigsPerDay ?? 0),
    bpMeds: latest.bpMeds ?? false,
    diabetes: latest.diabetes ?? false,
    totChol: String(latest.totChol),
    sysBP: String(latest.sysBP),
    diaBP: String(latest.diaBP),
    bmi: String(latest.bmi),
    heartRate: String(latest.heartRate),
    glucose: String(latest.glucose),
    notes: latest.notes ?? '',
  }
}

interface NewRecordModalProps {
  patientId: string
  birthDate: string
  open: boolean
  onOpenChange: (open: boolean) => void
  // Reuses the exact Q3 insertion pattern already validated in
  // PatientDetailPage — this modal never owns/refetches the history array
  // itself, it only hands the persisted record back to its owner.
  onCreated: (record: HealthRecord) => void
  // W4.2 — additive, optional. When the caller passes this prop AT ALL
  // (`!== undefined`, including an explicit `null` meaning "no prior record
  // to prefill from"), it wins over this modal's own internal
  // recordService.getLatest(patientId) auto-fetch below — no network
  // request is made, no race is possible. When the prop is omitted
  // entirely (PatientDetailPage's existing usage), behavior is byte-for-
  // byte unchanged from before W4.2: the internal fetch runs exactly as it
  // always has. Precedence: explicit prefillRecord > internal auto-fetch >
  // empty defaults, per the accepted W4.1 diagnosis.
  prefillRecord?: HealthRecord | null
}

export function NewRecordModal({ patientId, birthDate, open, onOpenChange, onCreated, prefillRecord }: NewRecordModalProps) {
  const { notifyError } = useActionNotify()
  const [loadingLatest, setLoadingLatest] = useState(false)
  const [hadPreviousRecord, setHadPreviousRecord] = useState(false)
  const [form, setForm] = useState<RecordFormState>(BLANK_FORM)
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const savingRef = useRef(false)
  const prefillRequestIdRef = useRef(0)

  // W4.2 — mirrors `prefillRecord` into a ref on every render (no effect of
  // its own, so this never triggers a re-run of the prefill effect below).
  // The prefill effect deliberately keeps its dependency array as
  // `[open, patientId]` — unchanged from before W4.2 — and reads this ref
  // only at the moment `open` flips true. This is what the W4.1 diagnosis
  // meant by "do not add prefillRecord to an effect dependency in a way
  // that can overwrite doctor edits while the modal is already open": if
  // `prefillRecord` were a dependency, a parent re-render with a new object
  // reference (or a changed value) while the modal is already open and the
  // doctor is mid-edit would re-fire this effect and silently clobber their
  // in-progress edits. Reading it only through this ref, only once per
  // open-transition, makes that impossible by construction.
  const prefillRecordRef = useRef(prefillRecord)
  prefillRecordRef.current = prefillRecord

  // U3.2 — canonical prefill, every time the modal transitions closed→open.
  // Never reuses an abandoned draft from a previous opening, never depends
  // on PatientDetailPage's own (possibly stale, post-U5 possibly paginated)
  // `records` array. Race-protected: a slow response from a closed/reopened
  // modal, or a patient switch mid-request, can never overwrite a newer
  // state (requestId guard, same pattern already validated in P5/O4).
  //
  // W4.2 — an explicit `prefillRecord` prop (present at all, `!== undefined`)
  // short-circuits this entirely: no recordService.getLatest call, no
  // loading state, no fetch race — the caller's already-loaded record (or
  // explicit `null`) is applied synchronously. `prefillRequestIdRef` is
  // still bumped in this branch so any in-flight internal fetch from a
  // previous open (with no explicit prop) can never land after it.
  useEffect(() => {
    if (!open) return
    setFieldErrors({})

    const explicitPrefill = prefillRecordRef.current
    if (explicitPrefill !== undefined) {
      ++prefillRequestIdRef.current
      setLoadingLatest(false)
      if (explicitPrefill) {
        setForm(prefillFromLatest(explicitPrefill))
        setHadPreviousRecord(true)
      } else {
        setForm(BLANK_FORM)
        setHadPreviousRecord(false)
      }
      return
    }

    const requestId = ++prefillRequestIdRef.current
    setLoadingLatest(true)
    recordService.getLatest(patientId)
      .then(latest => {
        if (requestId !== prefillRequestIdRef.current) return
        if (latest) {
          setForm(prefillFromLatest(latest))
          setHadPreviousRecord(true)
        } else {
          setForm(BLANK_FORM)
          setHadPreviousRecord(false)
        }
      })
      .catch(() => {
        if (requestId !== prefillRequestIdRef.current) return
        // Prefill failure: fall back to blank defaults rather than leaving
        // the form stuck in a loading state — the doctor can still create
        // a record; the only cost is missing convenience prefill.
        setForm(BLANK_FORM)
        setHadPreviousRecord(false)
      })
      .finally(() => {
        if (requestId === prefillRequestIdRef.current) setLoadingLatest(false)
      })
  }, [open, patientId])

  const handleClose = () => {
    if (savingRef.current) return
    onOpenChange(false)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setFieldErrors({})
    try {
      // U3.2 — `age` deliberately omitted: backend always derives and
      // overwrites it authoritatively from Paciente.birthDate at
      // persistence time (record.service.ts::create). `recordedAt` is not
      // part of this contract either — still server-generated `now()`.
      const payload: CreateHealthRecordRequest = {
        patientId,
        currentSmoker: form.currentSmoker,
        cigsPerDay: Number(form.cigsPerDay || 0),
        bpMeds: form.bpMeds,
        diabetes: form.diabetes,
        totChol: Number(form.totChol),
        sysBP: Number(form.sysBP),
        diaBP: Number(form.diaBP),
        bmi: Number(form.bmi),
        heartRate: Number(form.heartRate),
        glucose: Number(form.glucose),
        notes: form.notes.trim() || undefined,
      }
      const created = await recordService.create(payload)
      onCreated(created)
      onOpenChange(false)
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 400 && err.response.data?.details) {
        setFieldErrors(err.response.data.details as Record<string, string>)
      } else if (isAxiosError(err) && err.response?.data?.error) {
        // Z3 — generic create-failure feedback now goes through the
        // global action-notification toast instead of an inline banner.
        notifyError(err.response.data.error)
      } else {
        notifyError('No se pudo guardar el registro clínico. Intenta de nuevo.')
      }
    } finally {
      setSaving(false)
      savingRef.current = false
    }
  }

  const displayAge = calcAge(birthDate)
  const provenanceMessage = loadingLatest
    ? 'Cargando el último registro clínico...'
    : hadPreviousRecord
      ? ''
      : 'Primer registro clínico.'

  // W4.2 — title stays exactly "Nuevo registro clínico" (unchanged) in every
  // case: this action never mutates history, so the dialog never implies an
  // in-place edit. The one additive UX difference for the "Editar y crear
  // nuevo registro" entry point is this subtitle, shown only when the modal
  // was opened via an explicit `prefillRecord` prop — normal "Nuevo
  // registro" usage (prop omitted, e.g. PatientDetailPage today) never
  // passes this string to Dialog, so its rendered output is unchanged.
  const prefillSubtitle = prefillRecord !== undefined
    ? ''
    : undefined

  return (
    <Dialog
      open={open}
      onOpenChange={next => { if (!next) handleClose() }}
      title="Nuevo registro clínico"
      description={prefillSubtitle}
      preventClose={saving}
    >
      <form onSubmit={submit} className="ui-content-stack">
        {/* Z3 — the generic create-failure banner previously here now shows
            as a global action notification instead (see submit's catch).
            Field-level errors (below, per input) remain inline. The
            provenance notice just below (loading / "Primer registro
            clínico.") is untouched — it is informational/source context
            restored in R1, not an action result, and must not be removed
            just because it visually resembles a banner. */}

        {/* Age — read-only information, never an input (section 22 of
            U3.2). Backend remains the sole authority; this value is
            display-only and never sent in the submit payload. */}
        <div className="text-sm text-muted-foreground">
          Edad: <span className="font-medium text-foreground">{displayAge} años</span>
        </div>

        {/* Provenance status — surfaces why the fieldset below is disabled
            while the previous record is loading, and otherwise tells the
            clinician whether this is the patient's first clinical record.
            Renders nothing once a previous record was found (empty string
            per provenanceMessage above — that case needs no extra text). */}
        {provenanceMessage && (
          <p className="text-xs text-muted-foreground">{provenanceMessage}</p>
        )}

        <fieldset disabled={loadingLatest || saving} className="ui-content-stack">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Presión sistólica</label>
              <input type="number" min={60} max={300} required className={inputClass}
                value={form.sysBP}
                onChange={e => setForm(f => ({ ...f, sysBP: e.target.value }))} />
              {fieldErrors.sysBP && <p className="text-[11px] text-red-600 dark:text-red-400">{fieldErrors.sysBP}</p>}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Presión diastólica</label>
              <input type="number" min={40} max={200} required className={inputClass}
                value={form.diaBP}
                onChange={e => setForm(f => ({ ...f, diaBP: e.target.value }))} />
              {fieldErrors.diaBP && <p className="text-[11px] text-red-600 dark:text-red-400">{fieldErrors.diaBP}</p>}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Colesterol total</label>
              <input type="number" min={50} max={800} required className={inputClass}
                value={form.totChol}
                onChange={e => setForm(f => ({ ...f, totChol: e.target.value }))} />
              {fieldErrors.totChol && <p className="text-[11px] text-red-600 dark:text-red-400">{fieldErrors.totChol}</p>}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">IMC</label>
              <input type="number" step="0.1" min={10} max={80} required className={inputClass}
                value={form.bmi}
                onChange={e => setForm(f => ({ ...f, bmi: e.target.value }))} />
              {fieldErrors.bmi && <p className="text-[11px] text-red-600 dark:text-red-400">{fieldErrors.bmi}</p>}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Frec. cardíaca</label>
              <input type="number" min={30} max={250} required className={inputClass}
                value={form.heartRate}
                onChange={e => setForm(f => ({ ...f, heartRate: e.target.value }))} />
              {fieldErrors.heartRate && <p className="text-[11px] text-red-600 dark:text-red-400">{fieldErrors.heartRate}</p>}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Glucosa</label>
              <input type="number" min={30} max={500} required className={inputClass}
                value={form.glucose}
                onChange={e => setForm(f => ({ ...f, glucose: e.target.value }))} />
              {fieldErrors.glucose && <p className="text-[11px] text-red-600 dark:text-red-400">{fieldErrors.glucose}</p>}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Cigarrillos/día</label>
              <input type="number" min={0} max={100} className={inputClass}
                value={form.cigsPerDay}
                onChange={e => setForm(f => ({ ...f, cigsPerDay: e.target.value }))} />
            </div>
          </div>

          <div className="flex flex-wrap items-center ui-element-gap text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.currentSmoker}
                onChange={e => setForm(f => ({ ...f, currentSmoker: e.target.checked }))} />
              Fumador actual
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.bpMeds}
                onChange={e => setForm(f => ({ ...f, bpMeds: e.target.checked }))} />
              Medicamento para presión
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.diabetes}
                onChange={e => setForm(f => ({ ...f, diabetes: e.target.checked }))} />
              Diabetes
            </label>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Notas</label>
            <textarea rows={2} className={inputClass} maxLength={1000}
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
        </fieldset>

        <div className="flex items-center gap-2 pt-2">
          <button
            type="submit"
            disabled={saving || loadingLatest}
            className="flex items-center gap-1.5 bg-primary text-white px-4 ui-compact-control-density rounded-lg text-xs font-medium hover:bg-primary/90 disabled:opacity-60 transition-colors"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Guardando...' : 'Guardar registro'}
          </button>
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="px-4 ui-compact-control-density text-xs font-medium text-muted-foreground hover:bg-accent rounded-lg transition-colors disabled:opacity-60"
          >
            Cancelar
          </button>
        </div>
      </form>
    </Dialog>
  )
}
