import { useNavigate } from 'react-router-dom'
import { ChevronRight, Activity } from 'lucide-react'
import { cn, initials, formatRelativeBusinessDate, calcAge, sexLabel } from '@/lib/utils'
import { RiskBadge } from '@/components/ui/RiskBadge'
import type { Patient } from '@/types'

interface PatientRowProps {
  patient: Patient
  className?: string
}

export function PatientRow({ patient, className }: PatientRowProps) {
  const navigate = useNavigate()
  const age = calcAge(patient.birthDate)

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
          <span className="text-xs text-muted-foreground italic">Sin predicción</span>
        )}
      </td>

      {/* Last update */}
      <td className="px-4 ui-row-density hidden md:table-cell">
        <p className="text-sm text-muted-foreground">{formatRelativeBusinessDate(patient.updatedAt).label}</p>
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
          {/* Z8-FIX2 §6 — Predecir is a clinical-create quick action, so it
              is NOT rendered at all (not merely disabled) for an inactive
              patient — mirrors the backend's own prediction guard
              (PatientInactiveError) and the identical pattern
              PatientDetailPage already uses for Nuevo registro/Nueva
              predicción (Z8 §25/§34). Hidden patients never reach this row
              in the first place (excluded server-side), so no separate
              check is needed for that case. */}
          {patient.isActive && (
            <button
              onClick={e => { e.stopPropagation(); navigate(`/predictions/${patient.id}`) }}
              className="p-1.5 rounded-lg hover:bg-primary/10 text-primary transition-colors hidden sm:flex items-center gap-1 text-xs font-medium"
            >
              <Activity className="w-3.5 h-3.5" />
              Predecir
            </button>
          )}
          <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
        </div>
      </td>
    </tr>
  )
}
