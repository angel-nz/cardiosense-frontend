import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { cn, initials, formatRelativeBusinessDate, formatTime, calcAge, sexLabel } from '@/lib/utils'
import { RiskBadge } from '@/components/ui/RiskBadge'
import type { Patient } from '@/types'

interface PatientRowProps {
  patient: Patient
  className?: string
}

export function PatientRow({ patient, className }: PatientRowProps) {
  const navigate = useNavigate()
  const age = calcAge(patient.birthDate)
  const latestClinicalDate = patient.latestClinicalAt ? formatRelativeBusinessDate(patient.latestClinicalAt) : null
  const latestClinicalLabel = patient.latestClinicalAt && latestClinicalDate
    ? latestClinicalDate.isRelative
      ? `${latestClinicalDate.label}, ${formatTime(patient.latestClinicalAt, { timeZone: 'business' })}`
      : latestClinicalDate.label
    : 'Sin registros clínicos'

  return (
    <tr
      onClick={() => navigate(`/patients/${patient.id}`)}
      className={cn(
        'border-b border-border hover:bg-accent/50 cursor-pointer transition-colors group',
        className,
      )}
    >
      {/* Avatar + name. Y6.3B — `ui-row-density` replaces `py-3.5` on every
          cell below (Classic 0.875rem/14px, exact match, §45); `px-4` stays
          fixed (§32). */}
      <td className="px-4 ui-row-density">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-blue-600/10 border border-blue-200 dark:border-blue-800/60 flex items-center justify-center text-blue-700 dark:text-blue-300 text-xs font-bold flex-shrink-0">
            {initials(patient.firstName, patient.lastName)}
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">
              {patient.firstName} {patient.lastName}
            </p>
            {patient.curp && (
              <p className="text-xs text-muted-foreground font-mono">{patient.curp}</p>
            )}
          </div>
        </div>
      </td>

      {/* Age / Sex */}
      <td className="px-4 ui-row-density hidden sm:table-cell">
        <p className="text-sm text-foreground">{age} años</p>
        <p className="text-xs text-muted-foreground">{sexLabel(patient.sex)}</p>
      </td>

      {/* Risk */}
      <td className="px-4 ui-row-density">
        {patient.latestRisk ? (
          <RiskBadge
            level={patient.latestRisk}
            score={patient.latestScore}
            showScore
          />
        ) : (
          // NEW S3-FIX1 — no current observed risk. When the patient HAS a
          // latest clinical record (without a Prediction), older Predictions
          // may exist in history but are never shown here as current.
          <span className="text-xs text-muted-foreground italic" data-testid="patient-no-current-risk">
            {patient.latestClinicalRecordId ? 'Sin riesgo actual' : 'Sin predicción'}
          </span>
        )}
      </td>

      {/* Last update */}
      <td className="px-4 ui-row-density hidden md:table-cell">
        {/* NEW S3 — "Última actualización" = clinical time of the patient's
            clinically latest HealthRecord (never Paciente.updatedAt). */}
        <p className="text-sm text-muted-foreground" data-testid="patient-last-clinical">
          {latestClinicalLabel}
        </p>
      </td>

      {/* Status */}
      <td className="px-4 ui-row-density hidden lg:table-cell">
        <span className={cn(
          'inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium',
          patient.isActive
            ? 'bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800/60'
            // Y6.2 — was bg-gray-100/text-gray-500/border-gray-200: a
            // generic neutral surface, not a distinct clinical color family,
            // so it maps to the shared muted/border tokens (already
            // theme-aware) rather than getting its own dark: variant.
            : 'bg-muted text-muted-foreground border border-border',
        )}>
          <span className={cn('w-1.5 h-1.5 rounded-full', patient.isActive ? 'bg-teal-500' : 'bg-muted-foreground/50')} />
          {patient.isActive ? 'Activo' : 'Inactivo'}
        </span>
      </td>

      {/* Action */}
      <td className="px-4 ui-row-density">
        <div className="flex items-center justify-end gap-2">
          {/* NEW S2E-FIX4 — the former "Predecir" quick action was removed:
              Predictions are only produced automatically when a REAL clinical
              record is saved (no user-triggered Prediction anywhere). The row
              itself still opens the patient detail. */}
          <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
        </div>
      </td>
    </tr>
  )
}
