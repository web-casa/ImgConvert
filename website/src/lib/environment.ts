// SPDX-License-Identifier: Apache-2.0
export const environmentCopy = {
  zh: {
    title: "让图片更轻，让存储更从容。",
    intro:
      "减少不必要的数据，是更节制地使用数字资源的一小步。ImgConvert 能测量文件变小了多少；环境影响则需要额外假设。",
    home: "首页",
    convert: "开始转换",
    eyebrow: "ImgConvert / 存储与环境",
    local: "事实与假设，分开展示",
    facts: [
      [
        "01 / 文件",
        "可以测量的变化",
        "输入与输出的字节差是可测量的。只有实际替换原文件，才可能降低持续保存的数据量；下载新文件不会自动删除原图。",
      ],
      [
        "02 / 存储",
        "持续运行的资源",
        "云存储需要设备和电力。平均分摊模型可以描述容量对应的运行影响，但少存一个文件并不意味着硬盘立即少耗电或停止生产。",
      ],
      [
        "03 / 生命周期",
        "制造与废弃也有代价",
        "电子设备制造需要材料与能源，废弃后需要妥善回收。2022 年全球产生约 6200 万吨电子废弃物，仅 22.3% 有记录地得到正规收集与回收。这是全部电子废弃物的数据，不是存储设备专属统计。",
      ],
    ],
    individual: "一份更小的文件",
    individualIntro: "假设更小的文件替代云端原文件，且持续保留指定天数。1 MB = 1,000,000 字节。",
    mb: "减少的容量（MB，0–1,000,000）",
    days: "天数（整数）",
    copies: "副本数",
    retained: "我仍保留原图",
    cloud: "探索云存储假设（本地或未知存储不估算）",
    unknown: "仅记录容量变化；本地或未知存储不提供电力和碳排放数字。",
    retainedMessage: "保留原图时，不展示正向存储环境效益。",
    global: "如果每人每天少存 1 MB",
    globalIntro:
      "以 ITU 2025 年约 60 亿网民为固定基数。每天新增的一批数据从当天起计入保留时间，计算期末累计的容量与整个期间的运行影响。",
    participation: "参与比例（0–100%）",
    end: "期末容量差（十进制 EB）",
    estimate: "云存储情景估算",
    energy: "运行电力分摊",
    carbon: "运行碳排放分摊",
    invalid: "请输入范围内的有效数值；天数必须是整数（单文件 0–3650，全球 1–3650）。",
    noJs: "交互计算器需要 JavaScript；下方的方法与来源无需 JavaScript 即可阅读。",
    method: "这些数字如何得到",
    formula:
      "容量（TB）× 保留时间（小时）× 存储功率系数 × PUE × 副本数 = 电量（Wh）。电量 ÷ 1000 × 电力碳强度 = 克 CO₂。全球情景按每日新增批次累计保留时间：D × (D + 1) ÷ 2 个日批次。",
    factors:
      "模型 v1.0.0：存储 0.65–1.2 Wh/TB·h，PUE 1.1–1.185，电力碳强度 473 g CO₂/kWh（2024 年全球平均）。单文件默认副本为 1–3；全球默认 1。系数来自历史资料，不代表当前特定供应商或本地设备。",
    limits:
      "这是平均容量分摊情景，不是边际节电、已实现减排或净减排。上下限来自假设组合，不是置信区间。模型不含转换耗电、网络传输、硬件制造、处置和反弹效应，不能换算成少造多少硬盘、种树或碳抵消。",
    practical: "可以采取的小行动",
    actions: [
      "先比较画质与用途，再决定是否保留压缩结果。",
      "确认备份和保留需求后，自行决定是否替换原图；ImgConvert 不代你删除。",
      "减少不必要的重复副本，延长设备使用寿命，并选择正规的电子废弃物回收渠道。",
    ],
    privacy: "计算在当前页面本地完成，参数不保存、不上传；没有全站减碳计数器。",
    sources: "来源与口径",
    range: "假设范围，非置信区间",
    reset: "重置参数",
  },
  en: {
    title: "Lighter images. More considered storage.",
    intro:
      "Removing unnecessary data is a small step toward using digital resources more carefully. ImgConvert can measure a smaller file; environmental impact needs additional assumptions.",
    home: "Home",
    convert: "Start converting",
    eyebrow: "ImgConvert / Storage & environment",
    local: "Measurements and assumptions, kept distinct",
    facts: [
      [
        "01 / File",
        "A measurable difference",
        "The byte difference between input and output is measurable. Stored data may decrease only when the original is actually replaced. Downloading an output does not delete the original.",
      ],
      [
        "02 / Storage",
        "Resources that keep running",
        "Cloud storage uses equipment and electricity. Average allocation models describe operational impact associated with capacity. A smaller file does not immediately reduce a drive’s power draw or prevent its manufacture.",
      ],
      [
        "03 / Lifecycle",
        "Beyond electricity",
        "Making electronics requires materials and energy; discarded devices need responsible recycling. Global e-waste reached about 62 million tonnes in 2022, with 22.3% documented as formally collected and recycled. These figures cover all e-waste, not storage devices alone.",
      ],
    ],
    individual: "One smaller file",
    individualIntro:
      "Assume a smaller file replaces its cloud-stored original for the selected retention period. 1 MB = 1,000,000 bytes.",
    mb: "Capacity reduction (MB, 0–1,000,000)",
    days: "Days (whole number)",
    copies: "Copies",
    retained: "I still retain the original",
    cloud: "Explore a cloud storage hypothetical (no estimate for local or unknown storage)",
    unknown:
      "Capacity difference only. Local or unknown storage does not receive electricity or carbon estimates.",
    retainedMessage: "Retaining the original does not support a positive storage benefit estimate.",
    global: "What if everyone stored 1 MB less each day?",
    globalIntro:
      "Uses a fixed base of approximately 6 billion internet users from ITU 2025. Each daily cohort is retained from its day of addition. The result covers capacity at period end and operational impact over the whole period.",
    participation: "Participation (0–100%)",
    end: "Capacity difference at period end (decimal EB)",
    estimate: "Cloud storage scenario estimate",
    energy: "Allocated operational electricity",
    carbon: "Allocated operational emissions",
    invalid:
      "Enter values within the stated bounds. Days must be whole numbers (single file: 0–3650; global: 1–3650).",
    noJs: "Interactive calculators require JavaScript. The method and sources below remain readable without it.",
    method: "How the numbers are calculated",
    formula:
      "Capacity (TB) × retention (hours) × storage energy factor × PUE × copies = energy (Wh). Energy ÷ 1000 × grid carbon intensity = grams CO₂. The global scenario accumulates daily cohorts using D × (D + 1) ÷ 2 cohort-days.",
    factors:
      "Model v1.0.0: storage 0.65–1.2 Wh/TB·h, PUE 1.1–1.185, grid intensity 473 g CO₂/kWh (2024 global average). Single-file copies default to 1–3; global copies default to 1. Historical factors do not represent a specific current provider or local device.",
    limits:
      "This is an average capacity allocation scenario, not marginal electricity savings, achieved reductions or net reductions. The range combines assumptions; it is not a confidence interval. Conversion energy, networks, hardware manufacture, disposal and rebound effects are excluded. Do not translate it into drives not manufactured, trees or carbon offsets.",
    practical: "Small actions you can take",
    actions: [
      "Compare visual quality and intended use before keeping a compressed result.",
      "Review backups and retention needs before deciding to replace originals yourself. ImgConvert does not delete them for you.",
      "Avoid unnecessary duplicates, extend equipment life and use responsible electronics recycling channels.",
    ],
    privacy:
      "Calculations run locally in this page. Parameters are neither saved nor uploaded. There is no global carbon-savings counter.",
    sources: "Sources and scope",
    range: "Assumption range, not a confidence interval",
    reset: "Reset parameters",
  },
} as const;

export const environmentSources = [
  {
    title: "Cloud Carbon Footprint — methodology",
    url: "https://www.cloudcarbonfootprint.org/docs/methodology/",
  },
  {
    title: "Ember — Global Electricity Review 2025 (PDF)",
    url: "https://ember-energy.org/app/uploads/2025/04/Report-Global-Electricity-Review-2025.pdf",
  },
  {
    title: "ITU — Facts and Figures 2025",
    url: "https://www.itu.int/en/mediacentre/Pages/PR-2025-11-17-Facts-and-Figures.aspx",
  },
  {
    title: "ITU / UNITAR — Global E-waste Monitor 2024",
    url: "https://www.itu.int/en/mediacentre/Pages/PR-2024-03-20-e-waste-recycling.aspx",
  },
] as const;
