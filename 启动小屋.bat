@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

cd /d "%~dp0"
title Paper Home · 我的小屋

echo ==================================================
echo   Paper Home · 我的小屋（本地工作室启动器）
echo ==================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [提示] 这台电脑还没有安装 Node.js（需要 Node.js 20 或更高版本）。
  echo.
  echo 请按以下步骤安装：
  echo   1. 即将为你打开 Node.js 官网：https://nodejs.org
  echo   2. 点击页面上的「LTS（长期支持版）」按钮下载安装包
  echo   3. 双击安装包，一路点击「Next / 下一步」完成安装
  echo   4. 安装完成后，重新双击本文件「启动小屋.bat」即可
  echo.
  start "" "https://nodejs.org/"
  pause
  exit /b 1
)

set "NODE_MAJOR="
for /f "delims=" %%v in ('node -p "parseInt(process.versions.node)" 2^>nul') do set "NODE_MAJOR=%%v"
if not defined NODE_MAJOR (
  echo [错误] 无法识别当前 Node.js 版本，请前往 https://nodejs.org 重新安装 LTS 版本。
  start "" "https://nodejs.org/"
  pause
  exit /b 1
)
if %NODE_MAJOR% LSS 20 (
  for /f "delims=" %%f in ('node -v 2^>nul') do set "NODE_VER=%%f"
  echo [提示] 检测到当前 Node.js 版本过低（!NODE_VER!），需要 Node.js 20 或更高版本。
  echo 即将为你打开官网，请下载并安装最新的 LTS 版本后重试：https://nodejs.org
  echo.
  start "" "https://nodejs.org/"
  pause
  exit /b 1
)

if not exist "node_modules\vite\bin\vite.js" (
  echo [1/3] 首次启动，正在安装小屋运行所需的依赖（大约需要 1~3 分钟）...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo [错误] 依赖安装失败，请检查网络连接后重试。
    echo 如果你使用代理或公司网络，也可以稍后再试，或把上面的报错截图发给 AI 助手排查。
    echo.
    pause
    exit /b 1
  )
  echo.
) else (
  echo [1/3] 依赖已就绪，跳过安装。
)

echo [2/3] 正在检查本地小屋内容（若为空将自动导入示例内容）...
node scripts\init-sample.mjs
if errorlevel 1 (
  echo.
  echo [错误] 检查或导入初始示例内容失败，请查看上面的报错信息。
  echo.
  pause
  exit /b 1
)

echo.
echo [3/3] 正在启动本地小屋并打开浏览器（地址：http://127.0.0.1:4318/）...
echo       使用期间请不要关闭这个黑框；想关闭小屋时，直接关掉这个黑框即可。
echo.

set "PAPER_HOME_FORCE_LOCAL=1"
call npm run studio
if errorlevel 1 (
  echo.
  echo [提示] 小屋启动遇到问题或意外退出。
  echo   常见原因：4318 端口已被另一个“启动小屋”窗口占用。
  echo   你可以先关掉旧的黑框窗口，或直接在浏览器打开 http://127.0.0.1:4318/ 。
  echo.
  pause
  exit /b 1
)

echo.
echo 小屋服务已停止。
pause
