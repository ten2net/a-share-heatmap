#!/usr/bin/env bash
# 快速启动：同时拉起东财同步 API 服务（east-money-api-node）和主站（Next.js dev）
# 用法：./quickstart.sh          （API 端口 8787，Web 端口 3000）
#       ./quickstart.sh --build  （先重新编译 API 服务再启动）
set -euo pipefail

cd "$(dirname "$0")"
API_PORT="${PORT:-8787}"
WEB_PORT="${WEB_PORT:-3000}"
API_DIR="east-money-api-node"

API_PID=""
WEB_PID=""

cleanup() {
  echo ""
  echo "正在停止服务..."
  # 子进程以 setsid 启动为独立进程组组长，按进程组杀，避免孙子进程（next dev 等）残留
  [ -n "$API_PID" ] && kill -- "-$API_PID" 2>/dev/null || true
  [ -n "$WEB_PID" ] && kill -- "-$WEB_PID" 2>/dev/null || true
  [ -n "$API_PID" ] && wait "$API_PID" 2>/dev/null || true
  [ -n "$WEB_PID" ] && wait "$WEB_PID" 2>/dev/null || true
  echo "已退出"
}
trap cleanup EXIT INT TERM

# 1. 确保 API 服务依赖已安装
if [ ! -d "$API_DIR/node_modules" ]; then
  echo ">>> 安装 API 服务依赖 ($API_DIR)..."
  (cd "$API_DIR" && pnpm install)
fi

# 2. 编译（dist 缺失或传了 --build 时）
if [ "${1:-}" = "--build" ] || [ ! -f "$API_DIR/dist/server.js" ]; then
  echo ">>> 编译 API 服务..."
  (cd "$API_DIR" && pnpm build)
fi

# 3. 加载根目录 .env（EASTMONEY_COOKIE 等，不覆盖已有环境变量）
# 逐行读取，仅接受 KEY=VALUE 行，跳过注释与脏数据，避免 source 整个文件被非 shell 语法弄挂
if [ -f .env ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      [A-Za-z_]*=*)
        key="${line%%=*}"
        if [ -z "${!key:-}" ]; then
          export "$line"
        fi
        ;;
    esac
  done < .env
  echo ">>> 已加载 .env（EASTMONEY_COOKIE 等凭据）"
else
  echo ">>> 警告：未找到 .env，自选股同步接口将无凭据可用" >&2
fi

# 4. 启动 API 服务（setsid：独立进程组，便于整体停止）
echo ">>> 启动 API 服务: http://localhost:$API_PORT"
setsid bash -c "cd '$API_DIR' && exec env PORT='$API_PORT' node dist/server.js" &
API_PID=$!

# 等待 API 就绪
for _ in $(seq 1 30); do
  if curl -sf "http://localhost:$API_PORT/healthz" >/dev/null 2>&1; then
    echo ">>> API 服务已就绪 (/healthz ok)"
    break
  fi
  sleep 0.5
done
if ! curl -sf "http://localhost:$API_PORT/healthz" >/dev/null 2>&1; then
  echo ">>> 警告：API 服务健康检查未通过，请查看上方日志" >&2
fi

# 5. 启动主站
echo ">>> 启动 Web: http://localhost:$WEB_PORT"
setsid env PORT="$WEB_PORT" pnpm dev &
WEB_PID=$!

echo ""
echo "============================================"
echo " Web: http://localhost:$WEB_PORT"
echo " API: http://localhost:$API_PORT"
echo " 按 Ctrl+C 同时停止两个服务"
echo "============================================"

wait "$API_PID" "$WEB_PID"
