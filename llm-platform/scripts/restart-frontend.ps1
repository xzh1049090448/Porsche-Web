# 重启 llm-platform 前端开发服务（Vite，默认端口 5173）
# 用法：在 llm-platform 目录执行  .\scripts\restart-frontend.ps1
#       或 npm run restart

$ErrorActionPreference = "Stop"
$Port = 5173
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

Set-Location $Root
Write-Host ">> 工作目录: $Root" -ForegroundColor Cyan

function Stop-PortListener {
    param([int]$ListenPort)

    $killed = @()
    try {
        $connections = Get-NetTCPConnection -LocalPort $ListenPort -State Listen -ErrorAction SilentlyContinue
        foreach ($conn in $connections) {
            $pid = $conn.OwningProcess
            if ($pid -and $pid -gt 0 -and $killed -notcontains $pid) {
                Write-Host ">> 结束占用端口 $ListenPort 的进程 PID=$pid" -ForegroundColor Yellow
                Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
                $killed += $pid
            }
        }
    } catch {
        # 部分环境无 Get-NetTCPConnection，回退 netstat
    }

    if ($killed.Count -eq 0) {
        $lines = netstat -ano | Select-String ":$ListenPort\s"
        foreach ($line in $lines) {
            if ($line -notmatch "LISTENING") { continue }
            $parts = ($line.ToString() -split "\s+") | Where-Object { $_ }
            $pid = [int]$parts[-1]
            if ($pid -gt 0 -and $killed -notcontains $pid) {
                Write-Host ">> 结束占用端口 $ListenPort 的进程 PID=$pid" -ForegroundColor Yellow
                taskkill /F /PID $pid 2>$null | Out-Null
                $killed += $pid
            }
        }
    }

    if ($killed.Count -eq 0) {
        Write-Host ">> 端口 $ListenPort 未被占用，跳过结束进程" -ForegroundColor DarkGray
    } else {
        Start-Sleep -Seconds 1
    }
}

Write-Host ">> 正在重启前端 (http://localhost:$Port) ..." -ForegroundColor Green
Stop-PortListener -ListenPort $Port

if (-not (Test-Path "node_modules\vite")) {
    Write-Host ">> 未检测到依赖，先执行 npm install ..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host ">> 启动 npm run dev ..." -ForegroundColor Green
npm run dev
