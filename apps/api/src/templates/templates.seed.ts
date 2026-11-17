export const DOC_TEMPLATE_SEED = [
  {
    code: 'nda_summary',
    title: '保密沟通摘要（NDA 要点备忘）',
    kind: 'nda_summary',
    sortOrder: 10,
    placeholders: ['demandOrg', 'supplyOrg', 'demandTitle', 'supplyTitle', 'brokerName', 'dateZh'],
    bodyMd: `# 保密沟通摘要（业务备忘）

> **声明**：本稿仅为业务沟通骨架，**不构成法律意见**，正式 NDA 请由合格律师审定后签署。研企通仅提供对接草稿。

- 日期：{{dateZh}}
- 需求方（化名/全称）：{{demandOrg}}
- 供给方（化名/全称）：{{supplyOrg}}
- 对接主题：{{demandTitle}} ↔ {{supplyTitle}}
- 经纪人/对接人：{{brokerName}}

## 拟保密范围（草稿勾选）
1. 双方交换的技术参数、工艺窗口、未公开图纸与报价口径
2. 样品测试数据与失败分析（如有）
3. 商务条款谈判过程中的非公开信息

## 拟例外
- 已经公开或可从公开渠道合法获得的信息
- 接收方有书面证明在披露前已合法持有的信息

## 下一步
- [ ] 双方确认是否需要正式双边 NDA
- [ ] 指定接收人邮箱与保存期限（建议）
- [ ] 样品试用是否另签备忘（见「样品试用备忘」模板）
`,
  },
  {
    code: 'moi_tech_transfer',
    title: '技转合作意向书骨架',
    kind: 'moi_tech_transfer',
    sortOrder: 20,
    placeholders: ['demandOrg', 'supplyOrg', 'demandTitle', 'supplyTitle', 'problem', 'trl', 'licenseNeed', 'budgetBand', 'brokerName', 'dateZh', 'checklistPct'],
    bodyMd: `# 技术转移 / 产学研合作意向书（骨架）

> **声明**：本稿为意向沟通骨架，**非合同、非法律意见**。排他许可、价款、知识产权归属等以正式合同为准。

**日期**：{{dateZh}}  
**经纪人**：{{brokerName}}

## 一、双方
- 需求方：{{demandOrg}}
- 供给方：{{supplyOrg}}

## 二、合作标的（草稿）
- 需求：{{demandTitle}}
- 问题简述：{{problem}}
- 供给能力/成果：{{supplyTitle}}
- 供给侧 TRL（如已知）：{{trl}}
- 需求许可诉求：{{licenseNeed}}
- 预算量级：{{budgetBand}}
- 合同前清单完成度：{{checklistPct}}%

## 三、拟合作方式（勾选讨论）
- [ ] 技术许可（普通 / 排他待定）
- [ ] 联合攻关 / 委托开发
- [ ] 作价入股或成立项目公司（仅意向）
- [ ] 样品试用 → 小试 → 量产评估

## 四、下一步与时间盒
1. 完成关键尽调项（IP 路径、TRL、预算决策人）
2. 约定首次技术交流会时间
3. 明确是否启动正式合同文本起草

（签字栏留空——本系统不提供电子签。）
`,
  },
  {
    code: 'sample_trial_memo',
    title: '样品试用备忘',
    kind: 'sample_trial_memo',
    sortOrder: 30,
    placeholders: ['demandOrg', 'supplyOrg', 'demandTitle', 'supplyTitle', 'brokerName', 'dateZh', 'region'],
    bodyMd: `# 样品 / 试用备忘（非销售合同）

> **声明**：本稿描述试用安排草稿，**不构成买卖或法律意见**。运输、保险、损坏责任以双方正式协议为准。

- 日期：{{dateZh}}
- 需求方：{{demandOrg}}
- 供给方：{{supplyOrg}}
- 主题：{{demandTitle}} / {{supplyTitle}}
- 对接人：{{brokerName}}
- 地域提示：{{region}}

## 试用目的
- 验证关键指标是否达到需求窗口
- 收集失败模式与改进建议

## 拟提供物（草稿）
- [ ] 样品数量与规格：________
- [ ] 测试协议 / 数据回报格式：________
- [ ] 试用周期：____ 天
- [ ] 是否允许反向工程：否（默认）

## 费用与归属（待谈）
- 样品费用承担方：________
- 试用数据双方是否可共享至对接平台运营（脱敏）：待确认

## 结束后
- [ ] 出具简短试用结论（成功 / 条件成功 / 不继续）
- [ ] 如继续，转入「技转合作意向书」讨论
`,
  },
];
