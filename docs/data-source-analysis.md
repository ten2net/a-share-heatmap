# 数据源分析报告

> 分析对象：a-share-heatmap（A 股大盘云图）
> 报告日期：2026-09-20
> 代码基线：src/lib/market-heatmap.ts（约 2400 行）+ src/lib/market-constituents.ts + src/app/api/heatmap/* + scripts/refresh-market-data.mjs

## 1. 总体架构

数据链路为四层：

```
东方财富/新浪/同花顺 公开接口
        │  (服务端代理 + 抓取/合并/校验)
src/app/api/heatmap/*  (API Routes,秒级缓存,maxDuration=60)
        │  (8s 轮询 / NDJSON 流 / 首帧快照)
market-heatmap.tsx  (Canvas 渲染)
        ▲
src/lib/data/*.json  (内置兜底快照,仓库内置,CI 定时刷新)
```

设计目标：**单实例零配置部署（Vercel Serverless），不依赖任何环境变量与自建后端**，在公开行情接口不稳定的前提下保证页面"永远有数据可画"。

## 2. 上游数据源

### 2.1 东方财富（主源）

镜像主机列表见 `src/lib/market-heatmap.ts:193-199`，首次请求优先 `push2delay`，重试轮换 `82/7/48.push2` 等镜像。

| 接口 | 用途 | 关键参数 |
|---|---|---|
| `GET https://{host}/api/qt/clist/get` | 全 A 股快照分页拉取 | `pn/pz=100`、`fltt=2`、`fid=f12`、`fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048`（沪深京 A 股全集）、`fields=f2,f3,f6,f12,f13,f14,f18,f20,f21,f24,f25,f100,f109,f110,f124` |
| `GET /api/qt/ulist.np/get` | 按代码批量行情（clist 失败时备份） | `secids=1.600000,0.000001,...`（SH=1/其他=0），批量 180、并发 4 |
| `GET https://datacenter.eastmoney.com/api/data/v1/get` | 中证 A50 成分股 | `reportName=RPT_INDEX_TS_COMPONENT`、`filter=(TYPE="5")`（`src/lib/market-constituents.ts:132-174`） |
| `webquotepic.eastmoney.com/GetPic.aspx` | 分享截图的日 K 线图片（仅外链图片，不入数据流） | — |

clist 字段含义（`market-heatmap.ts:259-275`）：f2 最新价、f3 当日涨跌幅、f6 成交额（元）、f12 代码、f13 市场标志、f14 名称、f18 昨收、f20 总市值、f21 流通市值、f24 60 日涨跌（month 兜底）、f25 年初至今、f100 东财二级行业、f109 5 日涨跌、f110 20 日涨跌、f124 行情时间戳。

### 2.2 新浪（备份源）

`https://hq.sinajs.cn/list=`（需 Referer `finance.sina.com.cn`），GBK 文本协议（以 latin1 硬转解码，`market-heatmap.ts:982`），仅含日线价格/昨收/成交额，批量 220。涨跌幅由 `(price-prevClose)/prevClose*100` 自算（`:700`）。无 week/month/year 字段。

### 2.3 同花顺（概览补充源）

- `dq.10jqka.com.cn/fuyao/up_down_distribution/distribution/v2/realtime` → 官方涨跌家数
- `dq.10jqka.com.cn/fuyao/market_analysis_api/chart/v1/get?chart_key=turnover_minute` → 当日/昨日成交额（`:1587-1632`）

仅在 `market=all 且 period=day` 时用于概览侧栏（`:2120-2129`），且失败时静默保留旧值。

## 3. 双源合并与降级策略

`fetchQuoteSnapshotFromRemote`（`market-heatmap.ts:1378-1423`）：

1. 东财限 25s（`Promise.race`，`:1394`）；超时/失败自动降级新浪。
2. 东财覆盖度 ≥90% 时以东财为主（因其携带 week/month/year 周期字段）；否则新浪为主。
3. 字段级合并 `mergeQuoteSnapshots`（`:1333-1376`）：价格等基础字段 `primary || secondary`，周期涨跌保留东财字段。

完整性门槛：clist 分页成功率 ≥80%、ulist 批成功率 ≥80%、快照覆盖率 `stocks >= total*0.95` 才算完整（`:959, :1222, :1177`）；新浪覆盖度需 ≥ baseline 的 90% 才被接受（`:1272`）。

## 4. 数据解析、单位与清洗

**单位约定**：涨跌幅一律为百分数（东财 `fltt=2` 直接返回百分数；新浪自算 ×100）；成交额、市值为元。平盘阈值 `flatThreshold = 0.1`（±0.1%）。

行 → `StockSnapshot` 映射（`parseEastmoneyStockRow` `:720-753`）：

- 代码：`f12.f13` 拼接，f13=1→SH，代码 4/8/9 开头→BJ，否则 SZ（`:419-427`）。
- 行业：f100 二级行业（去尾"Ⅱ"），经内置 `market-heatmap-subboards.json` 反查一级行业，查不到回退 baseline（`:733-739`）。
- 所有数值经 `toFiniteNumber`（`:374`），缺失回退 baseline 快照值，最终兜底 0。

**清洗规则**：

- `price <= 0` 丢弃（停牌/无报价，`:783-785`）；名称为空丢弃（`:728`）。
- 周期字段级联兜底：week←f109，month←f110→f24，year←f25，全缺则回退当日涨跌（`:787-791`）。
- 无 ST/新股特殊处理，无涨跌停状态字段。

## 5. 指数成分股的真实与近似

| 指数 | 来源 | 说明 |
|---|---|---|
| 中证 A50（zza50） | 东财 datacenter 接口 | 24h 服务端缓存；与本地名册取交集（self-filter）；失败回退 24h 前缓存或种子文件 `market-constituents-zza50-seed.json`（2026-07-28）；远端取不到 ≥40 只视为不完整 |
| 沪深 300 / 中证 A500 | **无真实成分股接口** | `buildDynamicIndexSets`（`:490-500`）按流通市值从 baseline 动态取前 300/500 名近似 |
| zza50 远端不可用 | 近似 | 同样按流通市值取前 50 |

指数调仓期会产生口径失真，这是已知的近似方案。

## 6. 缓存体系

三层缓存叠加：

1. **服务端内存缓存**（模块级，Vercel 实例内有效）：单槽位 + in-flight promise 去重（`:306-311`），TTL 8s（行情与概览，`quoteCacheMs`/`summaryCacheMs`）；zza50 成分股 24h。失败时**返回上一份旧缓存**（`getQuoteSnapshot` `:1455-1485`），保证热点实例不抖动。
2. **HTTP CDN 缓存**：各 route 设 `s-maxage`（quotes=8、treemap=6、overview=8、search=30、constituents=10），流式接口 `no-store`。
3. **内置兜底快照**：`src/lib/data/market-heatmap-fallback.json`（全市场名册 + 收盘快照，当前 5917 只 / 32 个板块）与 `market-heatmap-subboards.json`（二级→一级行业映射）。

兜底快照的三类使用时机：

- 冷启动首帧：`getBundledSnapshotTreemap`（`:2004`）同步返回内置快照，同时在后台预热真实抓取（`:2076-2081`），用户零等待先看到整图；
- 远程全部失败：`getFallbackTreemapData`（`:2029`），`source` 标记 `"fallback"`，成交额用 `estimateFallbackTurnoverAmount`（`:484-488`）按市值+涨跌幅**公式估算**；
- 逐字段回退：解析时缺失字段回退 baseline 值（见 §4）。

## 7. 前端请求模式

不使用 SWR，自实现 `usePollWhileVisible`（`market-heatmap.tsx:2034`）：`setInterval` 轮询 + `document.visibilityState` 可见性门控（页面不可见即暂停）。默认间隔 8s，用户可在 3–600s 调节（localStorage 持久化）。

两个并行轮询循环（`:5383-5409`）：

1. **渐进式行情流**：`GET /api/heatmap/quotes/stream`（NDJSON），服务端边拉取上游边推送 `start/quotes/complete/error` 批次（`streamQuoteData` `:1500-1585`）；前端流式合并，commit 节流 500ms + rAF；切换 market/period/codes 时 AbortController 中止旧流。
2. **概览侧栏**：`GET /api/heatmap/overview`，失败静默保留旧值。

市场范围通过 `market` 参数（all/sse/szse/hs300/zza50/zza500/main/cyb/kcb）切换；自选股模式改用 `codes=` 参数（`:5109-5114`）；周期用 `period=day/week/month/year`。

搜索（`/api/heatmap/search`）为**纯本地名册检索**（`:1888`），不触达任何上游接口，因此新上市未入快照的股票搜不到。

## 8. 数据快照的 CI 维护

`scripts/refresh-market-data.mjs`（273 行）：

- 只拉东财 clist（字段精简版），多镜像轮换、12s 超时；
- 生成 fallback 与 subboards 两份快照，**原子写入**（tmp + rename，`:154-158`）；
- 校验 `validateSnapshot`（`:125-152`）：股票数 ≥5000 且 ≥ 远端 total 的 98%；数量下降 ≤10%；代码唯一；单轮消失 ≤ max(100, 3%)；市值覆盖率 ≥90%；
- `--check` 模式（`pnpm check:data`）只校验不写盘。

`.github/workflows/refresh-market-data.yml`：cron `30 10 * * 1-5`（UTC，即北京时间工作日 18:30 收盘后）+ 手动触发；跑 `refresh:data` → `build` + `typecheck` → 有变化才以 bot 身份提交，触发 Vercel 重新部署。因此兜底数据最迟为上一工作日收盘快照，且 `updatedAt` 会如实暴露。

## 9. 局限性与风险

| 类别 | 风险点 | 现状 |
|---|---|---|
| 接口稳定性 | 全部依赖无鉴权公开接口，无 SLA，可能改字段/加风控/封 IP | 已有 5 镜像轮换、指数退避重试、25s 超时降级新浪、双源合并 |
| 跨源口径 | 新浪只有日线；东财挂掉时 week/month/year 退化为当日涨跌，**用户无感知提示** | 级联兜底 `:787-791` |
| 成分股近似 | hs300/zza500 按流通市值动态近似，调仓期失真 | 已知设计取舍 |
| 停牌/新股 | `price<=0` 静默丢弃，涨跌家数可能与官方口径不一致 | 仅 all+day 概览用同花顺官方家数 |
| 盘中/收盘 | 无交易时段判断，收盘后轮询恒为同一快照 | 前端靠可见性门控降低无效请求 |
| 历史数据 | 无 K 线/分钟级数据，f24/f25 缺失时多周期失真 | 产品定位为当日/近期热力图 |
| 缓存一致性 | 8s 内存缓存为 per-instance，多实例间不一致；CDN s-maxage 进一步放大 | 对秒级行情产品可接受 |
| 估算数据 | fallback 模式成交额为公式估算值 | `source:"fallback"` 前端仅温和提示 |

## 10. 结论

项目的数据层是一个典型的"**多源冗余 + 多级降级 + 内置兜底**"设计：以东财为主、新浪为备、同花顺补概览；服务端 8s 内存缓存与 HTTP s-maxage 双层加速；远端失败时字段级回退 baseline，全挂时退回仓库内置的上一收盘快照，保证任何时刻页面可渲染。代价是若干近似（动态成分股、估算成交额、周期字段级联退化）与跨源口径混用，均已在上表列出，属可接受的产品取舍。
