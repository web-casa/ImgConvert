export const highlights = [
  {
    index: "01",
    title: "本地优先",
    detail: "转换与压缩默认在本机完成，不上传用户图片到任何远端服务。隐私内置在管线里，不靠开关。",
    icon: "shield",
  },
  {
    index: "02",
    title: "Linux 先行",
    detail:
      "第一期 GitHub Releases 提供 amd64/aarch64 AppImage、arm64 deb 与 aarch64 rpm；AppImage 配套 Tauri updater 资产。",
    icon: "launch",
  },
  {
    index: "03",
    title: "许可洁净",
    detail:
      "主程序 Apache-2.0，主依赖树禁止 GPL / AGPL / LGPL，为个人使用、企业内部署与商店上架留门。",
    icon: "scale",
  },
] as const;

export const formats = [
  {
    glyph: "LOSSY · COMPAT",
    name: "JPEG",
    desc: "兼容性最佳，支持自动质量与 skip-if-larger",
    tag: "mozjpeg encoder",
  },
  {
    glyph: "LOSSLESS · ALPHA",
    name: "PNG",
    desc: "无损输出，保留透明度与 ICC/EXIF/XMP",
    tag: "oxipng",
  },
  {
    glyph: "VERSATILE · WEB",
    name: "WebP",
    desc: "体积与质量平衡，无损与有损双模式",
    tag: "libwebp",
  },
  {
    glyph: "NEXT-GEN · 10BIT",
    name: "AVIF",
    desc: "下一代格式，真无损 + 极致压缩比",
    tag: "libavif (rav1e + aom)",
  },
] as const;

export const entryPoints = [
  {
    label: "安装指南",
    desc: "下载、校验、AppImage / deb / rpm 安装",
    href: "/docs/install",
    icon: "download",
  },
  {
    label: "使用说明",
    desc: "批量导入、格式选择、压缩与元数据",
    href: "/docs/usage",
    icon: "book",
  },
  {
    label: "命令速查",
    desc: "开发、质量、发布与文档站的常用命令",
    href: "/docs/commands",
    icon: "terminal",
  },
  {
    label: "排障手册",
    desc: "Linux / AppImage / HEIC / updater 常见问题",
    href: "/docs/troubleshooting",
    icon: "wrench",
  },
  {
    label: "发布流程",
    desc: "GitHub Releases 范围、资产与发布前检查",
    href: "/docs/release",
    icon: "rocket",
  },
  {
    label: "架构设计",
    desc: "前端、Tauri 后端与 Rust 图像核心边界",
    href: "/docs/architecture",
    icon: "blueprint",
  },
  {
    label: "格式能力",
    desc: "支持的输入输出格式、压缩与元数据",
    href: "/docs/formats",
    icon: "image",
  },
  {
    label: "HEIC 策略",
    desc: "为什么主程序不内置，平台后续路线",
    href: "/docs/heic",
    icon: "camera",
  },
  {
    label: "开发质量",
    desc: "本地开发、guardrail 与长期质量项目",
    href: "/docs/development",
    icon: "check",
  },
] as const;

export const stats = [
  { value: "4", label: "主格式 · JPEG/PNG/WebP/AVIF" },
  { value: "2", label: "AppImage · amd64 + aarch64" },
  { value: "2", label: "系统包 · arm64 deb / aarch64 rpm" },
  { value: "∞", label: "本机转换次数 · 不上传任何图" },
] as const;

export const downloadHref = "https://github.com/web-casa/ImgConvert/releases/tag/v0.1.1";
export const repoHref = "https://github.com/web-casa/ImgConvert";
export const version = "v0.1.1";
