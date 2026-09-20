# east-money-api-node

东方财富自选股 + 行情 REST API 服务，是仓库内 `east_money_api/`（Python）的 TypeScript 移植版。

- TypeScript + Fastify 5（ESM），HTTP 请求用 Node 22+ 内置 `fetch`
- 已注册 `@fastify/cors`（`origin: true`），允许浏览器从任意来源直接调用（纯内网工具）
- 行为与 Python 版一致：JSONP 解析（`state===0` 成功、`%24→$` 修复）、批量添加每批 45 只 / 批量行情每批 100 只、6 次线性退避重试（`min(2*(i+1), 8)`s）、`state=-217` 视为成功、单票行情 `f43` 等字段 /100、成交额 /10000（元→万元）、市值 /1e8（元→亿元）

## 配置

凭据从环境变量读取（浏览器登录 quote.eastmoney.com 后 F12 → 网络请求里复制 Cookie 整串）：

```bash
export EASTMONEY_COOKIE='ut=...; ...'   # 也可以是存放 cookie 的文件路径
export EASTMONEY_APPKEY='...'           # 可选
```

未配置凭据时服务仍可启动，`/healthz` 可用，其余端点会返回错误。

## 启动

```bash
pnpm install
pnpm build        # tsc 编译到 dist/
pnpm start        # node dist/server.js，默认 0.0.0.0:3001（PORT / HOST 可覆盖）
```

## 端点

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/healthz` | 健康检查，返回 `ok` |
| GET | `/watchlist-groups` | 获取所有自选股分组 |
| POST | `/watchlist-groups` | 创建分组，body `{ "name": "..." }` |
| DELETE | `/watchlist-groups/:id` | 删除分组 |
| GET | `/watchlist?groupId=...` 或 `?groupName=...` | 获取自选股列表 |
| POST | `/watchlist` | 添加自选股，body `{ "codes": ["600519"], "groupId"?, "groupName"? }` |
| DELETE | `/watchlist` | 移除自选股，body 同上 |
| GET | `/quotes/:code` | 单票行情（code 可为 `600519` 或 `sh600519`） |
| POST | `/quotes/batch` | 批量行情，body `{ "codes": ["600519", "sz000001"] }` |

错误统一返回 `{ "error": "..." }`。

## 示例

```bash
curl http://localhost:3001/healthz
curl -X POST http://localhost:3001/quotes/batch \
  -H 'Content-Type: application/json' \
  -d '{"codes": ["600519", "000001"]}'
```
