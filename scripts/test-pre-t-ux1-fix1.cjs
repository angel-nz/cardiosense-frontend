const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { test } = require('node:test')
let ts
try { ts = require('typescript') } catch { ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript') }
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'), { compilerOptions:{ module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2020 }, fileName:file }).outputText, file)
const { daysInMonth, clampCivilDate, parseCivilDate, clampCivilDateToBounds } = require('../src/lib/wheelDate.ts')
const src = rel => fs.readFileSync(path.join(__dirname,'../src',rel),'utf8')

test('daysInMonth and leap years are correct', () => {
  assert.equal(daysInMonth(2026,1),31); assert.equal(daysInMonth(2026,4),30)
  assert.equal(daysInMonth(2025,2),28); assert.equal(daysInMonth(2024,2),29)
  assert.equal(daysInMonth(2100,2),28); assert.equal(daysInMonth(2000,2),29)
})
test('invalid day clamps safely', () => {
  assert.equal(clampCivilDate(2026,4,31),'2026-04-30')
  assert.equal(clampCivilDate(2025,2,31),'2025-02-28')
  assert.equal(clampCivilDate(2024,2,31),'2024-02-29')
})
test('civil date remains literal and bounds are lexical YYYY-MM-DD', () => {
  assert.deepEqual(parseCivilDate('1951-01-15'),{year:1951,month:1,day:15})
  assert.equal(clampCivilDateToBounds('1951-01-15','1900-01-01','2026-10-05'),'1951-01-15')
  assert.equal(clampCivilDateToBounds('2099-01-01',undefined,'2026-10-05'),'2026-10-05')
  assert.equal(parseCivilDate('2026-02-31'),null)
})
test('target fields use WheelDatePicker only', () => {
  const files = {
    create: src('pages/Patients/PatientCreatePage.tsx'),
    edit: src('components/patients/EditPatientModal.tsx'),
    record: src('components/patients/NewRecordModal.tsx'),
    global: src('pages/Predictions/PredictionsPage.tsx'),
    patient: src('pages/Predictions/PredictionHistoryPage.tsx'),
  }
  assert(files.create.includes('<WheelDatePicker') && files.create.includes('Fecha de nacimiento'))
  assert(files.edit.includes('<WheelDatePicker') && files.edit.includes('Fecha de nacimiento'))
  assert(files.record.includes('<WheelDatePicker') && files.record.includes('Fecha de la medición'))
  for (const key of ['global','patient']) {
    assert.equal((files[key].match(/<WheelDatePicker/g)||[]).length,2)
    assert(files[key].includes('label="Desde"') && files[key].includes('label="Hasta"'))
  }
})
test('DOB includes 1951 without Skorp age restriction', () => {
  for (const f of ['pages/Patients/PatientCreatePage.tsx','components/patients/EditPatientModal.tsx']) {
    const s=src(f); assert(s.includes('- 130')); assert(!s.includes('minYear={32}') && !s.includes('maxYear={81}'))
  }
})
test('measuredAt keeps date wheel and current time-selector contract', () => {
  const s=src('components/patients/NewRecordModal.tsx')
  assert(s.includes('<WheelDatePicker')); assert(s.includes('<WheelTimePicker'))
  assert(s.includes('validateMeasuredAtInput(measuredLocal, birthDate)'))
  assert(!s.includes('ClinicalDateTimeField') && !s.includes('type="datetime-local"'))
})
test('non-target calendars restored to previous month-label navigation', () => {
  for (const f of ['components/dashboard/DashboardCalendar.tsx','components/patients/PatientCalendar.tsx']) {
    const s=src(f); assert(s.includes('{monthLabel}')); assert(!s.includes('CalendarMonthField')); assert(!s.includes('WheelDatePicker'))
  }
})
test('obsolete global temporal redesign is removed', () => {
  assert(!fs.existsSync(path.join(__dirname,'../src/components/ui/DateTimeFields.tsx')))
  const all = fs.readdirSync(path.join(__dirname,'../src/components/ui')).join('\n')
  assert(!/DateTimeFields/.test(all))
})
test('PRE-T-UX1 preserved: indicators, Dashboard, Sidebar', () => {
  const indicators=src('components/patients/ClinicalIndicators.tsx')
  assert(indicators.includes("NORMAL: { tone: 'neutral', className: 'border-border'")); assert(!/bg-(blue|amber|red)-/.test(indicators))
  const dash=src('pages/Dashboard/DashboardPage.tsx'); assert(!/Alertas pendientes|pending alerts/i.test(dash))
  const side=src('components/layout/Sidebar.tsx'); assert(side.includes('!collapsed') && side.includes('sidebar-bell-badge'))
})
test('S projection contract remains unchanged in frontend', () => {
  const text=src('lib/riskProjection.ts') + src('types/index.ts')
  assert(text.includes('S-FEAT-SEQUENTIAL-ROBUST-2')); assert(text.includes('S-CAD-3'))
})
