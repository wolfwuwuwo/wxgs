/**
 * 全局导航树配置 — 三大光学分支 + 17 个实验模块
 * 供侧边栏、搜索框、面包屑共享
 */

export type ViewId =
  | 'home'
  | 'physical-hub'
  | 'physical-jones'
  | 'physical-diffraction'
  | 'physical-polarimeter'
  | 'physical-lcvalve'
  | 'physical-scanner'
  | 'physical-michelson'
  | 'physical-young-grating'
  | 'geometric-hub'
  | 'geometric-raytracing'
  | 'geometric-prism'
  | 'geometric-aberration'
  | 'geometric-telescope'
  | 'geometric-microscope'
  | 'modern-hub'
  | 'modern-gaussian'
  | 'modern-fiber'
  | 'modern-fourier'
  | 'modern-resonator'
  | 'modern-photonic'

export type BranchId = 'geometric' | 'physical' | 'modern'

export interface ExperimentNode {
  id: ViewId
  title: string
  shortTitle: string
  description: string
  iconText: string
  keywords: string[]
  comingSoon?: boolean
}

export interface BranchNode {
  id: BranchId
  hubId: ViewId
  title: string
  shortTitle: string
  description: string
  longDescription: string
  iconText: string
  keywords: string[]
  experiments: ExperimentNode[]
}

export const NAV_TREE: BranchNode[] = [
  {
    id: 'geometric',
    hubId: 'geometric-hub',
    title: '几何光学',
    shortTitle: '几何',
    description: '光线追迹、透镜成像、棱镜分光、望远镜与显微镜系统',
    longDescription:
      '以光线模型为基础，研究光在透镜、棱镜等光学元件中的传播与成像规律。涵盖薄透镜成像、透镜组合、球面镜、棱镜分光与色散、望远镜与显微镜光学系统设计。通过三条主光线追迹法直观验证高斯成像公式，观察最小偏向角与柯西色散关系。',
    iconText: '▽',
    keywords: ['光线', '透镜', '成像', '棱镜', '分光', '色散', '焦距', '光谱', 'ray', 'lens', 'prism'],
    experiments: [
      {
        id: 'geometric-raytracing',
        title: '光线追迹与透镜成像',
        shortTitle: '光线追迹',
        description: '薄透镜成像·透镜组合·球面镜·棱镜分光，三条主光线追迹，实时成像判定',
        iconText: '▽',
        keywords: ['薄透镜', '成像', '焦距', '放大率', '主光线', '透镜组合', '球面镜'],
      },
      {
        id: 'geometric-prism',
        title: '棱镜光谱仪',
        shortTitle: '棱镜光谱',
        description: 'Cauchy色散+最小偏向角+光谱分析+棱镜组合(Amici/Pellin-Broca)，4种实验模式',
        iconText: '△',
        keywords: ['棱镜', '色散', '柯西', 'Cauchy', '最小偏向角', '光谱', 'Amici', 'Pellin-Broca'],
      },
      {
        id: 'geometric-aberration',
        title: '光学像差分析',
        shortTitle: '像差分析',
        description: '5种初级像差(球差/彗差/像散/场曲/畸变)+点列图+光扇图+Seidel系数，3种实验模式',
        iconText: '∇',
        keywords: ['像差', 'aberration', '球差', '彗差', '像散', '场曲', '畸变', 'Seidel', '点列图', '光扇图', '波像差'],
      },
      {
        id: 'geometric-telescope',
        title: '望远镜系统设计器',
        shortTitle: '望远镜',
        description: '伽利略/开普勒/牛顿/卡塞格林四型望远镜，主光线追迹，放大率与出瞳，遮拦比分析',
        iconText: 'T',
        keywords: ['望远镜', 'telescope', '伽利略', 'Galilean', '开普勒', 'Keplerian', '牛顿', 'Newtonian', '卡塞格林', 'Cassegrain', '放大率', '出瞳', '焦距', '主镜', '副镜', '遮拦'],
      },
      {
        id: 'geometric-microscope',
        title: '显微镜光学系统',
        shortTitle: '显微镜',
        description: '物镜+目镜级联成像，数值孔径NA，Abbe分辨率极限，视场与放大率链，3种物镜',
        iconText: 'M',
        keywords: ['显微镜', 'microscope', '物镜', 'objective', '目镜', 'eyepiece', '数值孔径', 'NA', 'Abbe', '分辨率', '放大率', '视场', '孔径光阑'],
      },
    ],
  },
  {
    id: 'physical',
    hubId: 'physical-hub',
    title: '物理光学',
    shortTitle: '物理',
    description: '干涉、衍射、偏振、旋光、波前再现',
    longDescription:
      '以光的波动性为基础，研究干涉、衍射、偏振与旋光现象。包含琼斯矩阵偏振态分析、矢量衍射角谱法、旋光色散与变旋现象、应力双折射偏振扫描、液晶旋光光阀的Berreman 4×4传输矩阵。强调偏振椭圆、庞加莱球、Michel-Lévy色谱等可视化。',
    iconText: '◎',
    keywords: ['偏振', '衍射', '干涉', '旋光', '波前', '琼斯', 'FFT', '应力', '液晶', 'polarization', 'diffraction'],
    experiments: [
      {
        id: 'physical-jones',
        title: '偏振琼斯矩阵实验室',
        shortTitle: '琼斯矩阵',
        description: '5种模式(基础/BS补偿器/偏振态测量/消偏振/偏光显微镜)，3D偏振椭圆+庞加莱球+电场螺旋',
        iconText: 'J',
        keywords: ['琼斯', 'Jones', '偏振', '偏振片', '波片', '庞加莱', 'Poincare', '偏振椭圆', '斯托克斯'],
      },
      {
        id: 'physical-diffraction',
        title: '全波前矢量衍射工坊',
        shortTitle: '矢量衍射',
        description: '角谱衍射ASM+矢量衍射(Ex/Ey/Ez)，手绘口径+高斯切趾，巴比涅/光栅/瑞利/全息五大实验模式',
        iconText: 'D',
        keywords: ['衍射', 'diffraction', '角谱', 'ASM', 'FFT', '光栅', '巴比涅', 'Babinet', '瑞利', '全息', '口径'],
      },
      {
        id: 'physical-polarimeter',
        title: '旋光仪实验',
        shortTitle: '旋光仪',
        description: 'Drude旋光色散+变旋现象+半荫法+浓度测定，6种实验模式，3D虚拟仪器',
        iconText: 'α',
        keywords: ['旋光', 'polarimeter', 'Drude', '色散', '变旋', '半荫法', '浓度', '葡萄糖', '比旋光度'],
      },
      {
        id: 'physical-scanner',
        title: '偏振视觉扫描仪',
        shortTitle: '偏振扫描',
        description: 'Sénarmont补偿+RGB色散+3D应力图+定量应力测量+教学演示库，4种实验模式',
        iconText: '◎',
        keywords: ['偏振', '扫描', 'scanner', '应力', '双折射', 'Senarmont', 'Michel-Levy', ' Michel Lévy', '伪彩色'],
      },
      {
        id: 'physical-lcvalve',
        title: '液晶旋光光阀实验台',
        shortTitle: '液晶光阀',
        description: 'Oseen-Frank+Berreman 4×4，TN/IPS/VA模式对比，3D指向矢，5种实验模式',
        iconText: 'LC',
        keywords: ['液晶', 'liquid crystal', 'Berreman', 'Oseen-Frank', 'TN', 'IPS', 'VA', '指向矢', '光阀', 'Freedericksz'],
      },
      {
        id: 'physical-michelson',
        title: '迈克尔逊干涉仪',
        shortTitle: '迈克尔逊',
        description: '等倾干涉·等厚干涉·白光干涉·条纹计数，可调镜面倾角与光程差，4种实验模式',
        iconText: 'M',
        keywords: ['迈克尔逊', 'Michelson', '干涉仪', '等倾', '等厚', '白光干涉', '光程差', '条纹', '干涉条纹', '补偿板'],
      },
      {
        id: 'physical-young-grating',
        title: '双缝干涉与光栅衍射',
        shortTitle: '双缝光栅',
        description: '杨氏双缝+多缝光栅+衍射级次+角色散，缝宽/缝间距/缝数可调，3种实验模式',
        iconText: 'Y',
        keywords: ['杨氏', 'Young', '双缝', '光栅', 'grating', '衍射', '干涉', '级次', '角色散', '分辨本领', '瑞利判据'],
      },
    ],
  },
  {
    id: 'modern',
    hubId: 'modern-hub',
    title: '现代光学',
    shortTitle: '现代',
    description: '激光传输、空间滤波、光纤模式、谐振腔与光子晶体',
    longDescription:
      '以激光与近代光学理论为基础，研究高斯光束的传输与变换、阶跃折射率光纤的模式场分布与色散特性、激光谐振腔的稳定性与本征模、光子晶体的带隙与缺陷态。运用复束参量q的ABCD变换追踪高斯光束，求解LP模式本征方程，分析多模色散与弯曲损耗。',
    iconText: 'G',
    keywords: ['激光', '高斯光束', '光纤', '模式', '色散', 'LP', '空间滤波', 'Gaussian', 'fiber', 'laser'],
    experiments: [
      {
        id: 'modern-gaussian',
        title: '高斯光束追踪器',
        shortTitle: '高斯光束',
        description: '拖拽调节束腰半径、波长、传输距离、透镜焦距，实时渲染光束宽度沙漏形包络曲线与光斑演化',
        iconText: 'G',
        keywords: ['高斯光束', 'Gaussian', '束腰', '瑞利长度', 'q参量', 'ABCD', '透镜', '光斑', '发散角'],
      },
      {
        id: 'modern-fiber',
        title: '阶跃光纤模式仿真器',
        shortTitle: '光纤模式',
        description: 'LP模式求解+多模分析+色散特性+耦合效率+弯曲损耗，3D模式场可视化，5种实验模式',
        iconText: 'Φ',
        keywords: ['光纤', 'fiber', 'LP模式', '阶跃折射率', '色散', '耦合', '弯曲损耗', 'V参数', '数值孔径', 'NA'],
      },
      {
        id: 'modern-fourier',
        title: '傅里叶光学 4f 系统',
        shortTitle: '傅里叶4f',
        description: '4f系统空间滤波·低通/高通/带通/方向滤波·频谱面可视化·卷积定理演示，4种实验模式',
        iconText: 'F',
        keywords: ['傅里叶', 'Fourier', '4f', '空间滤波', '频谱', 'FFT', '低通', '高通', '带通', '方向滤波', '卷积', '光学信息处理'],
      },
      {
        id: 'modern-resonator',
        title: '激光谐振腔设计器',
        shortTitle: '谐振腔',
        description: '稳定性图g1·g2·ABCD往返传输·Hermite-Gaussian本征模·凹凸镜组合，4种腔型',
        iconText: 'R',
        keywords: ['激光', 'laser', '谐振腔', 'resonator', '腔', '稳定性', 'g参数', 'ABCD', '本征模', 'Hermite', '高斯', '凹面镜', '共焦', '半球', '平面'],
      },
      {
        id: 'modern-photonic',
        title: '光子晶体带隙仿真',
        shortTitle: '光子晶体',
        description: '1D/2D周期介电层·带隙图谱·缺陷态模式·布里渊区·透射谱，3种晶格',
        iconText: 'P',
        keywords: ['光子晶体', 'photonic crystal', '带隙', 'band gap', '缺陷态', 'defect', '布里渊区', 'Brillouin', '透射谱', '介电层', '周期结构', 'Bragg'],
      },
    ],
  },
]

/** 扁平化所有实验节点（用于搜索） */
export const ALL_EXPERIMENTS: ExperimentNode[] = NAV_TREE.flatMap(b => b.experiments)

/** 父级映射：实验 → 所属 hub；hub → home */
export const PARENT_MAP: Partial<Record<ViewId, ViewId>> = {
  'physical-hub': 'home',
  'geometric-hub': 'home',
  'modern-hub': 'home',
  'physical-jones': 'physical-hub',
  'physical-diffraction': 'physical-hub',
  'physical-polarimeter': 'physical-hub',
  'physical-lcvalve': 'physical-hub',
  'physical-scanner': 'physical-hub',
  'modern-gaussian': 'modern-hub',
  'modern-fiber': 'modern-hub',
  'modern-fourier': 'modern-hub',
  'geometric-raytracing': 'geometric-hub',
  'geometric-prism': 'geometric-hub',
  'geometric-aberration': 'geometric-hub',
  'geometric-telescope': 'geometric-hub',
  'geometric-microscope': 'geometric-hub',
  'physical-michelson': 'physical-hub',
  'physical-young-grating': 'physical-hub',
  'modern-resonator': 'modern-hub',
  'modern-photonic': 'modern-hub',
}

/** 根据 ViewId 查找实验节点 */
export function findExperiment(id: ViewId): ExperimentNode | undefined {
  return ALL_EXPERIMENTS.find(e => e.id === id)
}

/** 根据 ViewId 查找所属分支 */
export function findBranch(id: ViewId): BranchNode | undefined {
  return NAV_TREE.find(b => b.hubId === id || b.experiments.some(e => e.id === id))
}

/** 获取面包屑路径 */
export function getBreadcrumb(id: ViewId): { label: string; viewId: ViewId }[] {
  const crumbs: { label: string; viewId: ViewId }[] = []
  let current: ViewId | undefined = id
  while (current && current !== 'home') {
    const exp = findExperiment(current)
    if (exp) {
      crumbs.unshift({ label: exp.shortTitle, viewId: exp.id })
    } else {
      const branch = findBranch(current)
      if (branch) {
        crumbs.unshift({ label: branch.title, viewId: branch.hubId })
      }
    }
    current = PARENT_MAP[current]
  }
  crumbs.unshift({ label: '首页', viewId: 'home' })
  return crumbs
}

/** 搜索实验：返回匹配的实验节点（标题+描述+关键词） */
export function searchExperiments(query: string): ExperimentNode[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return ALL_EXPERIMENTS.filter(e => {
    const haystack = [e.title, e.shortTitle, e.description, ...e.keywords].join(' ').toLowerCase()
    return haystack.includes(q)
  })
}
