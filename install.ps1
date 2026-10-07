# Paws of Sherwood bot - Windows installer
#   irm https://raw.githubusercontent.com/rygroup-dev/paws-bot/main/install.ps1 | iex
# Installs to %USERPROFILE%\paws-bot (or $env:PAWS_DIR). Re-running updates the code and keeps
# .env and data\ (your session and settings). No admin rights needed.
& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $repo = 'rygroup-dev/paws-bot'
  $dir = if ($env:PAWS_DIR) { $env:PAWS_DIR } else { Join-Path $HOME 'paws-bot' }
  Write-Host "`n== Paws of Sherwood bot installer ==" -ForegroundColor Yellow
  Write-Host "Folder: $dir"

  # 1. code
  $zip = Join-Path $env:TEMP 'paws-bot.zip'
  $tmp = Join-Path $env:TEMP ('paws-bot-' + [guid]::NewGuid())
  Invoke-WebRequest "https://codeload.github.com/$repo/zip/refs/heads/main" -OutFile $zip -UseBasicParsing
  Expand-Archive $zip $tmp -Force
  $src = Get-ChildItem $tmp -Directory | Select-Object -First 1
  New-Item -ItemType Directory -Force $dir | Out-Null
  Copy-Item (Join-Path $src.FullName '*') $dir -Recurse -Force
  Remove-Item $zip, $tmp -Recurse -Force
  Write-Host "[ok] kode terpasang" -ForegroundColor Green

  # 2. node (system Node 20+ or a portable copy in .runtime\node)
  $node = $null
  $sys = Get-Command node -ErrorAction SilentlyContinue
  if ($sys) { $v = (& node -v).TrimStart('v').Split('.')[0]; if ([int]$v -ge 20) { $node = $sys.Source } }
  $portable = Join-Path $dir '.runtime\node\node.exe'
  if (-not $node -and -not (Test-Path $portable)) {
    Write-Host "Node.js tidak ada, unduh versi portable..."
    $idx = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
    $ver = ($idx | Where-Object { $_.lts -and $_.files -contains 'win-x64-zip' } | Select-Object -First 1).version
    $nz = Join-Path $env:TEMP "node-$ver.zip"
    Invoke-WebRequest "https://nodejs.org/dist/$ver/node-$ver-win-x64.zip" -OutFile $nz -UseBasicParsing
    $rt = Join-Path $dir '.runtime'
    New-Item -ItemType Directory -Force $rt | Out-Null
    Expand-Archive $nz $rt -Force
    if (Test-Path (Join-Path $rt 'node')) { Remove-Item (Join-Path $rt 'node') -Recurse -Force }
    Rename-Item (Join-Path $rt "node-$ver-win-x64") 'node'
    Remove-Item $nz
  }
  if (-not $node) { $node = $portable }
  $nodeDir = Split-Path $node
  $env:Path = "$nodeDir;$env:Path"
  $env:NODE_OPTIONS = '--use-system-ca'
  Write-Host "[ok] node $(& $node -v)" -ForegroundColor Green

  # 3. dependencies
  Push-Location $dir
  & (Join-Path $nodeDir 'npm.cmd') install --omit=dev --no-fund --no-audit --loglevel=error
  Pop-Location
  Write-Host "[ok] dependencies" -ForegroundColor Green

  # 4. .env (asked once; kept on updates)
  $envFile = Join-Path $dir '.env'
  if (-not (Test-Path $envFile)) {
    Write-Host "`nIsi data bot (disimpan hanya di $envFile):" -ForegroundColor Yellow
    $pk = Read-Host 'Private key wallet game (0x...)' -AsSecureString
    $pkPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($pk))
    $tok = Read-Host 'Telegram bot token (dari @BotFather)'
    $chat = Read-Host 'Telegram chat id (kosongkan kalau belum tahu, bot akan kasih tahu)'
    @(
      "PRIVATE_KEY=$pkPlain",
      "TELEGRAM_BOT_TOKEN=$tok",
      "TELEGRAM_CHAT_ID=$chat",
      'REFERRAL_CODE=TGPEMVTV',
      'RPC_URL='
    ) | Set-Content -Encoding ascii $envFile
    $pkPlain = $null
    Write-Host "[ok] .env dibuat" -ForegroundColor Green
  } else {
    Write-Host "[ok] .env lama dipakai" -ForegroundColor Green
  }

  # 5. shortcut + start
  try {
    $lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Paws Bot.lnk'
    $sh = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
    $sh.TargetPath = Join-Path $dir 'run.cmd'
    $sh.WorkingDirectory = $dir
    $sh.Save()
    Write-Host "[ok] shortcut 'Paws Bot' di Desktop" -ForegroundColor Green
  } catch {}
  Write-Host "`nSelesai! Bot dijalankan di jendela baru. Kirim /menu ke bot Telegram kamu." -ForegroundColor Yellow
  Write-Host "Akun baru: jendela Edge/Chrome kecil muncul sekali untuk captcha, centang kotaknya."
  if (-not $env:PAWS_NO_START) { Start-Process cmd.exe -ArgumentList '/k', "title Paws Bot && `"$dir\run.cmd`"" -WorkingDirectory $dir }
}
