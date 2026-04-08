$proj = Join-Path $env:USERPROFILE "Desktop\gomoku-liquid-glass"
Set-Location $proj

# 依赖未安装时自动安装，避免出现 'vite 不是内部或外部命令'。
if (!(Test-Path (Join-Path $proj "node_modules"))) {
  Write-Host "node_modules 不存在，正在执行 npm install ..."
  npm install
}

npm run dev
