'use client'

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'

/* ═══════════════════════════════════════════
   Physics Constants & Models
   ═══════════════════════════════════════════ */

interface SamplePreset {
  name: string
  specificRotation: number    // °/(dm·g/mL) at 589nm, 20°C
  concentration: number       // g/mL
  tubeLength: number          // dm
  color: string               // liquid display color
  drudeA: number              // Drude equation coefficient A
  drudeLambda0: number        // Drude resonance wavelength nm
  tempCoeff: number           // d[α]/dT °/°C
  mutarotation?: {            // only for mutarotating substances
    alpha0: number            // initial rotation
    alphaEq: number           // equilibrium rotation
    k: number                 // rate constant min⁻¹
  }
}

const SAMPLE_PRESETS: SamplePreset[] = [
  {
    name: '葡萄糖', specificRotation: 52.7, concentration: 0.1, tubeLength: 2,
    color: '#F0E8D0', drudeA: 1.82e7, drudeLambda0: 140, tempCoeff: -0.06,
    mutarotation: { alpha0: 112.2, alphaEq: 52.7, k: 0.015 },
  },
  {
    name: '蔗糖', specificRotation: 66.5, concentration: 0.1, tubeLength: 2,
    color: '#F0E8D0', drudeA: 2.30e7, drudeLambda0: 130, tempCoeff: -0.04,
  },
  {
    name: '果糖', specificRotation: -92.4, concentration: 0.1, tubeLength: 2,
    color: '#F0E8D0', drudeA: -3.19e7, drudeLambda0: 140, tempCoeff: -0.07,
    mutarotation: { alpha0: -134.0, alphaEq: -92.4, k: 0.020 },
  },
  {
    name: '酒石酸', specificRotation: 14.0, concentration: 0.1, tubeLength: 2,
    color: '#F0ECD8', drudeA: 4.84e6, drudeLambda0: 135, tempCoeff: -0.02,
  },
  {
    name: '混合物(葡萄糖+果糖)', specificRotation: 0, concentration: 0.1, tubeLength: 2,
    color: '#F0E8D0', drudeA: 0, drudeLambda0: 140, tempCoeff: -0.05,
  },
  {
    name: '自定义', specificRotation: 0, concentration: 0.1, tubeLength: 2,
    color: '#F0F0F0', drudeA: 1.82e7, drudeLambda0: 140, tempCoeff: 0,
  },
]

/* Wavelength options with beam colors */
const WAVELENGTHS = [
  { label: 'Na D 589.3nm', value: 589.3, color: '#FFB800' },
  { label: 'Hg绿 546.1nm', value: 546.1, color: '#00AA44' },
  { label: 'He-Ne 632.8nm', value: 632.8, color: '#CC0000' },
  { label: 'Hg蓝 435.8nm', value: 435.8, color: '#4050B0' },
]

/* ─── Drude Equation: [α](λ) = A / (λ² - λ₀²) ─── */
function drudeSpecificRotation(A: number, lambda0: number, wavelengthNm: number): number {
  const denom = wavelengthNm * wavelengthNm - lambda0 * lambda0
  if (Math.abs(denom) < 1) return 0
  return A / denom
}

/* ─── Mutarotation: α(t) = αeq + (α0 - αeq) * e^(-kt) ─── */
function mutarotationAlpha(alpha0: number, alphaEq: number, k: number, tMin: number): number {
  return alphaEq + (alpha0 - alphaEq) * Math.exp(-k * tMin)
}

const FONT = 'var(--font-ibm-plex-sans), system-ui, sans-serif'

/* ═══════════════════════════════════════════
   Main Component
   ═══════════════════════════════════════════ */
export default function PolarimeterExperiment({ onBack }: { onBack: () => void }) {
  // ─── Core state ───
  const [analyzerAngle, setAnalyzerAngle] = useState(90)
  const [sampleInserted, setSampleInserted] = useState(false)
  const [selectedPreset, setSelectedPreset] = useState(0)
  const [customSpecRotation, setCustomSpecRotation] = useState(0)
  const [customConcentration, setCustomConcentration] = useState(0.1)
  const [customTubeLength, setCustomTubeLength] = useState(2)
  const [wavelengthIdx, setWavelengthIdx] = useState(0)
  const [zeroAngle, setZeroAngle] = useState<number | null>(null)
  const [measurementAngle, setMeasurementAngle] = useState<number | null>(null)

  // ─── Advanced features state ───
  const [temperature, setTemperature] = useState(20) // °C
  const [mutarotTime, setMutarotTime] = useState(0) // minutes
  const [mutarotRunning, setMutarotRunning] = useState(false)
  const [showHalfShadow, setShowHalfShadow] = useState(false)
  const [experimentMode, setExperimentMode] = useState<'zero' | 'halfshadow' | 'concentration' | 'dispersion' | 'mutarotation' | 'mixture'>('zero')

  // ─── Mixture state ───
  const [mixtureGlucose, setMixtureGlucose] = useState(0.05) // g/mL
  const [mixtureFructose, setMixtureFructose] = useState(0.05) // g/mL
  const [mixturePH, setMixturePH] = useState(7.0)
  const [unknownConc, setUnknownConc] = useState<number | null>(null)
  const [concUncertainty, setConcUncertainty] = useState<number | null>(null)

  // ─── Mutarotation timer ───
  const mutarotTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (mutarotRunning) {
      mutarotTimerRef.current = setInterval(() => {
        setMutarotTime(prev => prev + 0.5)
      }, 500) // real-time 0.5s = 0.5 min simulation
    } else {
      if (mutarotTimerRef.current) clearInterval(mutarotTimerRef.current)
    }
    return () => { if (mutarotTimerRef.current) clearInterval(mutarotTimerRef.current) }
  }, [mutarotRunning])

  // ─── Current sample ───
  const sample = useMemo(() => {
    if (selectedPreset < SAMPLE_PRESETS.length - 1) {
      return SAMPLE_PRESETS[selectedPreset]
    }
    return {
      name: '自定义', specificRotation: customSpecRotation,
      concentration: customConcentration, tubeLength: customTubeLength,
      color: '#F0F0F0', drudeA: 1.82e7, drudeLambda0: 140, tempCoeff: 0,
    }
  }, [selectedPreset, customSpecRotation, customConcentration, customTubeLength])

  const wavelength = WAVELENGTHS[wavelengthIdx].value

  // ─── Specific rotation with Drude wavelength correction ───
  const effectiveSpecRotation = useMemo(() => {
    if (sample.name === '混合物(葡萄糖+果糖)') return 0 // handled separately
    if (sample.name === '自定义') return sample.specificRotation
    // Apply Drude equation for wavelength correction
    const baseRotation = sample.specificRotation // at 589.3nm
    const drudeAt589 = drudeSpecificRotation(sample.drudeA, sample.drudeLambda0, 589.3)
    const drudeAtLambda = drudeSpecificRotation(sample.drudeA, sample.drudeLambda0, wavelength)
    if (Math.abs(drudeAt589) < 0.001) return baseRotation
    return baseRotation * (drudeAtLambda / drudeAt589)
  }, [sample, wavelength])

  // ─── Temperature correction ───
  const tempCorrectedSpecRotation = useMemo(() => {
    if (sample.name === '混合物(葡萄糖+果糖)') return 0
    return effectiveSpecRotation + sample.tempCoeff * (temperature - 20)
  }, [effectiveSpecRotation, sample, temperature])

  // ─── Mutarotation correction ───
  const mutarotCorrectedSpecRotation = useMemo(() => {
    if (!sample.mutarotation || sample.name === '混合物(葡萄糖+果糖)') return tempCorrectedSpecRotation
    const { alpha0, alphaEq, k } = sample.mutarotation
    // Scale mutarotation effect relative to equilibrium value
    const currentAlpha = mutarotationAlpha(alpha0, alphaEq, k, mutarotTime)
    if (Math.abs(alphaEq) < 0.001) return tempCorrectedSpecRotation
    return tempCorrectedSpecRotation * (currentAlpha / alphaEq)
  }, [tempCorrectedSpecRotation, sample, mutarotTime])

  // ─── Mixture specific rotation ───
  const mixtureSpecRotation = useMemo(() => {
    if (sample.name !== '混合物(葡萄糖+果糖)') return mutarotCorrectedSpecRotation
    const glucose = SAMPLE_PRESETS[0]
    const fructose = SAMPLE_PRESETS[2]
    // Drude correction for each component
    const g589 = drudeSpecificRotation(glucose.drudeA, glucose.drudeLambda0, 589.3)
    const gLambda = drudeSpecificRotation(glucose.drudeA, glucose.drudeLambda0, wavelength)
    const f589 = drudeSpecificRotation(fructose.drudeA, fructose.drudeLambda0, 589.3)
    const fLambda = drudeSpecificRotation(fructose.drudeA, fructose.drudeLambda0, wavelength)
    const gSpec = Math.abs(g589) > 0.001 ? glucose.specificRotation * (gLambda / g589) : glucose.specificRotation
    const fSpec = Math.abs(f589) > 0.001 ? fructose.specificRotation * (fLambda / f589) : fructose.specificRotation
    // pH-dependent mutarotation rate
    const phFactor = 1 + 0.3 * Math.max(0, 7 - mixturePH) // acid speeds up
    const gCurrent = glucose.mutarotation
      ? mutarotationAlpha(glucose.mutarotation.alpha0, glucose.mutarotation.alphaEq, glucose.mutarotation.k * phFactor, mutarotTime) / glucose.mutarotation.alphaEq * gSpec
      : gSpec
    const fCurrent = fructose.mutarotation
      ? mutarotationAlpha(fructose.mutarotation.alpha0, fructose.mutarotation.alphaEq, fructose.mutarotation.k * phFactor, mutarotTime) / fructose.mutarotation.alphaEq * fSpec
      : fSpec
    const totalConc = mixtureGlucose + mixtureFructose
    if (totalConc < 0.001) return 0
    return (gCurrent * mixtureGlucose + fCurrent * mixtureFructose) / totalConc
  }, [sample, wavelength, mixtureGlucose, mixtureFructose, mixturePH, mutarotTime, mutarotCorrectedSpecRotation])

  // ─── Final rotation angle ───
  const finalSpecRotation = mixtureSpecRotation

  const rotationAngle = useMemo(() => {
    if (!sampleInserted) return 0
    if (sample.name === '混合物(葡萄糖+果糖)') {
      const totalConc = mixtureGlucose + mixtureFructose
      return finalSpecRotation * sample.tubeLength * totalConc
    }
    return finalSpecRotation * sample.tubeLength * sample.concentration
  }, [sampleInserted, sample, finalSpecRotation, mixtureGlucose, mixtureFructose])

  // ─── Light intensity: Malus's law ───
  const intensity = useMemo(() => {
    const effectiveAngle = analyzerAngle - rotationAngle
    const rad = (effectiveAngle * Math.PI) / 180
    return Math.cos(rad) ** 2
  }, [analyzerAngle, rotationAngle])

  // ─── Half-shadow field intensities ───
  // Half-shadow divides field into 3 zones: center at angle θ, two sides at θ + δ
  const halfShadowDelta = 3.5 // degrees, half-shadow angle
  const halfShadowFields = useMemo(() => {
    const centerEff = analyzerAngle - rotationAngle
    const sideEff = (analyzerAngle + halfShadowDelta) - rotationAngle
    const sideEff2 = (analyzerAngle - halfShadowDelta) - rotationAngle
    return {
      center: Math.cos((centerEff * Math.PI) / 180) ** 2,
      left: Math.cos((sideEff2 * Math.PI) / 180) ** 2,
      right: Math.cos((sideEff * Math.PI) / 180) ** 2,
    }
  }, [analyzerAngle, rotationAngle, halfShadowDelta])

  // ─── Concentration determination ───
  const concentrationResult = useMemo(() => {
    if (experimentMode !== 'concentration') return null
    if (zeroAngle === null || measurementAngle === null) return null
    const alpha = measurementAngle - zeroAngle
    if (Math.abs(finalSpecRotation) < 0.001 || sample.tubeLength === 0) return null
    const c = alpha / (finalSpecRotation * sample.tubeLength)
    // Uncertainty: assume ±0.05° angular uncertainty
    const dAlpha = 0.05
    const dC = dAlpha / Math.abs(finalSpecRotation * sample.tubeLength)
    return { concentration: c, uncertainty: dC, alpha }
  }, [experimentMode, zeroAngle, measurementAngle, finalSpecRotation, sample])

  // ─── Dispersion data for curve ───
  const dispersionData = useMemo(() => {
    if (experimentMode !== 'dispersion') return []
    const points: { wl: number; specRot: number }[] = []
    for (let wl = 400; wl <= 700; wl += 5) {
      if (sample.name === '混合物(葡萄糖+果糖)') {
        const g589 = drudeSpecificRotation(SAMPLE_PRESETS[0].drudeA, SAMPLE_PRESETS[0].drudeLambda0, 589.3)
        const gWl = drudeSpecificRotation(SAMPLE_PRESETS[0].drudeA, SAMPLE_PRESETS[0].drudeLambda0, wl)
        const f589 = drudeSpecificRotation(SAMPLE_PRESETS[2].drudeA, SAMPLE_PRESETS[2].drudeLambda0, 589.3)
        const fWl = drudeSpecificRotation(SAMPLE_PRESETS[2].drudeA, SAMPLE_PRESETS[2].drudeLambda0, wl)
        const gSpec = Math.abs(g589) > 0.001 ? SAMPLE_PRESETS[0].specificRotation * (gWl / g589) : SAMPLE_PRESETS[0].specificRotation
        const fSpec = Math.abs(f589) > 0.001 ? SAMPLE_PRESETS[2].specificRotation * (fWl / f589) : SAMPLE_PRESETS[2].specificRotation
        const totalConc = mixtureGlucose + mixtureFructose
        const mixSpec = totalConc > 0.001 ? (gSpec * mixtureGlucose + fSpec * mixtureFructose) / totalConc : 0
        points.push({ wl, specRot: mixSpec })
      } else {
        const drude589 = drudeSpecificRotation(sample.drudeA, sample.drudeLambda0, 589.3)
        const drudeWl = drudeSpecificRotation(sample.drudeA, sample.drudeLambda0, wl)
        const specRot = Math.abs(drude589) > 0.001
          ? sample.specificRotation * (drudeWl / drude589)
          : sample.specificRotation
        points.push({ wl, specRot: specRot + sample.tempCoeff * (temperature - 20) })
      }
    }
    return points
  }, [experimentMode, sample, temperature, mixtureGlucose, mixtureFructose])

  // ─── Mutarotation curve ───
  const mutarotCurveData = useMemo(() => {
    if (!sample.mutarotation && sample.name !== '混合物(葡萄糖+果糖)') return []
    const points: { t: number; alpha: number }[] = []
    const maxT = 120 // minutes
    if (sample.name === '混合物(葡萄糖+果糖)') {
      const phFactor = 1 + 0.3 * Math.max(0, 7 - mixturePH)
      for (let t = 0; t <= maxT; t += 2) {
        const totalConc = mixtureGlucose + mixtureFructose
        const gSpec = SAMPLE_PRESETS[0].specificRotation
        const fSpec = SAMPLE_PRESETS[2].specificRotation
        const gMut = SAMPLE_PRESETS[0].mutarotation
        const fMut = SAMPLE_PRESETS[2].mutarotation
        const gAlpha = gMut ? mutarotationAlpha(gMut.alpha0, gMut.alphaEq, gMut.k * phFactor, t) / gMut.alphaEq * gSpec : gSpec
        const fAlpha = fMut ? mutarotationAlpha(fMut.alpha0, fMut.alphaEq, fMut.k * phFactor, t) / fMut.alphaEq * fSpec : fSpec
        const mixAlpha = totalConc > 0.001 ? (gAlpha * mixtureGlucose + fAlpha * mixtureFructose) / totalConc : 0
        points.push({ t, alpha: mixAlpha * sample.tubeLength * totalConc })
      }
    } else if (sample.mutarotation) {
      const { alpha0, alphaEq, k } = sample.mutarotation
      for (let t = 0; t <= maxT; t += 2) {
        const currentAlpha = mutarotationAlpha(alpha0, alphaEq, k, t)
        const specRot = currentAlpha / alphaEq * sample.specificRotation
        points.push({ t, alpha: specRot * sample.tubeLength * sample.concentration })
      }
    }
    return points
  }, [sample, mixtureGlucose, mixtureFructose, mixturePH])

  // ─── Measurement handlers ───
  const handleRecordZero = useCallback(() => { setZeroAngle(analyzerAngle) }, [analyzerAngle])
  const handleRecordMeasurement = useCallback(() => { setMeasurementAngle(analyzerAngle) }, [analyzerAngle])
  const handleReset = useCallback(() => { setZeroAngle(null); setMeasurementAngle(null); setUnknownConc(null) }, [])
  const handleStartMutarot = useCallback(() => { setMutarotTime(0); setMutarotRunning(true) }, [])
  const handleStopMutarot = useCallback(() => { setMutarotRunning(false) }, [])

  // ─── Dispersion curve dimensions ───
  const dispW = 500
  const dispH = 140
  const dispPad = 28

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#FFFFFF' }}>
      {/* Header */}
      <div className="flex-shrink-0 flex items-center" style={{
        height: '48px', backgroundColor: '#FFFFFF',
        borderBottom: '1px solid #CCCCCC', paddingLeft: '24px', paddingRight: '24px',
      }}>
        <button onClick={onBack} style={{
          fontFamily: FONT, fontSize: '12px', fontWeight: 400, color: '#555555',
          background: 'none', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: '4px',
          transition: 'color 200ms ease-out',
        }} onMouseEnter={e => (e.currentTarget.style.color = '#1A1A1A')}
           onMouseLeave={e => (e.currentTarget.style.color = '#555555')}>
          ← 返回
        </button>
        <span style={{ margin: '0 12px', color: '#D0D0D0' }}>|</span>
        <h1 style={{ fontFamily: FONT, fontSize: '20px', fontWeight: 600, color: '#1A1A1A', margin: 0 }}>
          旋光仪实验
        </h1>
        <span style={{ marginLeft: '12px', fontSize: '9px', color: '#888888', fontFamily: FONT,
          border: '1px solid #D0D0D0', borderRadius: '2px', padding: '1px 6px' }}>
          优化版
        </span>
      </div>

      <div className="flex flex-1" style={{ minHeight: 0 }}>
        {/* ═══ Left: Visualization ═══ */}
        <div className="flex-1 dot-grid custom-scrollbar" style={{
          display: 'flex', flexDirection: 'column', padding: '16px', overflowY: 'auto',
        }}>
          {/* 3D Color Virtual Instrument SVG */}
          <div style={{ textAlign: 'center', marginBottom: '12px' }}>
            <svg width="720" height="150" viewBox="0 0 720 150" style={{ maxWidth: '100%' }}>
              {/* Optical axis */}
              <line x1="20" y1="75" x2="700" y2="75" stroke="#888888" strokeWidth="0.6" strokeDasharray="6,3,2,3" />

              {/* Na lamp - 3D dark yellow translucent tube */}
              <g transform="translate(55, 75)">
                <rect x="-18" y="-24" width="36" height="48" rx="6" fill="none" stroke="#333333" strokeWidth="1.2" />
                <rect x="-14" y="-20" width="28" height="40" rx="4" fill={WAVELENGTHS[wavelengthIdx].color} fillOpacity="0.15" stroke="none" />
                {/* Filament */}
                <path d="M-6 -8 Q-3 -14 0 -8 Q3 -2 6 -8" stroke={WAVELENGTHS[wavelengthIdx].color} strokeWidth="1" fill="none" />
                <path d="M-6 8 Q-3 2 0 8 Q3 14 6 8" stroke={WAVELENGTHS[wavelengthIdx].color} strokeWidth="1" fill="none" />
                <text x="0" y="0" textAnchor="middle" fontSize="6" fill="#555555" fontFamily={FONT} fontWeight="600">
                  {WAVELENGTHS[wavelengthIdx].label.split(' ')[0]}
                </text>
                <text x="0" y="38" textAnchor="middle" fontSize="7" fill="#555555" fontFamily={FONT}>光源</text>
              </g>

              {/* Collimating lens */}
              <g transform="translate(140, 75)">
                <path d="M-4 -22 Q0 0 -4 22" stroke="#333333" strokeWidth="1.2" fill="none" />
                <path d="M4 -22 Q0 0 4 22" stroke="#333333" strokeWidth="1.2" fill="none" />
                <text x="0" y="36" textAnchor="middle" fontSize="7" fill="#555555" fontFamily={FONT}>透镜组</text>
              </g>

              {/* Fixed polarizer (起偏器) - white disk with scale markings */}
              <g transform="translate(230, 75)">
                <circle cx="0" cy="0" r="28" fill="#FFFFFF" stroke="#333333" strokeWidth="1.2" />
                {/* Scale ticks on disk */}
                {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map(deg => {
                  const rad = (deg * Math.PI) / 180
                  return <line key={deg} x1={24 * Math.cos(rad)} y1={-24 * Math.sin(rad)}
                    x2={27 * Math.cos(rad)} y2={-27 * Math.sin(rad)}
                    stroke="#888888" strokeWidth="0.4" />
                })}
                {/* Transmission axis */}
                <line x1="-22" y1="0" x2="22" y2="0" stroke="#1A1A1A" strokeWidth="1.5" />
                {/* Diagonal hatching for polarizer */}
                {Array.from({ length: 7 }, (_, i) => {
                  const dx = -15 + i * 5
                  const halfH = Math.sqrt(Math.max(0, 22 * 22 - dx * dx)) * 0.6
                  return halfH > 3 ? (
                    <line key={i} x1={dx} y1={-halfH} x2={dx + 4} y2={halfH}
                      stroke="#333333" strokeWidth="0.3" opacity="0.3" />
                  ) : null
                })}
                <text x="0" y="42" textAnchor="middle" fontSize="7" fill="#555555" fontFamily={FONT}>起偏器</text>
                <text x="0" y="51" textAnchor="middle" fontSize="6" fill="#888888" fontFamily={FONT}>0°固定</text>
              </g>

              {/* Beam after polarizer */}
              <line x1="258" y1="75" x2="340" y2="75" stroke={WAVELENGTHS[wavelengthIdx].color} strokeWidth="2.5" />

              {/* Sample tube - 3D transparent cylinder */}
              <g transform="translate(420, 75)">
                {/* Cylinder body */}
                <rect x="-70" y="-18" width="140" height="36" rx="2"
                  fill={sampleInserted ? sample.color : 'none'}
                  fillOpacity={sampleInserted ? 0.1 : 0}
                  stroke="#333333" strokeWidth="1.2" />
                {/* Liquid fill inside */}
                {sampleInserted && (
                  <rect x="-66" y="-14" width="132" height="28" rx="1"
                    fill={sample.color} fillOpacity="0.08" stroke="none" />
                )}
                {/* 3D cylinder ends */}
                <ellipse cx="-70" cy="0" rx="6" ry="16" fill={sampleInserted ? sample.color : 'none'}
                  fillOpacity={sampleInserted ? 0.1 : 0} stroke="#333333" strokeWidth="0.8" />
                <ellipse cx="70" cy="0" rx="6" ry="16" fill={sampleInserted ? sample.color : 'none'}
                  fillOpacity={sampleInserted ? 0.1 : 0} stroke="#333333" strokeWidth="0.8" />
                {/* Glass refraction lines */}
                <line x1="-70" y1="-14" x2="-70" y2="14" stroke="#333333" strokeWidth="0.6" strokeDasharray="2,2" />
                <line x1="70" y1="-14" x2="70" y2="14" stroke="#333333" strokeWidth="0.6" strokeDasharray="2,2" />
                {sampleInserted && (
                  <text x="0" y="3" textAnchor="middle" fontSize="7" fill="#555555" fontFamily={FONT}>{sample.name}</text>
                )}
                <text x="0" y="38" textAnchor="middle" fontSize="7" fill="#555555" fontFamily={FONT}>
                  {sampleInserted ? '样品管' : '（空）'}
                </text>
                {/* Temperature label */}
                {sampleInserted && (
                  <text x="0" y="-24" textAnchor="middle" fontSize="6" fill="#888888" fontFamily={FONT} className="tabular-nums">
                    {temperature}°C
                  </text>
                )}
              </g>

              {/* Beam after sample */}
              <line x1="496" y1="75" x2="540" y2="75"
                stroke={WAVELENGTHS[wavelengthIdx].color} strokeWidth="2.5"
                opacity={sampleInserted ? 0.7 : 1} />

              {/* Analyzer (检偏器) - rotatable disk with handle */}
              <g transform="translate(570, 75)">
                <circle cx="0" cy="0" r="28" fill="#FFFFFF" stroke="#333333" strokeWidth="1.2" />
                {/* Scale ticks */}
                {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map(deg => {
                  const rad = (deg * Math.PI) / 180
                  return <line key={deg} x1={24 * Math.cos(rad)} y1={-24 * Math.sin(rad)}
                    x2={27 * Math.cos(rad)} y2={-27 * Math.sin(rad)}
                    stroke="#888888" strokeWidth="0.4" />
                })}
                {/* Transmission axis at analyzerAngle */}
                {(() => {
                  const aRad = (analyzerAngle * Math.PI) / 180
                  return (
                    <line x1={-22 * Math.cos(aRad)} y1={-22 * Math.sin(aRad)}
                      x2={22 * Math.cos(aRad)} y2={22 * Math.sin(aRad)}
                      stroke="#1A1A1A" strokeWidth="1.5" />
                  )
                })()}
                {/* Handle for rotation */}
                {(() => {
                  const aRad = (analyzerAngle * Math.PI) / 180
                  const hx = 32 * Math.cos(aRad)
                  const hy = 32 * Math.sin(aRad)
                  return (
                    <g>
                      <line x1={24 * Math.cos(aRad)} y1={24 * Math.sin(aRad)}
                        x2={hx} y2={hy} stroke="#333333" strokeWidth="2" strokeLinecap="round" />
                      <circle cx={hx} cy={hy} r="3" fill="#333333" />
                    </g>
                  )
                })()}
                {/* Vernier tick at top */}
                <line x1="0" y1="-29" x2="0" y2="-33" stroke="#1A1A1A" strokeWidth="1" />
                <text x="0" y="42" textAnchor="middle" fontSize="7" fill="#555555" fontFamily={FONT}>检偏器</text>
                <text x="0" y="51" textAnchor="middle" fontSize="6" fill="#888888" className="tabular-nums" fontFamily={FONT}>{analyzerAngle.toFixed(1)}°</text>
              </g>

              {/* Beam after analyzer */}
              {intensity > 0.01 && (
                <line x1="598" y1="75" x2="670" y2="75"
                  stroke={WAVELENGTHS[wavelengthIdx].color} strokeWidth="2.5" opacity={intensity} />
              )}

              {/* Detector with semicircular light spot */}
              <g transform="translate(690, 75)">
                {/* Detector body */}
                <rect x="-12" y="-20" width="24" height="40" fill="#333333" rx="2" />
                {/* Semicircular light spot */}
                {intensity > 0.005 && (() => {
                  const spotR = 6 + 14 * intensity
                  const spotColor = WAVELENGTHS[wavelengthIdx].color
                  return (
                    <g>
                      {/* Light spot as filled semicircle */}
                      <path d={`M${-spotR} 0 A${spotR} ${spotR} 0 0 1 ${spotR} 0 Z`}
                        fill={spotColor} fillOpacity={0.3 + 0.5 * intensity} />
                      <path d={`M${-spotR} 0 A${spotR} ${spotR} 0 0 1 ${spotR} 0`}
                        fill="none" stroke={spotColor} strokeWidth="0.8" />
                    </g>
                  )
                })()}
                <text x="0" y="32" textAnchor="middle" fontSize="7" fill="#555555" fontFamily={FONT}>探测</text>
              </g>
            </svg>
          </div>

          {/* Analyzer dial with vernier - interactive */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '12px' }}>
            <AnalyzerDial angle={analyzerAngle} onChange={setAnalyzerAngle} />
          </div>

          {/* Half-shadow field view */}
          {showHalfShadow && (
            <div style={{ textAlign: 'center', marginBottom: '12px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, marginBottom: '6px' }}>
                半荫法视场
              </div>
              <svg width="240" height="80" viewBox="0 0 240 80" style={{ border: '1px solid #D0D0D0' }}>
                {/* Left field */}
                <rect x="0" y="0" width="80" height="80"
                  fill={WAVELENGTHS[wavelengthIdx].color} fillOpacity={halfShadowFields.left * 0.8} />
                {/* Center field */}
                <rect x="80" y="0" width="80" height="80"
                  fill={WAVELENGTHS[wavelengthIdx].color} fillOpacity={halfShadowFields.center * 0.8} />
                {/* Right field */}
                <rect x="160" y="0" width="80" height="80"
                  fill={WAVELENGTHS[wavelengthIdx].color} fillOpacity={halfShadowFields.right * 0.8} />
                {/* Dividing lines */}
                <line x1="80" y1="0" x2="80" y2="80" stroke="#333333" strokeWidth="0.8" />
                <line x1="160" y1="0" x2="160" y2="80" stroke="#333333" strokeWidth="0.8" />
                {/* Intensity values */}
                <text x="40" y="44" textAnchor="middle" fontSize="8" fill={halfShadowFields.left > 0.3 ? '#1A1A1A' : '#888888'} fontFamily={FONT} className="tabular-nums">
                  {halfShadowFields.left.toFixed(3)}
                </text>
                <text x="120" y="44" textAnchor="middle" fontSize="8" fill={halfShadowFields.center > 0.3 ? '#1A1A1A' : '#888888'} fontFamily={FONT} className="tabular-nums">
                  {halfShadowFields.center.toFixed(3)}
                </text>
                <text x="200" y="44" textAnchor="middle" fontSize="8" fill={halfShadowFields.right > 0.3 ? '#1A1A1A' : '#888888'} fontFamily={FONT} className="tabular-nums">
                  {halfShadowFields.right.toFixed(3)}
                </text>
                {/* Match indicator */}
                {Math.abs(halfShadowFields.left - halfShadowFields.center) < 0.02 &&
                 Math.abs(halfShadowFields.right - halfShadowFields.center) < 0.02 && (
                  <text x="120" y="20" textAnchor="middle" fontSize="9" fill="#1A1A1A" fontFamily={FONT} fontWeight="600">
                    ✓ 亮度一致
                  </text>
                )}
              </svg>
              <div style={{ fontSize: '9px', color: '#888888', fontFamily: FONT, marginTop: '4px' }}>
                调节检偏器至三部分亮度一致 → 读取角度
              </div>
            </div>
          )}

          {/* Detector readout with semicircular spot */}
          <div style={{ textAlign: 'center', marginBottom: '12px' }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: '16px',
              padding: '12px 20px', border: '1px solid #D0D0D0', borderRadius: '2px',
              backgroundColor: '#FAFAFA',
            }}>
              {/* Semicircular light spot */}
              <svg width="50" height="50" viewBox="0 0 50 50">
                <circle cx="25" cy="25" r="24" fill="#F0F3F6" stroke="#D0D0D0" strokeWidth="0.5" />
                {intensity > 0.005 && (() => {
                  const r = 4 + 20 * intensity
                  return (
                    <path d={`M${25 - r} 25 A${r} ${r} 0 0 1 ${25 + r} 25 Z`}
                      fill={WAVELENGTHS[wavelengthIdx].color} fillOpacity={0.3 + 0.5 * intensity} />
                  )
                })()}
              </svg>
              <div>
                <div style={{ fontSize: '10px', color: '#555555', fontFamily: FONT }}>归一化光强</div>
                <div className="tabular-nums" style={{
                  fontSize: '28px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT,
                }}>
                  {intensity.toFixed(4)}
                </div>
                <div style={{ width: '120px', height: '4px', backgroundColor: '#E8ECF0', marginTop: '2px', borderRadius: '1px' }}>
                  <div style={{
                    width: `${intensity * 100}%`, height: '100%',
                    backgroundColor: WAVELENGTHS[wavelengthIdx].color, borderRadius: '1px',
                    transition: 'width 100ms ease-out',
                  }} />
                </div>
              </div>
            </div>
          </div>

          {/* I-θ Curve */}
          <div style={{ textAlign: 'center', marginBottom: '12px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, marginBottom: '6px' }}>
              光强-角度曲线 I(θ) — 马吕斯定律
            </div>
            <IThetaCurve
              rotationAngle={rotationAngle}
              analyzerAngle={analyzerAngle}
              intensity={intensity}
              beamColor={WAVELENGTHS[wavelengthIdx].color}
            />
          </div>

          {/* Dispersion curve */}
          {experimentMode === 'dispersion' && dispersionData.length > 0 && (
            <div style={{ textAlign: 'center', marginBottom: '12px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, marginBottom: '6px' }}>
                旋光色散曲线 [α](λ) — Drude方程
              </div>
              <svg width={dispW} height={dispH} style={{ border: '1px solid #D0D0D0', backgroundColor: '#FFFFFF' }}>
                {/* Grid + Axes */}
                <DispersionGrid w={dispW} h={dispH} pad={dispPad} data={dispersionData} />
                {/* Current wavelength marker */}
                {(() => {
                  const plotW = dispW - dispPad * 2
                  const plotH = dispH - dispPad * 2
                  const minRot = Math.min(...dispersionData.map(d => d.specRot))
                  const maxRot = Math.max(...dispersionData.map(d => d.specRot))
                  const range = maxRot - minRot || 1
                  const x = dispPad + ((wavelength - 400) / 300) * plotW
                  const currentSpecRot = finalSpecRotation
                  const y = dispPad + plotH - ((currentSpecRot - minRot) / range) * plotH
                  return <circle cx={x} cy={y} r="3.5" fill={WAVELENGTHS[wavelengthIdx].color} />
                })()}
              </svg>
            </div>
          )}

          {/* Mutarotation curve */}
          {(experimentMode === 'mutarotation' || (sample.name === '混合物(葡萄糖+果糖)' && experimentMode === 'mixture')) && mutarotCurveData.length > 0 && (
            <div style={{ textAlign: 'center', marginBottom: '12px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#1A1A1A', fontFamily: FONT, marginBottom: '6px' }}>
                变旋曲线 α(t) — 双指数模型
              </div>
              <MutarotationCurve data={mutarotCurveData} currentTime={mutarotTime} />
            </div>
          )}
        </div>

        {/* ═══ Right: Control Panel ═══ */}
        <div className="custom-scrollbar" style={{
          width: '320px', flexShrink: 0, backgroundColor: '#FAFAFA',
          borderLeft: '1px solid #D0D0D0', overflowY: 'auto', padding: '12px',
        }}>
          {/* Experiment Mode Selection */}
          <div style={{ marginBottom: '12px' }}>
            <SectionTitle>实验模式</SectionTitle>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
              {([
                ['zero', '零位法'],
                ['halfshadow', '半荫法'],
                ['concentration', '浓度测定'],
                ['dispersion', '旋光色散'],
                ['mutarotation', '变旋现象'],
                ['mixture', '混合物分析'],
              ] as const).map(([key, label]) => (
                <button key={key} onClick={() => {
                  setExperimentMode(key)
                  if (key === 'halfshadow') setShowHalfShadow(true)
                  else setShowHalfShadow(false)
                }} style={{
                  fontSize: '9px', padding: '3px 6px', borderRadius: '2px',
                  border: `1px solid ${experimentMode === key ? '#333333' : '#D0D0D0'}`,
                  backgroundColor: experimentMode === key ? '#F0F3F6' : '#FFFFFF',
                  color: '#1A1A1A', cursor: 'pointer', fontFamily: FONT,
                  transition: 'border-color 200ms ease-out',
                }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Wavelength selection */}
          <div style={{ marginBottom: '12px' }}>
            <SectionTitle>光源波长</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {WAVELENGTHS.map((wl, i) => (
                <button key={i} onClick={() => setWavelengthIdx(i)} style={{
                  fontSize: '10px', padding: '3px 8px', borderRadius: '2px',
                  border: `1px solid ${wavelengthIdx === i ? '#333333' : '#D0D0D0'}`,
                  backgroundColor: wavelengthIdx === i ? '#F0F3F6' : '#FFFFFF',
                  color: '#1A1A1A', cursor: 'pointer', fontFamily: FONT,
                  display: 'flex', alignItems: 'center', gap: '6px',
                  transition: 'border-color 200ms ease-out',
                }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: wl.color, border: '1px solid #D0D0D0' }} />
                  {wl.label}
                </button>
              ))}
            </div>
            <div style={{ fontSize: '8px', color: '#888888', fontFamily: FONT, marginTop: '4px' }}>
              Drude方程自动修正: [α](λ) = A/(λ²-λ₀²)
            </div>
          </div>

          {/* Sample selection */}
          <div style={{ marginBottom: '12px' }}>
            <SectionTitle>样品选择</SectionTitle>
            <select value={selectedPreset} onChange={e => setSelectedPreset(Number(e.target.value))} style={{
              width: '100%', fontSize: '11px', padding: '4px 6px', border: '1px solid #D0D0D0',
              borderRadius: '2px', backgroundColor: '#FFFFFF', color: '#1A1A1A', fontFamily: FONT,
            }}>
              {SAMPLE_PRESETS.map((s, i) => (
                <option key={i} value={i}>{s.name}</option>
              ))}
            </select>

            {selectedPreset === SAMPLE_PRESETS.length - 1 && (
              <div style={{ marginTop: '6px' }}>
                <ParamSlider label="比旋光度 [α]" value={customSpecRotation} min={-100} max={100} step={0.1} unit="°/(dm·g/mL)" onChange={setCustomSpecRotation} />
                <ParamSlider label="浓度 c" value={customConcentration} min={0.01} max={0.5} step={0.01} unit="g/mL" onChange={setCustomConcentration} />
                <ParamSlider label="管长 l" value={customTubeLength} min={0.5} max={4} step={0.1} unit="dm" onChange={setCustomTubeLength} />
              </div>
            )}

            {/* Mixture parameters */}
            {sample.name === '混合物(葡萄糖+果糖)' && (
              <div style={{ marginTop: '6px' }}>
                <ParamSlider label="葡萄糖浓度" value={mixtureGlucose} min={0} max={0.3} step={0.005} unit="g/mL" onChange={setMixtureGlucose} />
                <ParamSlider label="果糖浓度" value={mixtureFructose} min={0} max={0.3} step={0.005} unit="g/mL" onChange={setMixtureFructose} />
                <ParamSlider label="pH" value={mixturePH} min={1} max={14} step={0.5} unit="" onChange={setMixturePH} />
                <div style={{ fontSize: '8px', color: '#888888', fontFamily: FONT, marginTop: '2px' }}>
                  酸性pH加速变旋速率，用于分离两组分贡献
                </div>
              </div>
            )}

            <button onClick={() => setSampleInserted(!sampleInserted)} style={{
              marginTop: '6px', width: '100%', fontSize: '10px', padding: '5px',
              borderRadius: '2px',
              border: `1px solid ${sampleInserted ? '#CC0000' : '#333333'}`,
              backgroundColor: sampleInserted ? '#FFF0F0' : '#F0F3F6',
              color: sampleInserted ? '#CC0000' : '#1A1A1A', cursor: 'pointer', fontFamily: FONT,
              transition: 'border-color 200ms ease-out, background-color 200ms ease-out',
            }}>
              {sampleInserted ? '✕ 移除样品管' : '↓ 放入样品管'}
            </button>
          </div>

          {/* Temperature control */}
          <div style={{ marginBottom: '12px' }}>
            <SectionTitle>温度控制</SectionTitle>
            <ParamSlider label="温度 T" value={temperature} min={5} max={50} step={0.5} unit="°C" onChange={setTemperature} />
            <div style={{ fontSize: '8px', color: '#888888', fontFamily: FONT }}>
              温度系数: d[α]/dT = {sample.tempCoeff} °/°C
            </div>
          </div>

          {/* Analyzer angle */}
          <div style={{ marginBottom: '12px' }}>
            <SectionTitle>检偏器角度</SectionTitle>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="range" min="0" max="360" step="0.1" value={analyzerAngle}
                onChange={e => setAnalyzerAngle(Number(e.target.value))}
                style={{ flex: 1, accentColor: '#333333' }}
              />
              <span className="tabular-nums" style={{ fontSize: '10px', color: '#1A1A1A', fontFamily: FONT, minWidth: '36px' }}>
                {analyzerAngle.toFixed(1)}°
              </span>
            </div>
          </div>

          {/* Zero method / Half-shadow / Concentration measurement controls */}
          {(experimentMode === 'zero' || experimentMode === 'halfshadow' || experimentMode === 'concentration') && (
            <div style={{ marginBottom: '12px' }}>
              <SectionTitle>
                {experimentMode === 'zero' ? '零位法操作' : experimentMode === 'halfshadow' ? '半荫法操作' : '浓度测定'}
              </SectionTitle>
              <div style={{ fontSize: '9px', color: '#888888', fontFamily: FONT, lineHeight: '1.6', marginBottom: '6px' }}>
                {experimentMode === 'zero' && (
                  <>1. 不放样品，调至消光 → 记录零位<br />2. 放入样品，再调至消光 → 记录测量值<br />3. 自动计算旋光度 α = θ₂ - θ₁</>
                )}
                {experimentMode === 'halfshadow' && (
                  <>1. 不放样品，调至三部分亮度一致 → 记录零位<br />2. 放入样品，再调至一致 → 记录测量值<br />3. α = θ₂ - θ₁ (比全暗法更灵敏)</>
                )}
                {experimentMode === 'concentration' && (
                  <>1. 已知[α]和l，测量α<br />2. 反算浓度 c = α/([α]·l)<br />3. 给出不确定度范围</>
                )}
              </div>
              <div style={{ display: 'flex', gap: '3px', marginBottom: '6px' }}>
                <button onClick={handleRecordZero} disabled={sampleInserted} style={{
                  flex: 1, fontSize: '9px', padding: '4px 3px', borderRadius: '2px',
                  border: `1px solid ${zeroAngle !== null ? '#333333' : '#D0D0D0'}`,
                  backgroundColor: zeroAngle !== null ? '#F0F3F6' : '#FFFFFF',
                  color: sampleInserted ? '#CCCCCC' : '#1A1A1A', cursor: sampleInserted ? 'not-allowed' : 'pointer',
                  fontFamily: FONT,
                }}>
                  记录零位 {zeroAngle !== null ? `(${zeroAngle.toFixed(1)}°)` : ''}
                </button>
                <button onClick={handleRecordMeasurement} disabled={!sampleInserted} style={{
                  flex: 1, fontSize: '9px', padding: '4px 3px', borderRadius: '2px',
                  border: `1px solid ${measurementAngle !== null ? '#333333' : '#D0D0D0'}`,
                  backgroundColor: measurementAngle !== null ? '#F0F3F6' : '#FFFFFF',
                  color: !sampleInserted ? '#CCCCCC' : '#1A1A1A', cursor: !sampleInserted ? 'not-allowed' : 'pointer',
                  fontFamily: FONT,
                }}>
                  记录测量 {measurementAngle !== null ? `(${measurementAngle.toFixed(1)}°)` : ''}
                </button>
              </div>
              <button onClick={handleReset} style={{
                fontSize: '9px', padding: '2px 8px', borderRadius: '2px',
                border: '1px solid #D0D0D0', backgroundColor: '#FFFFFF',
                color: '#555555', cursor: 'pointer', fontFamily: FONT,
              }}>
                重置测量
              </button>

              {/* Concentration result */}
              {experimentMode === 'concentration' && concentrationResult && (
                <div style={{
                  marginTop: '8px', backgroundColor: '#FFFFFF', border: '1px solid #D0D0D0',
                  borderRadius: '2px', padding: '6px', fontSize: '10px', fontFamily: FONT, lineHeight: '1.8',
                }}>
                  <div style={{ color: '#555555' }}>实测旋光度 α: <span className="tabular-nums" style={{ color: '#1A1A1A', fontWeight: 600 }}>{concentrationResult.alpha.toFixed(2)}°</span></div>
                  <div style={{ color: '#555555' }}>实测浓度 c: <span className="tabular-nums" style={{ color: '#1A1A1A', fontWeight: 600 }}>{concentrationResult.concentration.toFixed(4)} g/mL</span></div>
                  <div style={{ color: '#555555' }}>不确定度: <span className="tabular-nums" style={{ color: '#1A1A1A' }}>±{concentrationResult.uncertainty.toFixed(4)} g/mL</span></div>
                  <div style={{ fontSize: '8px', color: '#888888', marginTop: '2px' }}>
                    c = α/([α]·l) = {concentrationResult.alpha.toFixed(2)}/({finalSpecRotation.toFixed(2)}×{sample.tubeLength})
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Mutarotation controls */}
          {(experimentMode === 'mutarotation' || experimentMode === 'mixture') && (
            <div style={{ marginBottom: '12px' }}>
              <SectionTitle>变旋现象</SectionTitle>
              {sample.mutarotation ? (
                <>
                  <div style={{ fontSize: '9px', color: '#888888', fontFamily: FONT, lineHeight: '1.6', marginBottom: '6px' }}>
                    模型: α(t) = αeq + (α₀ - αeq)e⁻ᵏᵗ<br />
                    α₀ = {sample.mutarotation.alpha0}° (初始)<br />
                    αeq = {sample.mutarotation.alphaEq}° (平衡)<br />
                    k = {sample.mutarotation.k} min⁻¹
                  </div>
                  <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
                    <button onClick={mutarotRunning ? handleStopMutarot : handleStartMutarot} style={{
                      flex: 1, fontSize: '9px', padding: '4px', borderRadius: '2px',
                      border: `1px solid ${mutarotRunning ? '#CC0000' : '#333333'}`,
                      backgroundColor: mutarotRunning ? '#FFF0F0' : '#F0F3F6',
                      color: mutarotRunning ? '#CC0000' : '#1A1A1A', cursor: 'pointer', fontFamily: FONT,
                    }}>
                      {mutarotRunning ? '⏸ 暂停' : '▶ 开始变旋'}
                    </button>
                    <button onClick={() => { setMutarotRunning(false); setMutarotTime(0) }} style={{
                      fontSize: '9px', padding: '4px 8px', borderRadius: '2px',
                      border: '1px solid #D0D0D0', backgroundColor: '#FFFFFF',
                      color: '#555555', cursor: 'pointer', fontFamily: FONT,
                    }}>
                      重置
                    </button>
                  </div>
                  <div style={{ fontSize: '10px', color: '#1A1A1A', fontFamily: FONT }}>
                    时间: <span className="tabular-nums">{mutarotTime.toFixed(1)}</span> min
                  </div>
                  <div style={{ fontSize: '10px', color: '#1A1A1A', fontFamily: FONT }}>
                    当前[α]: <span className="tabular-nums">{mutarotCorrectedSpecRotation.toFixed(2)}</span> °/(dm·g/mL)
                  </div>
                </>
              ) : sample.name === '混合物(葡萄糖+果糖)' ? (
                <>
                  <div style={{ fontSize: '9px', color: '#888888', fontFamily: FONT, lineHeight: '1.6', marginBottom: '6px' }}>
                    葡萄糖+果糖混合物变旋<br />
                    不同pH下变旋速率不同<br />
                    可通过动力学分析求组分比例
                  </div>
                  <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
                    <button onClick={mutarotRunning ? handleStopMutarot : handleStartMutarot} style={{
                      flex: 1, fontSize: '9px', padding: '4px', borderRadius: '2px',
                      border: `1px solid ${mutarotRunning ? '#CC0000' : '#333333'}`,
                      backgroundColor: mutarotRunning ? '#FFF0F0' : '#F0F3F6',
                      color: mutarotRunning ? '#CC0000' : '#1A1A1A', cursor: 'pointer', fontFamily: FONT,
                    }}>
                      {mutarotRunning ? '⏸ 暂停' : '▶ 开始变旋'}
                    </button>
                    <button onClick={() => { setMutarotRunning(false); setMutarotTime(0) }} style={{
                      fontSize: '9px', padding: '4px 8px', borderRadius: '2px',
                      border: '1px solid #D0D0D0', backgroundColor: '#FFFFFF',
                      color: '#555555', cursor: 'pointer', fontFamily: FONT,
                    }}>
                      重置
                    </button>
                  </div>
                  <div style={{ fontSize: '10px', color: '#1A1A1A', fontFamily: FONT }}>
                    时间: <span className="tabular-nums">{mutarotTime.toFixed(1)}</span> min
                  </div>
                </>
              ) : (
                <div style={{ fontSize: '9px', color: '#888888', fontFamily: FONT }}>
                  当前样品无变旋现象，请选择葡萄糖或果糖
                </div>
              )}
            </div>
          )}

          {/* Measurement Results */}
          <div style={{ marginBottom: '12px' }}>
            <SectionTitle>测量结果</SectionTitle>
            <div style={{
              backgroundColor: '#FFFFFF', border: '1px solid #D0D0D0',
              borderRadius: '2px', padding: '6px', fontSize: '10px',
              fontFamily: FONT, lineHeight: '1.8',
            }}>
              <div style={{ color: '#555555' }}>旋光度 α: <span className="tabular-nums" style={{ color: '#1A1A1A', fontWeight: 600 }}>{rotationAngle.toFixed(2)}°</span></div>
              <div style={{ color: '#555555' }}>有效比旋光度: <span className="tabular-nums" style={{ color: '#1A1A1A', fontWeight: 600 }}>{finalSpecRotation.toFixed(2)}°/(dm·g/mL)</span></div>
              <div style={{ color: '#555555' }}>波长修正: <span className="tabular-nums" style={{ color: sample.name === '自定义' ? '#888888' : '#1A1A1A' }}>
                {sample.name === '自定义' ? '未启用' : `Drude ${wavelength}nm`}
              </span></div>
              <div style={{ color: '#555555' }}>温度修正: <span className="tabular-nums" style={{ color: '#1A1A1A' }}>
                {(sample.tempCoeff * (temperature - 20)).toFixed(2)}°
              </span></div>
              {zeroAngle !== null && measurementAngle !== null && (
                <>
                  <div style={{ borderTop: '1px solid #E8ECF0', marginTop: '3px', paddingTop: '3px' }}>
                    <span style={{ color: '#555555' }}>实测旋光度: </span>
                    <span className="tabular-nums" style={{ color: '#1A1A1A', fontWeight: 600 }}>{(measurementAngle - zeroAngle).toFixed(2)}°</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Sample Info / Formula Reference */}
          {sampleInserted && (
            <div style={{ marginBottom: '12px' }}>
              <SectionTitle>样品参数 & 公式</SectionTitle>
              <div style={{
                backgroundColor: '#FFFFFF', border: '1px solid #D0D0D0',
                borderRadius: '2px', padding: '6px', fontSize: '10px',
                fontFamily: FONT, lineHeight: '1.8',
              }}>
                <div style={{ color: '#555555' }}>物质: <span style={{ color: '#1A1A1A' }}>{sample.name}</span></div>
                <div style={{ color: '#555555' }}>浓度 c: <span className="tabular-nums" style={{ color: '#1A1A1A' }}>
                  {sample.name === '混合物(葡萄糖+果糖)' ? `${mixtureGlucose}+${mixtureFructose}` : sample.concentration} g/mL
                </span></div>
                <div style={{ color: '#555555' }}>管长 l: <span className="tabular-nums" style={{ color: '#1A1A1A' }}>{sample.tubeLength} dm</span></div>
                <div style={{ borderTop: '1px solid #E8ECF0', marginTop: '4px', paddingTop: '4px', fontSize: '9px', color: '#888888' }}>
                  <div>[α]λᵀ = α / (l·c)</div>
                  <div>[α](λ) = A / (λ² - λ₀²)  ← Drude</div>
                  {sample.mutarotation && <div>α(t) = αeq + (α₀ - αeq)e⁻ᵏᵗ</div>}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════
   Sub-Components
   ═══════════════════════════════════════════ */

/* ─── Interactive Analyzer Dial with Vernier ─── */
function AnalyzerDial({ angle, onChange }: { angle: number; onChange: (a: number) => void }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragging = useRef(false)

  const handleInteraction = useCallback((clientX: number, clientY: number) => {
    if (!svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    let a = Math.atan2(clientY - cy, clientX - cx) * 180 / Math.PI
    a = Math.round(a * 10) / 10
    if (a < 0) a += 360
    onChange(a)
  }, [onChange])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    handleInteraction(e.clientX, e.clientY)
    const onMove = (ev: MouseEvent) => { if (dragging.current) handleInteraction(ev.clientX, ev.clientY) }
    const onUp = () => { dragging.current = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [handleInteraction])

  const size = 160
  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - 14
  const aRad = (angle * Math.PI) / 180

  return (
    <svg ref={svgRef} width={size} height={size + 20} viewBox={`0 0 ${size} ${size + 20}`}
      onMouseDown={handleMouseDown} style={{ cursor: 'grab' }}>
      {/* Outer ring */}
      <circle cx={cx} cy={cy} r={r} fill="#FFFFFF" stroke="#333333" strokeWidth="1.2" />
      {/* Vernier scale - fine ticks every 5° */}
      {Array.from({ length: 72 }, (_, i) => {
        const deg = i * 5
        const rad = (deg * Math.PI) / 180
        const isMajor = deg % 30 === 0
        const isMid = deg % 10 === 0
        const innerR = isMajor ? r - 12 : isMid ? r - 7 : r - 4
        return (
          <g key={deg}>
            <line x1={cx + innerR * Math.cos(rad)} y1={cy - innerR * Math.sin(rad)}
              x2={cx + (r - 1) * Math.cos(rad)} y2={cy - (r - 1) * Math.sin(rad)}
              stroke={isMajor ? '#1A1A1A' : '#888888'} strokeWidth={isMajor ? 1 : 0.5}
            />
            {isMajor && (
              <text x={cx + (r - 18) * Math.cos(rad)} y={cy - (r - 18) * Math.sin(rad) + 3}
                textAnchor="middle" fontSize="7" fill="#555555" fontFamily={FONT} className="tabular-nums">
                {deg}°
              </text>
            )}
          </g>
        )
      })}
      {/* Vernier scale arc (inner) - 0.1° resolution */}
      <circle cx={cx} cy={cy} r={r - 24} fill="none" stroke="#D0D0D0" strokeWidth="0.5" />
      {Array.from({ length: 10 }, (_, i) => {
        const vDeg = angle - 5 + i
        const vRad = (vDeg * Math.PI) / 180
        return (
          <line key={i} x1={cx + (r - 22) * Math.cos(vRad)} y1={cy - (r - 22) * Math.sin(vRad)}
            x2={cx + (r - 26) * Math.cos(vRad)} y2={cy - (r - 26) * Math.sin(vRad)}
            stroke="#888888" strokeWidth="0.4" />
        )
      })}
      {/* Pointer */}
      <line x1={cx} y1={cy} x2={cx + (r - 20) * Math.cos(aRad)} y2={cy - (r - 20) * Math.sin(aRad)}
        stroke="#CC0000" strokeWidth="1.5" />
      {/* Center dot */}
      <circle cx={cx} cy={cy} r="3" fill="#333333" />
      {/* Angle display */}
      <text x={cx} y={size + 14} textAnchor="middle" fontSize="10" fill="#555555" fontFamily={FONT} className="tabular-nums">
        θ = {angle.toFixed(1)}°
      </text>
    </svg>
  )
}

/* ─── I-θ Curve ─── */
function IThetaCurve({ rotationAngle, analyzerAngle, intensity, beamColor }: {
  rotationAngle: number; analyzerAngle: number; intensity: number; beamColor: string
}) {
  const curveW = 520
  const curveH = 140
  const pad = 28

  const curveData = useMemo(() => {
    const pts: { angle: number; intensity: number }[] = []
    for (let θ = 0; θ <= 360; θ += 1) {
      const eff = θ - rotationAngle
      pts.push({ angle: θ, intensity: Math.cos((eff * Math.PI) / 180) ** 2 })
    }
    return pts
  }, [rotationAngle])

  return (
    <svg width={curveW} height={curveH} style={{ border: '1px solid #D0D0D0', backgroundColor: '#FFFFFF' }}>
      {/* Grid */}
      {[0.25, 0.5, 0.75].map(f => (
        <g key={f}>
          <line x1={pad} y1={pad + (curveH - pad * 2) * f} x2={curveW - pad} y2={pad + (curveH - pad * 2) * f}
            stroke="#E8ECF0" strokeWidth="0.5" />
          <line x1={pad + (curveW - pad * 2) * f} y1={pad} x2={pad + (curveW - pad * 2) * f} y2={curveH - pad}
            stroke="#E8ECF0" strokeWidth="0.5" />
        </g>
      ))}
      {/* Axes */}
      <line x1={pad} y1={curveH - pad} x2={curveW - pad} y2={curveH - pad} stroke="#888888" strokeWidth="0.8" />
      <line x1={pad} y1={pad} x2={pad} y2={curveH - pad} stroke="#888888" strokeWidth="0.8" />
      {/* Curve */}
      {(() => {
        const plotW = curveW - pad * 2
        const plotH = curveH - pad * 2
        const pts = curveData.map((d, i) => {
          const x = pad + (d.angle / 360) * plotW
          const y = pad + plotH - d.intensity * plotH
          return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
        })
        return <path d={pts.join(' ')} fill="none" stroke="#1A1A1A" strokeWidth="1" />
      })()}
      {/* Current marker */}
      {(() => {
        const plotW = curveW - pad * 2
        const plotH = curveH - pad * 2
        const x = pad + (analyzerAngle / 360) * plotW
        const y = pad + plotH - intensity * plotH
        return <circle cx={x} cy={y} r="3" fill={beamColor} />
      })()}
      {/* Labels */}
      <text x={pad + (curveW - pad * 2) / 2} y={curveH - 4} textAnchor="middle" fontSize="8" fill="#555555" fontFamily={FONT}>θ (°)</text>
      <text x={6} y={curveH / 2} textAnchor="middle" fontSize="8" fill="#555555" fontFamily={FONT}
        transform={`rotate(-90, 6, ${curveH / 2})`}>I/I₀</text>
      {/* Ticks */}
      {[0, 90, 180, 270, 360].map(v => (
        <text key={v} x={pad + (v / 360) * (curveW - pad * 2)} y={curveH - pad + 10}
          textAnchor="middle" fontSize="6" fill="#888888" fontFamily={FONT} className="tabular-nums">{v}</text>
      ))}
    </svg>
  )
}

/* ─── Dispersion Grid Helper ─── */
function DispersionGrid({ w, h, pad, data }: { w: number; h: number; pad: number; data: { wl: number; specRot: number }[] }) {
  const plotW = w - pad * 2
  const plotH = h - pad * 2
  const minRot = Math.min(...data.map(d => d.specRot))
  const maxRot = Math.max(...data.map(d => d.specRot))
  const range = maxRot - minRot || 1

  return (
    <g>
      {/* Grid */}
      {[0.25, 0.5, 0.75].map(f => (
        <g key={f}>
          <line x1={pad} y1={pad + plotH * f} x2={w - pad} y2={pad + plotH * f} stroke="#E8ECF0" strokeWidth="0.5" />
          <line x1={pad + plotW * f} y1={pad} x2={pad + plotW * f} y2={h - pad} stroke="#E8ECF0" strokeWidth="0.5" />
        </g>
      ))}
      {/* Axes */}
      <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="#888888" strokeWidth="0.8" />
      <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="#888888" strokeWidth="0.8" />
      {/* Curve */}
      {data.map((d, i) => {
        const x = pad + ((d.wl - 400) / 300) * plotW
        const y = pad + plotH - ((d.specRot - minRot) / range) * plotH
        return i === 0 ? `M${x.toFixed(1)},${y.toFixed(1)}` : `L${x.toFixed(1)},${y.toFixed(1)}`
      }).join(' ') && <path d={data.map((d, i) => {
        const x = pad + ((d.wl - 400) / 300) * plotW
        const y = pad + plotH - ((d.specRot - minRot) / range) * plotH
        return i === 0 ? `M${x.toFixed(1)},${y.toFixed(1)}` : `L${x.toFixed(1)},${y.toFixed(1)}`
      }).join(' ')} fill="none" stroke="#1A1A1A" strokeWidth="1" />}
      {/* Labels */}
      <text x={w / 2} y={h - 4} textAnchor="middle" fontSize="8" fill="#555555" fontFamily={FONT}>λ (nm)</text>
      <text x={8} y={h / 2} textAnchor="middle" fontSize="8" fill="#555555" fontFamily={FONT}
        transform={`rotate(-90, 8, ${h / 2})`}>[α]</text>
      {[400, 500, 600, 700].map(v => (
        <text key={v} x={pad + ((v - 400) / 300) * plotW} y={h - pad + 10}
          textAnchor="middle" fontSize="6" fill="#888888" fontFamily={FONT} className="tabular-nums">{v}</text>
      ))}
    </g>
  )
}

/* ─── Mutarotation Curve ─── */
function MutarotationCurve({ data, currentTime }: { data: { t: number; alpha: number }[]; currentTime: number }) {
  const w = 500
  const h = 140
  const pad = 28
  const plotW = w - pad * 2
  const plotH = h - pad * 2
  const maxT = data.length > 0 ? Math.max(...data.map(d => d.t)) : 120
  const minA = data.length > 0 ? Math.min(...data.map(d => d.alpha)) : -10
  const maxA = data.length > 0 ? Math.max(...data.map(d => d.alpha)) : 10
  const rangeA = maxA - minA || 1

  return (
    <svg width={w} height={h} style={{ border: '1px solid #D0D0D0', backgroundColor: '#FFFFFF' }}>
      {/* Grid */}
      {[0.25, 0.5, 0.75].map(f => (
        <g key={f}>
          <line x1={pad} y1={pad + plotH * f} x2={w - pad} y2={pad + plotH * f} stroke="#E8ECF0" strokeWidth="0.5" />
          <line x1={pad + plotW * f} y1={pad} x2={pad + plotW * f} y2={h - pad} stroke="#E8ECF0" strokeWidth="0.5" />
        </g>
      ))}
      <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="#888888" strokeWidth="0.8" />
      <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="#888888" strokeWidth="0.8" />
      {/* Curve */}
      {data.length > 1 && <path d={data.map((d, i) => {
        const x = pad + (d.t / maxT) * plotW
        const y = pad + plotH - ((d.alpha - minA) / rangeA) * plotH
        return i === 0 ? `M${x.toFixed(1)},${y.toFixed(1)}` : `L${x.toFixed(1)},${y.toFixed(1)}`
      }).join(' ')} fill="none" stroke="#1A1A1A" strokeWidth="1" />}
      {/* Current time marker */}
      {(() => {
        const x = pad + (currentTime / maxT) * plotW
        const currentAlpha = data.length > 0 ? data.find(d => d.t >= currentTime)?.alpha ?? data[data.length - 1].alpha : 0
        const y = pad + plotH - ((currentAlpha - minA) / rangeA) * plotH
        return <circle cx={x} cy={y} r="3" fill="#CC0000" />
      })()}
      {/* Labels */}
      <text x={w / 2} y={h - 4} textAnchor="middle" fontSize="8" fill="#555555" fontFamily={FONT}>t (min)</text>
      <text x={8} y={h / 2} textAnchor="middle" fontSize="8" fill="#555555" fontFamily={FONT}
        transform={`rotate(-90, 8, ${h / 2})`}>α (°)</text>
    </svg>
  )
}

/* ─── Helper Components ─── */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: '11px', fontWeight: 600, color: '#1A1A1A',
      fontFamily: FONT, marginBottom: '6px', paddingBottom: '4px',
      borderBottom: '1px solid #E8ECF0',
    }}>
      {children}
    </div>
  )
}

function ParamSlider({ label, value, min, max, step, unit, onChange }: {
  label: string; value: number; min: number; max: number; step: number; unit?: string
  onChange: (v: number) => void
}) {
  return (
    <div style={{ marginBottom: '6px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1px' }}>
        <span style={{ fontSize: '10px', color: '#555555', fontFamily: FONT }}>{label}</span>
        <span className="tabular-nums" style={{ fontSize: '10px', color: '#1A1A1A', fontFamily: FONT }}>
          {value}{unit || ''}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: '#333333' }}
      />
    </div>
  )
}
