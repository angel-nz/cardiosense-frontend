import { useState, useEffect, useRef } from 'react'
import { isAxiosError } from 'axios'
import { Dialog } from '@/components/ui/Dialog'
import { cn, calcAge } from '@/lib/utils'
import { recordService } from '@/services/recordService'
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
}

export function NewRecordModal({ patientId, birthDate, open, onOpenChange, onCreated }: NewRecordModalProps) {
  const [loadingLatest, setLoadingLatest] = useState(false)
  const [hadPreviousRecord, setHadPreviousRecord] = useState(false)
  const [form, setForm] = useState<RecordFormState>(BLANK_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const savingRef = useRef(false)
  const prefillRequestIdRef = useRef(0)

  // U3.2 — canonical prefill, every time the modal transitions closed→open.
  // Never reuses an abandoned draft from a previous opening, never depends
  // on PatientDetailPage's own (possibly stale, post-U5 possibly paginated)
  // `records` array. Race-protected: a slow response from a closed/reopened
  // modal, or a patient switch mid-request, can never overwrite a newer
  // state (requestId guard, same pattern already validated in P5/O4).
  useEffect(() => {
    if (!open) return
    const requestId = ++prefillRequestIdRef.current
    setLoadingLatest(true)
    setFormError(null)
    setFieldErrors({})
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
    setFormError(null)
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
        setFormError(err.response.data.error)
      } else {
        setFormError('No se pudo guardar el registro clínico. Intenta de nuevo.')
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
      ? 'Valores precargados desde el último registro clínico.'
      : 'Primer registro clínico.'

  return (
    <Dialog
      open={open}
      onOpenChange={next => { if (!next) handleClose() }}
      title="Nuevo registro clínico"
      description={provenanceMessage}
      preventClose={saving}
    >
      <form onSubmit={submit} className="space-y-4">
        {formError && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
            {formError}
          </div>
        )}

        {/* Age — read-only information, never an input (section 22 of
            U3.2). Backend remains the sole authority; this value is
            display-only and never sent in the submit payload. */}
        <div className="text-sm text-muted-foreground">
          Edad: <span className="font-medium text-foreground">{displayAge} años</span>
        </div>

        <fieldset disabled={loadingLatest || saving} className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Presión sistólica</label>
              <input type="number" min={60} max={300} required className={inputClass}
                value={form.sysBP}
                onChange={e => setForm(f => ({ ...f, sysBP: e.target.value }))} />
              {fieldErrors.sysBP && <p className="text-[11px] text-red-600">{fieldErrors.sysBP}</p>}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Presión diastólica</label>
              <input type="number" min={40} max={200} required className={inputClass}
                value={form.diaBP}
                onChange={e => setForm(f => ({ ...f, diaBP: e.target.value }))} />
              {fieldErrors.diaBP && <p className="text-[11px] text-red-600">{fieldErrors.diaBP}</p>}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Colesterol total</label>
              <input type="number" min={50} max={800} required className={inputClass}
                value={form.totChol}
                onChange={e => setForm(f => ({ ...f, totChol: e.target.value }))} />
              {fieldErrors.totChol && <p className="text-[11px] text-red-600">{fieldErrors.totChol}</p>}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">IMC</label>
              <input type="number" step="0.1" min={10} max={80} required className={inputClass}
                value={form.bmi}
                onChange={e => setForm(f => ({ ...f, bmi: e.target.value }))} />
              {fieldErrors.bmi && <p className="text-[11px] text-red-600">{fieldErrors.bmi}</p>}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Frec. cardíaca</label>
              <input type="number" min={30} max={250} required className={inputClass}
                value={form.heartRate}
                onChange={e => setForm(f => ({ ...f, heartRate: e.target.value }))} />
              {fieldErrors.heartRate && <p className="text-[11px] text-red-600">{fieldErrors.heartRate}</p>}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Glucosa</label>
              <input type="number" min={30} max={500} required className={inputClass}
                value={form.glucose}
                onChange={e => setForm(f => ({ ...f, glucose: e.target.value }))} />
              {fieldErrors.glucose && <p className="text-[11px] text-red-600">{fieldErrors.glucose}</p>}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Cigarrillos/día</label>
              <input type="number" min={0} max={100} className={inputClass}
                value={form.cigsPerDay}
                onChange={e => setForm(f => ({ ...f, cigsPerDay: e.target.value }))} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-sm">
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
            className="flex items-center gap-1.5 bg-primary text-white px-4 py-2 rounded-lg text-xs font-medium hover:bg-primary/90 disabled:opacity-60 transition-colors"
          >
            {saving ? 'Guardando...' : 'Guardar registro'}
          </button>
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-accent rounded-lg transition-colors disabled:opacity-60"
          >
            Cancelar
          </button>
        </div>
      </form>
    </Dialog>
  )
}
