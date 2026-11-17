/** 中国技转常用轻量类目：扁平 + 可选父级 */
export const TAXONOMY_SEED: Array<{
  code: string;
  labelZh: string;
  parentCode?: string | null;
  synonyms?: string[];
  sortOrder: number;
}> = [
  { code: 'mfg', labelZh: '先进制造', sortOrder: 10, synonyms: ['智能制造', '离散制造'] },
  { code: 'mfg.vision', labelZh: '工业视觉检测', parentCode: 'mfg', sortOrder: 11, synonyms: ['机器视觉', '缺陷检测'] },
  { code: 'mfg.robot', labelZh: '工业机器人/协作机器人', parentCode: 'mfg', sortOrder: 12, synonyms: ['cobot', '柔性装配'] },
  { code: 'mfg.twin', labelZh: '数字孪生与仿真', parentCode: 'mfg', sortOrder: 13, synonyms: ['工艺仿真', '产线孪生'] },
  { code: 'mfg.mes', labelZh: 'MES/工业软件', parentCode: 'mfg', sortOrder: 14, synonyms: ['工控软件'] },
  { code: 'mfg.mold', labelZh: '模具与成型', parentCode: 'mfg', sortOrder: 15, synonyms: ['注塑', '冷却水路'] },

  { code: 'mat', labelZh: '新材料', sortOrder: 20, synonyms: ['材料科学'] },
  { code: 'mat.coat', labelZh: '涂层与表面工程', parentCode: 'mat', sortOrder: 21, synonyms: ['镀膜', '均匀性'] },
  { code: 'mat.battery', labelZh: '电池与储能材料', parentCode: 'mat', sortOrder: 22, synonyms: ['锂电', '热管理'] },
  { code: 'mat.comp', labelZh: '复合材料', parentCode: 'mat', sortOrder: 23 },

  { code: 'energy', labelZh: '能源与动力', sortOrder: 30 },
  { code: 'energy.thermal', labelZh: '热管理/散热', parentCode: 'energy', sortOrder: 31, synonyms: ['冷却', '热仿真'] },
  { code: 'energy.pv', labelZh: '光伏与新能源', parentCode: 'energy', sortOrder: 32 },
  { code: 'energy.hydrogen', labelZh: '氢能与燃料电池', parentCode: 'energy', sortOrder: 33 },

  { code: 'ict', labelZh: '信息与通信', sortOrder: 40 },
  { code: 'ict.ai', labelZh: '人工智能应用', parentCode: 'ict', sortOrder: 41, synonyms: ['机器学习', '深度学习'] },
  { code: 'ict.edge', labelZh: '边缘计算/嵌入式', parentCode: 'ict', sortOrder: 42 },
  { code: 'ict.sec', labelZh: '网络安全与密码', parentCode: 'ict', sortOrder: 43 },
  { code: 'ict.soft', labelZh: '行业软件与中台', parentCode: 'ict', sortOrder: 44 },

  { code: 'bio', labelZh: '生物医药与健康', sortOrder: 50 },
  { code: 'bio.device', labelZh: '医疗器械', parentCode: 'bio', sortOrder: 51 },
  { code: 'bio.pharma', labelZh: '药物研发与制剂', parentCode: 'bio', sortOrder: 52 },
  { code: 'bio.diag', labelZh: '体外诊断', parentCode: 'bio', sortOrder: 53 },

  { code: 'agri', labelZh: '现代农业', sortOrder: 60 },
  { code: 'agri.sense', labelZh: '农业遥感与传感', parentCode: 'agri', sortOrder: 61, synonyms: ['植保', '长势监测'] },
  { code: 'agri.equip', labelZh: '农机装备', parentCode: 'agri', sortOrder: 62 },

  { code: 'env', labelZh: '环保与双碳', sortOrder: 70 },
  { code: 'env.water', labelZh: '水处理与污染治理', parentCode: 'env', sortOrder: 71 },
  { code: 'env.carbon', labelZh: '碳监测与减排', parentCode: 'env', sortOrder: 72 },

  { code: 'trans', labelZh: '交通与汽车', sortOrder: 80 },
  { code: 'trans.ev', labelZh: '新能源汽车', parentCode: 'trans', sortOrder: 81 },
  { code: 'trans.auto', labelZh: '智能驾驶与车路', parentCode: 'trans', sortOrder: 82 },

  { code: 'chem', labelZh: '化工与过程工业', sortOrder: 90 },
  { code: 'chem.process', labelZh: '过程强化与催化', parentCode: 'chem', sortOrder: 91 },

  { code: 'ocean', labelZh: '海洋与船舶', sortOrder: 100 },
  { code: 'space', labelZh: '空天与光电', sortOrder: 110 },
  { code: 'edu', labelZh: '教育与文旅科技', sortOrder: 120 },
];
