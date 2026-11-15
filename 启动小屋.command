#!/usr/bin/env bash

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # Load nvm if installed so double-clicking from Finder can locate Node.js.
  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true
fi

pause_exit() {
  local code="${1:-0}"
  echo ""
  read -r -p "按回车键（Return）关闭窗口..." _ || true
  exit "$code"
}

echo "=================================================="
echo "  Paper Home · 我的小屋（本地工作室启动器）"
echo "=================================================="
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "[提示] 这台 Mac 还没有安装 Node.js（需要 Node.js 20 或更高版本）。"
  echo ""
  echo "请按以下步骤安装："
  echo "  1. 即将为你打开 Node.js 官网：https://nodejs.org"
  echo "  2. 点击页面上的「LTS（长期支持版）」按钮下载安装包"
  echo "  3. 双击 .pkg 安装包，一路点击「继续 / 安装」完成安装"
  echo "  4. 安装完成后，重新双击本文件「启动小屋.command」即可"
  echo ""
  open "https://nodejs.org/" >/dev/null 2>&1 || true
  pause_exit 1
fi

NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo "")"
if [ -z "$NODE_MAJOR" ] || ! [ "$NODE_MAJOR" -ge 20 ] 2>/dev/null; then
  NODE_VER="$(node -v 2>/dev/null || echo "未知版本")"
  echo "[提示] 当前 Node.js 版本（$NODE_VER）低于 20，需要 Node.js 20 或更高版本。"
  echo "即将为你打开官网，请下载并安装最新的 LTS 版本后重试：https://nodejs.org"
  echo ""
  open "https://nodejs.org/" >/dev/null 2>&1 || true
  pause_exit 1
fi

if [ ! -f "node_modules/vite/bin/vite.js" ]; then
  echo "[1/3] 首次启动，正在安装小屋运行所需的依赖（大约需要 1~3 分钟）..."
  echo ""
  if ! npm install; then
    echo ""
    echo "[错误] 依赖安装失败，请检查网络连接后重试。"
    echo "如果反复失败，可以把终端里的报错内容复制发给 AI 助手排查。"
    pause_exit 1
  fi
  echo ""
else
  echo "[1/3] 依赖已就绪，跳过安装。"
fi

echo "[2/3] 正在检查本地小屋内容（若为空将自动导入示例内容）..."
if ! node scripts/init-sample.mjs; then
  echo ""
  echo "[错误] 检查或导入初始示例内容失败，请查看上面的报错信息。"
  pause_exit 1
fi

echo ""
echo "[3/3] 正在启动本地小屋并打开浏览器（地址：http://127.0.0.1:4318/）..."
echo "      使用期间请不要关闭这个终端窗口；想停止时按 Control+C 或直接关闭窗口即可。"
echo ""

if ! PAPER_HOME_FORCE_LOCAL=1 npm run studio; then
  echo ""
  echo "[提示] 小屋启动遇到问题或意外退出。"
  echo "  常见原因：4318 端口已被另一个“启动小屋”窗口占用。"
  echo "  你可以关掉旧窗口，或直接在浏览器访问 http://127.0.0.1:4318/ 。"
  pause_exit 1
fi

echo ""
echo "小屋服务已停止。"
pause_exit 0
