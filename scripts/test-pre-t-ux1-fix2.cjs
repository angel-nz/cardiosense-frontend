const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { test } = require('node:test')
let ts
try { ts = require('typescript') } catch { ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript') }
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: file }).outputText, file)
const { daysInMonth, clampCivilDate, parseCivilDate } = require('../src/lib/wheelDate.ts')
const src = rel => fs.readFileSync(path.join(__dirname, '../src', rel), 'utf8')

const wheel = src('components/ui/WheelDatePicker.tsx')

test('scroll navigation never commits wheel selection', () => {
  assert(!wheel.includes('onScroll='))
  assert(!wheel.includes('settleFromScroll'))
  assert(!wheel.includes('nearest.value'))
  assert(!wheel.includes('IntersectionObserver'))
  assert(wheel.includes("scrollByRows(-1)"))
  assert(wheel.includes("scrollToEdge('end')"))
})

test('click/tap remains the explicit selection action', () => {
  assert(wheel.includes('onClick={() => onChange(item)}'))
  assert(wheel.includes('aria-selected={selected}'))
  assert(wheel.includes("selected\n                  ? 'bg-primary"))
})

test('opening the picker toggles UI only and does not publish a value', () => {
  assert(wheel.includes('onClick={() => setOpen(current => !current)}'))
  const triggerStart = wheel.indexOf('aria-haspopup="listbox"')
  const triggerEnd = wheel.indexOf('className={cn(', triggerStart)
  assert(triggerStart >= 0 && triggerEnd > triggerStart)
  assert(!wheel.slice(triggerStart, triggerEnd).includes('onValueChange'))
})

test('date logic regression remains correct', () => {
  assert.equal(daysInMonth(2026, 1), 31)
  assert.equal(daysInMonth(2026, 4), 30)
  assert.equal(daysInMonth(2025, 2), 28)
  assert.equal(daysInMonth(2024, 2), 29)
  assert.equal(clampCivilDate(2026, 4, 31), '2026-04-30')
  assert.equal(parseCivilDate('1951-01-15')?.year, 1951)
})

test('new-patient age remains derived/read-only and uses the normal input style', () => {
  const s = src('pages/Patients/PatientCreatePage.tsx')
  assert(s.includes('value={previewAge !== null ? `${previewAge} años` : \'—\'}'))
  assert(s.includes('readOnly'))
  assert(s.includes("className={cn(inputClass, 'cursor-default')}"))
  assert(s.includes('calcAge(form.birthDate)'))
})

test('Edit DOB hides only the visual required marker and aligns with biological sex', () => {
  const s = src('components/patients/EditPatientModal.tsx')
  assert(s.includes('label="Fecha de nacimiento" required showRequiredIndicator={false}'))
  assert(s.includes('select required'))
  assert(s.includes('grid grid-cols-1 items-start gap-3 sm:grid-cols-2'))
  assert(s.includes('mb-1 block text-xs font-medium text-muted-foreground">Sexo biológico'))
})

test('measurement date/time keep functional required semantics without visible asterisks', () => {
  const s = src('components/patients/NewRecordModal.tsx')
  assert(s.includes('label="Fecha de la medición"'))
  assert(s.includes('showRequiredIndicator={false}'))
  assert(s.includes('id="record-measured-time"'))
  assert(s.includes('<WheelTimePicker'))
  assert(s.includes('required'))
  assert(!s.includes('Hora *'))
  const time = src('components/ui/WheelTimePicker.tsx')
  assert(time.includes('{label}{required && showRequiredIndicator'))
})

test('both prediction histories use wider aligned date/risk controls', () => {
  for (const f of ['pages/Predictions/PredictionsPage.tsx', 'pages/Predictions/PredictionHistoryPage.tsx']) {
    const s = src(f)
    assert(s.includes('flex items-end gap-2 flex-wrap'))
    assert.equal((s.match(/className="w-full max-w-full flex-none sm:w-56"/g) || []).length, 2)
    assert(s.includes('<div className="w-36 max-w-full flex-none">'))
    assert(s.includes('Nivel de riesgo</label>'))
    assert(s.includes('className="w-full px-2.5 ui-secondary-control-density text-xs rounded-lg border border-border bg-card cursor-pointer"'))
  }
})

test('PRE-T-UX1 and FIX-1A frozen contracts remain present', () => {
  const indicators = src('components/patients/ClinicalIndicators.tsx')
  assert(indicators.includes("NORMAL: { tone: 'neutral', className: 'border-border'"))
  const dash = src('pages/Dashboard/DashboardPage.tsx')
  assert(!/Alertas pendientes|pending alerts/i.test(dash))
  const sidebar = src('components/layout/Sidebar.tsx')
  assert(sidebar.includes('!collapsed') && sidebar.includes('sidebar-bell-badge'))
  const record = src('components/patients/NewRecordModal.tsx')
  assert(record.includes('<WheelTimePicker'))
  const risk = src('lib/riskProjection.ts') + src('types/index.ts')
  assert(risk.includes('S-FEAT-SEQUENTIAL-ROBUST-2') && risk.includes('S-CAD-3'))
})
