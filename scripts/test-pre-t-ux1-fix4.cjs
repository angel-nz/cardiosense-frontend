const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ROOT = path.resolve(__dirname, '..', 'src')
const src = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')
let passed = 0
const test = (name, fn) => { fn(); passed += 1; console.log(`PASS ${name}`) }

const record = src('components/patients/NewRecordModal.tsx')
const globalHistory = src('pages/Predictions/PredictionsPage.tsx')
const patientHistory = src('pages/Predictions/PredictionHistoryPage.tsx')

test('measurement date and time share equal desktop grid columns', () => {
  assert(record.includes('id="record-measured-at" className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2"'))
  assert(!record.includes('sm:grid-cols-[minmax(0,1fr)_9rem]'))
  assert(record.includes('<WheelDatePicker'))
  assert(record.includes('<WheelTimePicker'))
})

test('measurement date/time vertical contract remains unchanged', () => {
  assert(record.includes('label="Fecha de la medición"'))
  assert(record.includes('label="Hora"'))
  assert.equal((record.match(/showRequiredIndicator=\{false\}/g) || []).length >= 2, true)
  assert(record.includes('items-start gap-3'))
})

test('global history keeps FIX-3 date widths and shortens only risk level', () => {
  assert.equal((globalHistory.match(/className="w-full max-w-full flex-none sm:w-56"/g) || []).length, 2)
  assert(globalHistory.includes('<div className="w-36 max-w-full flex-none">'))
  assert(!globalHistory.includes('<div className="w-44 max-w-full flex-none">'))
  assert(globalHistory.includes('flex items-end gap-2 flex-wrap'))
})

test('patient history keeps FIX-3 date widths and shortens only risk level', () => {
  assert.equal((patientHistory.match(/className="w-full max-w-full flex-none sm:w-56"/g) || []).length, 2)
  assert(patientHistory.includes('<div className="w-36 max-w-full flex-none">'))
  assert(!patientHistory.includes('<div className="w-44 max-w-full flex-none">'))
  assert(patientHistory.includes('flex items-end gap-2 flex-wrap'))
})

test('risk option semantics are unchanged in both histories', () => {
  for (const s of [globalHistory, patientHistory]) {
    assert(s.includes('<option value="">Todos los niveles</option>'))
    assert(s.includes('<option value="LOW">Bajo</option>'))
    assert(s.includes('<option value="MODERATE">Moderado</option>'))
    assert(s.includes('<option value="HIGH">Alto</option>'))
  }
})

test('WheelDatePicker and WheelTimePicker contracts remain referenced without inline redesign', () => {
  assert(record.includes("import { WheelDatePicker } from '@/components/ui/WheelDatePicker'"))
  assert(record.includes("import { WheelTimePicker } from '@/components/ui/WheelTimePicker'"))
  assert(!record.includes('type="time"'))
})

test('frozen PRE-T UX/R/S frontend contracts remain present', () => {
  const indicators = src('components/patients/ClinicalIndicators.tsx')
  assert(indicators.includes("NORMAL: { tone: 'neutral', className: 'border-border'"))
  const dash = src('pages/Dashboard/DashboardPage.tsx')
  assert(!/Alertas pendientes|pending alerts/i.test(dash))
  const sidebar = src('components/layout/Sidebar.tsx')
  assert(sidebar.includes('!collapsed') && sidebar.includes('sidebar-bell-badge'))
  const risk = src('lib/riskProjection.ts') + src('types/index.ts')
  assert(risk.includes('S-FEAT-SEQUENTIAL-ROBUST-2') && risk.includes('S-CAD-3'))
})

console.log(`${passed}/7 PRE-T-UX1-FIX-4 checks passed`)
