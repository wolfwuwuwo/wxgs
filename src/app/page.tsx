'use client'

import { useState, useCallback, lazy, Suspense, type ReactNode } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { HomeContent } from '@/components/layout/HomeContent'
import { HubContent } from '@/components/layout/HubContent'
import { NAV_TREE, PARENT_MAP, findExperiment, findBranch, type ViewId } from '@/lib/navigation'

const JonesPolarizationLab = lazy(() => import('@/components/simulations/JonesPolarizationLab'))
const VectorDiffractionWorkshop = lazy(() => import('@/components/simulations/VectorDiffractionWorkshop'))
const PolarimeterExperiment = lazy(() => import('@/components/simulations/PolarimeterExperiment'))
const LiquidCrystalValve = lazy(() => import('@/components/simulations/LiquidCrystalValve'))
const PolarizationScanner = lazy(() => import('@/components/simulations/PolarizationScanner'))
const GaussianBeamTracer = lazy(() => import('@/components/simulations/GaussianBeamTracer'))
const RayTracingLab = lazy(() => import('@/components/simulations/RayTracingLab'))
const FiberModeSimulator = lazy(() => import('@/components/simulations/FiberModeSimulator'))
const PrismSpectrometer = lazy(() => import('@/components/simulations/PrismSpectrometer'))
const MichelsonInterferometer = lazy(() => import('@/components/simulations/MichelsonInterferometer'))
const YoungGratingExperiment = lazy(() => import('@/components/simulations/YoungGratingExperiment'))
const FourierOptics4f = lazy(() => import('@/components/simulations/FourierOptics4f'))
const AberrationAnalyzer = lazy(() => import('@/components/simulations/AberrationAnalyzer'))
const TelescopeDesigner = lazy(() => import('@/components/simulations/TelescopeDesigner'))
const MicroscopeSystem = lazy(() => import('@/components/simulations/MicroscopeSystem'))
const LaserResonator = lazy(() => import('@/components/simulations/LaserResonator'))
const PhotonicCrystal = lazy(() => import('@/components/simulations/PhotonicCrystal'))

function SimLoading() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
    </div>
  )
}

export default function Home() {
  const [currentView, setCurrentView] = useState<ViewId>('home')

  const navigateTo = useCallback((id: ViewId) => {
    setCurrentView(id)
  }, [])

  const goBack = useCallback((id: ViewId) => {
    navigateTo(PARENT_MAP[id] || 'home')
  }, [navigateTo])

  /* ─── 渲染主内容区 ─── */
  let content: ReactNode
  let footerText = 'v5.0 · 光学仿真实验平台 — 17 个实验模块 · 侧边栏导航 · 全局搜索'

  if (currentView === 'home') {
    content = <HomeContent onNavigate={navigateTo} />
  } else if (currentView === 'physical-hub') {
    const branch = NAV_TREE.find(b => b.id === 'physical')!
    content = (
      <HubContent
        title={branch.title}
        subtitle={branch.description}
        experiments={branch.experiments}
        onNavigate={navigateTo}
      />
    )
    footerText = 'v5.0 · 物理光学 — 7 个实验 · 偏振 · 衍射 · 旋光 · 应力 · 液晶 · 干涉'
  } else if (currentView === 'geometric-hub') {
    const branch = NAV_TREE.find(b => b.id === 'geometric')!
    content = (
      <HubContent
        title={branch.title}
        subtitle={branch.description}
        experiments={branch.experiments}
        onNavigate={navigateTo}
      />
    )
    footerText = 'v5.0 · 几何光学 — 5 个实验 · 透镜成像 · 棱镜分光 · 像差 · 望远镜 · 显微镜'
  } else if (currentView === 'modern-hub') {
    const branch = NAV_TREE.find(b => b.id === 'modern')!
    content = (
      <HubContent
        title={branch.title}
        subtitle={branch.description}
        experiments={branch.experiments}
        onNavigate={navigateTo}
      />
    )
    footerText = 'v5.0 · 现代光学 — 5 个实验 · 高斯光束 · 光纤模式 · 傅里叶光学 · 谐振腔 · 光子晶体'
  } else {
    // 实验模块
    const exp = findExperiment(currentView)
    const branch = findBranch(currentView)
    if (exp && branch) {
      footerText = `v5.0 · ${branch.title} / ${exp.title}`
    }

    const simProps = { onBack: () => goBack(currentView) }
    switch (currentView) {
      case 'physical-jones':
        content = <Suspense fallback={<SimLoading />}><JonesPolarizationLab {...simProps} /></Suspense>
        break
      case 'physical-diffraction':
        content = <Suspense fallback={<SimLoading />}><VectorDiffractionWorkshop {...simProps} /></Suspense>
        break
      case 'physical-polarimeter':
        content = <Suspense fallback={<SimLoading />}><PolarimeterExperiment {...simProps} /></Suspense>
        break
      case 'physical-lcvalve':
        content = <Suspense fallback={<SimLoading />}><LiquidCrystalValve {...simProps} /></Suspense>
        break
      case 'physical-scanner':
        content = <Suspense fallback={<SimLoading />}><PolarizationScanner {...simProps} /></Suspense>
        break
      case 'physical-michelson':
        content = <Suspense fallback={<SimLoading />}><MichelsonInterferometer {...simProps} /></Suspense>
        break
      case 'physical-young-grating':
        content = <Suspense fallback={<SimLoading />}><YoungGratingExperiment {...simProps} /></Suspense>
        break
      case 'modern-gaussian':
        content = <Suspense fallback={<SimLoading />}><GaussianBeamTracer {...simProps} /></Suspense>
        break
      case 'geometric-raytracing':
        content = <Suspense fallback={<SimLoading />}><RayTracingLab {...simProps} /></Suspense>
        break
      case 'geometric-prism':
        content = <Suspense fallback={<SimLoading />}><PrismSpectrometer {...simProps} /></Suspense>
        break
      case 'geometric-aberration':
        content = <Suspense fallback={<SimLoading />}><AberrationAnalyzer {...simProps} /></Suspense>
        break
      case 'geometric-telescope':
        content = <Suspense fallback={<SimLoading />}><TelescopeDesigner {...simProps} /></Suspense>
        break
      case 'geometric-microscope':
        content = <Suspense fallback={<SimLoading />}><MicroscopeSystem {...simProps} /></Suspense>
        break
      case 'modern-fiber':
        content = <Suspense fallback={<SimLoading />}><FiberModeSimulator {...simProps} /></Suspense>
        break
      case 'modern-fourier':
        content = <Suspense fallback={<SimLoading />}><FourierOptics4f {...simProps} /></Suspense>
        break
      case 'modern-resonator':
        content = <Suspense fallback={<SimLoading />}><LaserResonator {...simProps} /></Suspense>
        break
      case 'modern-photonic':
        content = <Suspense fallback={<SimLoading />}><PhotonicCrystal {...simProps} /></Suspense>
        break
      default:
        content = <HomeContent onNavigate={navigateTo} />
    }
  }

  return (
    <AppShell currentView={currentView} onNavigate={navigateTo} footerText={footerText}>
      <div key={currentView} className="h-full" style={{ animation: 'content-fade-in 200ms ease-out' }}>
        {content}
      </div>
      <style>{`
        @keyframes content-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </AppShell>
  )
}
