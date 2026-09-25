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
      {/* Avatar + name */}
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-blue-600/10 border border-blue-200 flex items-center justify-center text-blue-700 text-xs font-bold flex-shrink-0">
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
      <td className="px-4 py-3.5 hidden sm:table-cell">
        <p className="text-sm text-foreground">{age} años</p>
        <p className="text-xs text-muted-foreground">{sexLabel(patient.sex)}</p>
      </td>

      {/* Risk */}
      <td className="px-4 py-3.5">
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
      <td className="px-4 py-3.5 hidden md:table-cell">
        <p className="text-sm text-muted-foreground">{formatRelativeBusinessDate(patient.updatedAt).label}</p>
      </td>

      {/* Status */}
      <td className="px-4 py-3.5 hidden lg:table-cell">
        <span className={cn(
          'inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium',
          patient.isActive
            ? 'bg-teal-50 text-teal-700 border border-teal-200'
            : 'bg-gray-100 text-gray-500 border border-gray-200',
        )}>
          <span className={cn('w-1.5 h-1.5 rounded-full', patient.isActive ? 'bg-teal-500' : 'bg-gray-400')} />
          {patient.isActive ? 'Activo' : 'Inactivo'}
        </span>
      </td>

      {/* Action */}
      <td className="px-4 py-3.5">
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={e => { e.stopPropagation(); navigate(`/predictions/${patient.id}`) }}
            className="p-1.5 rounded-lg hover:bg-primary/10 text-primary transition-colors hidden sm:flex items-center gap-1 text-xs font-medium"
          >
            <Activity className="w-3.5 h-3.5" />
            Predecir
          </button>
          <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
        </div>
      </td>
    </tr>
  )
}
