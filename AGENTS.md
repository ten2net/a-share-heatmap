# AGENTS.md

供 AI 编码代理阅读的项目说明。本文基于当前仓库实际内容编写。

## 项目概述

**a-share-heatmap** 是一个开源的 A 股大盘云图（市场热力图）站点：把整个 A 股市场绘制成一张可交互的 Canvas 矩形树图，色块大小代表可配置的面积指标（流通市值 / 成交额 / 换手率，默认成交额），红绿颜色代表当日（或近 5 日 / 近 20 日 / 今年以来）涨跌幅。

- 技术栈：Next.js 16（App Router）+ React 19 + TypeScript + Tailwind CSS 4 + Canvas 2D，部署在 Vercel Serverless Functions。
- 数据来源：东方财富公开行情快照接口（服务端秒级缓存）；远端不可用时自动回退到仓库内置快照（`src/lib/data/*.json`）。
- 主要功能：多市场范围切换（全市场、沪深 300、中证 A50/A500、创业板、科创板等）、一级行业板块筛选、自选股列表（localStorage 存储）、多周期涨跌、缩放/拖拽/截图分享，以及实验性的 WebMCP 工具集（供浏览器 AI 调用）。
- 包管理器：pnpm（CI 固定 10.15.0），Node 22。

## 常用命令

```bash
pnpm install        # 安装依赖
pnpm dev            # 本地开发（http://localhost:3000）
pnpm build          # 生产构建
pnpm start          # 启动生产服务
pnpm lint           # ESLint 检查
pnpm typecheck      # TypeScript 类型检查（tsc --noEmit）
pnpm refresh:data   # 拉取行情并更新内置快照 JSON（写文件）
pnpm check:data     # 只拉取并校验，不写文件
```

注意：项目**没有自动化测试**（无 jest/vitest/playwright），质量保障依赖 `pnpm lint`、`pnpm typecheck`、`pnpm build`，以及 GitHub Actions 工作流中的构建检查。

## 目录结构与模块划分

```
src/
  app/                    # Next.js App Router
    layout.tsx, page.tsx  # 页面入口；page.tsx 硬编码 locale="zh"
    api/heatmap/          # API Routes（服务端行情代理 + 秒级缓存）
      quotes/route.ts         # 行情快照主接口（market/metric/period/codes 参数）
      quotes/stream/route.ts  # 流式行情
      overview/route.ts       # 市场概览（涨跌家数、成交额）
      search/route.ts         # 股票搜索
      constituents/route.ts   # 指数成分股
  components/
    market-heatmap.tsx    # 核心组件（约 8800 行）：Canvas 树图渲染 + 全部交互 UI
    watchlist-panel.tsx, watchlist-ai-dialog.tsx  # 自选股面板、AI 截图识别对话框
    ui/button.tsx         # 唯一的基础 UI 组件
  hooks/
    use-heatmap-webmcp.ts # WebMcpToolProvider 注册 hook
  lib/
    market-heatmap.ts     # 行情数据获取、解析、校验、缓存与回退逻辑（约 2400 行）
    market-constituents.ts# 指数成分股（如 zza50）快照管理
    i18n.ts               # 中英双语文案（locales: en, zh；默认 zh）
    heatmap-themes.ts     # 热力图配色主题（内置 + 自定义）
    heatmap-webmcp*.ts    # WebMCP 工具定义（主题/视图/筛选/排行/自选）
    watchlist.ts, watchlist-ai.ts  # 自选股存储（localStorage）与 AI 识别（@ai-sdk/openai-compatible）
    heatmap-shortcuts.ts  # 键盘快捷键
    data/*.json           # 内置行情/板块兜底快照（由脚本生成，勿手改）
  types/webmcp.d.ts       # WebMCP 全局类型声明
scripts/refresh-market-data.mjs  # 行情快照刷新脚本（东方财富接口）
.github/workflows/refresh-market-data.yml  # 工作日 18:30（北京时间）自动刷新并提交数据
```

关键领域常量（`src/lib/market-heatmap.ts`）：`marketKeys`（all/sse/szse/hs300/zza50/zza500/main/cyb/kcb）、`heatmapPeriodKeys`（day/week/month/year）、`metricKeys`（"1"–"6"）、`watchlistMaxCount = 500`。

## 代码风格约定

- TypeScript 严格模式，路径别名 `@/` 指向 `src/`。
- 组件中混合使用中文和英文注释/文案；面向用户的文案集中在 `src/lib/i18n.ts` 的 messages 对象中（含 `{count}` 等占位符插值）。
- ESLint 使用 `eslint-config-next`（core-web-vitals + typescript）平铺配置（ESLint 9，`eslint.config.mjs`）；已关闭 `@next/next/no-img-element` 和 `react-hooks/set-state-in-effect`。
- `src/lib/utils.ts` 提供 `cn()`（clsx + tailwind-merge），类名拼接统一用它。
- 客户端组件以 `"use client"` 开头；核心组件 `market-heatmap.tsx` 体积很大，新功能优先放入 `src/lib/` 下的独立模块而非继续膨胀该文件。
- 数据 JSON（`src/lib/data/`）由 `scripts/refresh-market-data.mjs` 生成，手工修改会被 CI 覆盖。

## 数据与缓存架构

- API Routes 代理东方财富 `push2*.eastmoney.com` 接口，服务端做秒级缓存；`maxDuration = 60` 适配 Vercel。
- 远端数据不完整时与内置名册合并；远端完全不可用时使用 `src/lib/data/market-heatmap-fallback.json` / `market-heatmap-subboards.json` 兜底。
- 自选股仅保存在浏览器 localStorage，服务端不存储用户数据。

## 安全注意事项

- 项目声明“无需配置环境变量”；若使用 AI 截图识别等可选功能涉及密钥，不要写入仓库或日志。
- 不要读取/提交 `.env` 类敏感文件；不要修改 `.github/workflows` 中 widening 权限的部分（当前仅 `contents: write` 用于数据提交）。

## 部署

- 一键部署到 Vercel（README 提供 Deploy 按钮），无环境变量。
- 数据刷新工作流提交后会触发 Vercel 重新部署，使内置快照保持最新。
