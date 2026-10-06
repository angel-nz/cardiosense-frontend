const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { test } = require('node:test')
let ts
try { ts = require('typescript') } catch { ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript') }
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: file }).outputText, file)
const { parseTime24, toTime24, formatTime12 } = require('../src/lib/wheelTime.ts')
const src = rel => fs.readFileSync(path.join(__dirname, '../src', rel), 'utf8')

const timeWheel = src('components/ui/WheelTimePicker.tsx')
const record = src('components/patients/NewRecordModal.tsx')

test('WheelTimePicker has exactly Hour Minute Period columns and full ranges', () => {
  assert(timeWheel.includes('label="Hora"'))
  assert(timeWheel.includes('label="Minuto"'))
  assert(timeWheel.includes('label="Período"'))
  assert(timeWheel.includes('length: 12'))
  assert(timeWheel.includes('length: 60'))
  assert(timeWheel.includes("['AM', 'PM']"))
})

test('time scroll and keyboard navigation never commit selection', () => {
  assert(!timeWheel.includes('onScroll='))
  assert(!timeWheel.includes('scrollend'))
  assert(!timeWheel.includes('nearest'))
  assert(!timeWheel.includes('IntersectionObserver'))
  assert(timeWheel.includes("scrollByRows(-1)"))
  assert(timeWheel.includes("scrollToEdge('end')"))
})

test('click/tap is the explicit time-selection action', () => {
  assert(timeWheel.includes('onClick={() => onChange(item)}'))
  assert(timeWheel.includes('aria-selected={selected}'))
  const columnBody = timeWheel.slice(timeWheel.indexOf('function TimeWheelColumn'), timeWheel.indexOf('export interface WheelTimePickerProps'))
  assert.equal((columnBody.match(/onChange\(/g) || []).length, 1)
})

test('opening WheelTimePicker never publishes a time', () => {
  assert(timeWheel.includes('onClick={() => setOpen(current => !current)}'))
  const triggerStart = timeWheel.indexOf('aria-haspopup="listbox"')
  const triggerEnd = timeWheel.indexOf('className={cn(', triggerStart)
  assert(triggerStart >= 0 && triggerEnd > triggerStart)
  assert(!timeWheel.slice(triggerStart, triggerEnd).includes('onValueChange'))
})

test('12-hour and 24-hour conversion edge cases are exact', () => {
  assert.equal(toTime24({ hour: 12, minute: 0, period: 'AM' }), '00:00')
  assert.equal(toTime24({ hour: 12, minute: 0, period: 'PM' }), '12:00')
  assert.equal(toTime24({ hour: 1, minute: 0, period: 'PM' }), '13:00')
  assert.equal(toTime24({ hour: 11, minute: 59, period: 'PM' }), '23:59')
  assert.deepEqual(parseTime24('00:00'), { hour: 12, minute: 0, period: 'AM' })
  assert.deepEqual(parseTime24('12:00'), { hour: 12, minute: 0, period: 'PM' })
  assert.deepEqual(parseTime24('23:59'), { hour: 11, minute: 59, period: 'PM' })
  assert.equal(formatTime12('15:42'), '03:42 p. m.')
})

test('NewRecordModal combines existing date wheel with WheelTimePicker without changing measuredAt validation', () => {
  assert(record.includes("import { WheelDatePicker } from '@/components/ui/WheelDatePicker'"))
  assert(record.includes("import { WheelTimePicker } from '@/components/ui/WheelTimePicker'"))
  assert(record.includes('<WheelTimePicker'))
  assert(record.includes('showRequiredIndicator={false}'))
  assert(record.includes("onValueChange={time => setMeasuredLocal(`${measuredLocal.split('T')[0] ?? ''}T${time}`)}"))
  assert(record.includes('validateMeasuredAtInput(measuredLocal, birthDate)'))
  assert(!record.includes('type="time"'))
})

test('WheelDatePicker regression remains scroll-not-select and click-select', () => {
  const dateWheel = src('components/ui/WheelDatePicker.tsx')
  assert(!dateWheel.includes('onScroll='))
  assert(!dateWheel.includes('settleFromScroll'))
  assert(dateWheel.includes('onClick={() => onChange(item)}'))
})

test('global and patient prediction histories widen only Desde/Hasta', () => {
  for (const f of ['pages/Predictions/PredictionsPage.tsx', 'pages/Predictions/PredictionHistoryPage.tsx']) {
    const s = src(f)
    assert.equal((s.match(/className="w-full max-w-full flex-none sm:w-56"/g) || []).length, 2)
    assert(s.includes('<div className="w-36 max-w-full flex-none">'))
    assert(s.includes('Nivel de riesgo</label>'))
    assert(s.includes('flex items-end gap-2 flex-wrap'))
  }
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
