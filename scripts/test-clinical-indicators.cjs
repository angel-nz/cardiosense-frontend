// Uses the existing TypeScript compiler and React SSR; no new dependency.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { test } = require('node:test')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
    fileName: file,
  }).outputText, file)
}
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { classifyClinicalIndicator: classify, CLINICAL_RANGE_CONTRACTS: contracts, CLINICAL_INDICATORS } = require('../src/lib/clinicalIndicators.ts')
const { ClinicalIndicators, CLINICAL_BAND_STYLES: styles } = require('../src/components/patients/ClinicalIndicators.tsx')

const cases = {
  sysBP: [[89,'LOW'],[90,'NORMAL'],[119,'NORMAL'],[120,'HIGH'],[139,'HIGH'],[140,'VERY_HIGH'],[181,'VERY_HIGH'],[89.99,'LOW'],[119.99,'NORMAL'],[139.99,'HIGH']],
  diaBP: [[59,'LOW'],[60,'NORMAL'],[79,'NORMAL'],[80,'HIGH'],[89,'HIGH'],[90,'VERY_HIGH'],[121,'VERY_HIGH'],[59.99,'LOW'],[79.99,'NORMAL'],[89.99,'HIGH']],
  totChol: [[119,'LOW'],[120,'NORMAL'],[199,'NORMAL'],[200,'HIGH'],[239,'HIGH'],[240,'VERY_HIGH'],[119.99,'LOW'],[199.99,'NORMAL'],[239.99,'HIGH']],
  BMI: [[18.49,'LOW'],[18.5,'NORMAL'],[24.99,'NORMAL'],[25,'HIGH'],[29.99,'HIGH'],[30,'VERY_HIGH']],
  glucose: [[69,'LOW'],[70,'NORMAL'],[125,'NORMAL'],[126,'HIGH'],[199,'HIGH'],[200,'VERY_HIGH'],[69.99,'LOW'],[125.99,'NORMAL'],[199.99,'HIGH']],
}
for (const [indicator, rows] of Object.entries(cases)) for (const [value, band] of rows) for (const sex of [0,1]) {
  test(`${sex===0?'FEMALE':'MALE'} ${indicator} ${value} → ${band}`, () => {
    const result=classify(indicator,value,sex)
    assert.equal(result.band,band)
    assert.equal(result.value,value)
    assert.equal(result.unit,CLINICAL_INDICATORS.find(x=>x.indicator===indicator).unit)
    assert.deepEqual(result,classify(indicator,value,sex))
  })
}
test('Separate frozen MALE and FEMALE contracts intentionally equal',()=>{
  assert.deepEqual(Object.keys(contracts).sort(),['FEMALE','MALE'])
  assert.notEqual(contracts.MALE,contracts.FEMALE)
  assert.deepEqual(contracts.MALE,contracts.FEMALE)
  assert(Object.isFrozen(contracts.MALE) && Object.isFrozen(contracts.FEMALE))
  for(const key of Object.keys(cases)) assert(Object.isFrozen(contracts.MALE[key]))
})
for(const sex of [null,undefined,2,-1,'1',true]) test(`Unknown sex ${String(sex)} never defaults`,()=>{
  for(const key of Object.keys(cases)) assert.equal(classify(key,cases[key][0][0],sex),null)
})
for(const value of [null,undefined,NaN,Infinity,-Infinity,0,-1,'120','',false]) test(`Invalid value ${String(value)} stays unclassified`,()=>{
  for(const key of Object.keys(cases)) for(const sex of [0,1]) assert.equal(classify(key,value,sex),null)
})
test('Only the five continuous indicators are classified',()=>{
  assert.deepEqual(CLINICAL_INDICATORS.map(x=>x.indicator),['sysBP','diaBP','totChol','BMI','glucose'])
  for(const key of ['age','sex','male','currentSmoker','cigsPerDay','BPMeds','diabetes','heartRate']) assert.equal(classify(key,1,1),null)
})
const render=(record,sex=0)=>renderToStaticMarkup(React.createElement(ClinicalIndicators,{record,sex}))
const sample=Object.freeze({sysBP:89,diaBP:60,totChol:200,bmi:30,glucose:125.99,currentSmoker:true,diabetes:false})
test('Component renders values, units, all labels and semantic colors without mutating input',()=>{
  const html=render(sample)
  for(const d of CLINICAL_INDICATORS) {
    assert(html.includes(d.name) && html.includes(d.unit))
    const card=html.match(new RegExp(`<div data-indicator="${d.indicator}"[\\s\\S]*?</div>`))[0]
    const result=classify(d.indicator,sample[d.field],0)
    assert(card.includes(`data-band="${result.band}"`))
    assert(card.includes(`data-tone="${styles[result.band].tone}"`))
    assert(card.includes(`>${sample[d.field]}<`))
    assert(card.includes(`>${result.label}</dd>`))
  }
  assert(html.includes('<dl ') && html.includes('<dt '))
  assert(!/heartRate|cardíaca|currentSmoker|diabetes/.test(html))
  assert.equal((html.match(/data-indicator=/g)||[]).length,5)
})
test('Neutral Normal and distinct info/warning/danger classes in both themes',()=>{
  assert.equal(styles.NORMAL.className,'border-border')
  assert.equal(styles.NORMAL.statusClassName,'text-foreground')
  const html=render(sample)
  assert.equal((html.match(/data-surface="neutral"/g)||[]).length,5)
  assert(!/bg-(blue|amber|red)-/.test(html))
  for(const [band,color,tone] of [['LOW','blue','info'],['HIGH','amber','warning'],['VERY_HIGH','red','danger']]) {
    assert.equal(styles[band].tone,tone)
    assert(styles[band].className.includes(`border-${color}-500`))
    assert(styles[band].statusClassName.includes(`text-${color}-800`))
    assert(styles[band].statusClassName.includes(`dark:text-${color}-300`))
  }
  assert(!/green|teal/.test(JSON.stringify(styles)))
})
test('Missing record/value never becomes Normal or zero',()=>{
  for(const record of [null,undefined,{}, {sysBP:null,diaBP:NaN,totChol:Infinity,bmi:undefined,glucose:0}]) {
    const html=render(record)
    assert.equal((html.match(/>Sin datos<\/dd>/g)||[]).length,5)
    assert(!html.includes('data-band=') && !html.includes('>Normal<'))
    assert(!html.includes('>0<'))
  }
})
test('Unknown sex preserves measured value without inventing a band',()=>{
  const html=render(sample,null)
  assert(!html.includes('data-band='))
  assert.equal((html.match(/Rango no disponible/g)||[]).length,5)
  assert(html.includes('>125.99<'))
})
test('Casual glucose never generates a diagnosis; labels at 126 and 200',()=>{
  for(const [value,band,label] of [[126,'HIGH','Alto'],[200,'VERY_HIGH','Muy alto']]) {
    const html=render({glucose:value})
    assert(html.includes('Glucosa casual') && html.includes(`data-band="${band}"`) && html.includes(`>${label}</dd>`))
    assert(!/prediabetes|fasting|ayunas|>Diabetes</i.test(html))
  }
})
test('Patient page uses this component and structured patient sex',()=>{
  const page=fs.readFileSync(path.join(__dirname,'../src/pages/Patients/PatientDetailPage.tsx'),'utf8')
  assert(page.includes('<ClinicalIndicators record={latestRecord} sex={patient.sex} />'))
  assert(!/high: latestRecord/.test(page))
})

test('Indicator text meets 4.5:1 contrast in light and dark themes',()=>{
  const colors=require('tailwindcss/colors')
  const css=fs.readFileSync(path.join(__dirname,'../src/index.css'),'utf8')
  const luminance=rgb=>rgb.map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4)
    .reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0)
  const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255)
  const hsl=(block,token)=>{
    const [h,s,l]=block.match(new RegExp(`--${token}: ([\\d.]+) ([\\d.]+)% ([\\d.]+)%`)).slice(1).map(Number)
    const a=(s/100)*Math.min(l/100,1-l/100)
    return [0,8,4].map(n=>{const k=(n+h/30)%12;return l/100-a*Math.max(-1,Math.min(k-3,9-k,1))})
  }
  const check=(name,fg,bg)=>{
    const a=luminance(fg),b=luminance(bg),ratio=(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)
    assert(ratio>=4.5,`${name}: ${ratio.toFixed(2)}:1`)
    console.log(`contrast ${name}: ${ratio.toFixed(2)}:1`)
  }
  for(const selector of [':root','.dark']) {
    const block=css.slice(css.indexOf(`${selector} {`)).split('}')[0]
    check(`neutral ${selector}`,hsl(block,'foreground'),hsl(block,'card'))
    for(const color of ['blue','amber','red']) check(`${color} ${selector}`,rgb(colors[color][selector === ':root' ? 800 : 300]),hsl(block,'card'))
  }
})
