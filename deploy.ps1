<#
.SYNOPSIS
  Safely deploys the site to Netlify with one command.

.DESCRIPTION
  1. Copies the project to a temporary folder, leaving out private files
     (.claude, .git, .vscode, scripts, README, Deploy.md, setup.sql, this script).
  2. Scans that copy for keys, passwords and database addresses. Stops if it finds any.
  3. Deploys the copy to Netlify (production by default).
  4. Checks the live site: pages, database and admin login endpoint.
  5. Deletes the temporary copy.

.EXAMPLE
  ./deploy.ps1                      Deploy to production (asks you to confirm)
  ./deploy.ps1 -Yes                 Deploy without asking
  ./deploy.ps1 -Message "New times" Add a note shown in the Netlify deploy list
  ./deploy.ps1 -Draft               Deploy to a private preview URL, not the live site
  ./deploy.ps1 -DryRun              Do the copy and the scan only; deploy nothing

.NOTES
  If Windows blocks the script, run it like this instead:
    powershell -ExecutionPolicy Bypass -File .\deploy.ps1
#>
param(
  [string]$Message = "Deploy from deploy.ps1",
  [switch]$Draft,
  [switch]$DryRun,
  [switch]$Yes
)

$ErrorActionPreference = "Stop"
$SiteId  = "e61c6521-7a5d-42fa-a030-0d89ba0a9742"   # stanger-salah-times
$SiteUrl = "https://stanger-salah-times.netlify.app"
$Root    = $PSScriptRoot

function Step($text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host ""; Write-Host "STOPPED: $text" -ForegroundColor Red; exit 1 }

# ── 0. Checks ────────────────────────────────────────────────────────────────
Step "Checking your setup"
if (-not (Get-Command netlify -ErrorAction SilentlyContinue)) {
  Fail "The Netlify CLI is not installed. Install it with: npm install -g netlify-cli"
}
if (-not (Test-Path (Join-Path $Root "node_modules"))) {
  Fail "node_modules is missing. Run: npm install"
}
$dirty = git -C $Root status --porcelain 2>$null
if ($dirty) {
  Write-Host "Note: you have changes that are not committed to git yet." -ForegroundColor Yellow
  Write-Host "The deploy uses your files as they are now. Run git add -A, git commit and git push to save them to GitHub."
}

# ── 1. Clean copy ────────────────────────────────────────────────────────────
Step "Making a clean copy (no private files)"
$Stage = Join-Path $env:TEMP ("salah-deploy-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Path $Stage | Out-Null

$excludeDirs  = @(".claude", ".git", ".netlify", ".vscode", "scripts")
$excludeFiles = @("README.md", "Deploy.md", "setup.sql", "deploy.ps1", ".gitignore")
robocopy $Root $Stage /E /XD $excludeDirs /XF $excludeFiles /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { Fail "Copying the project failed (robocopy code $LASTEXITCODE)." }
$fileCount = (Get-ChildItem $Stage -Recurse -File | Where-Object { $_.FullName -notmatch "\\node_modules\\" }).Count
Write-Host "Copied $fileCount site files to $Stage"

try {
  # ── 2. Secret scan ─────────────────────────────────────────────────────────
  Step "Scanning the copy for keys, passwords and database addresses"
  $patterns = @(
    "eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.",          # JWT-style keys (Supabase etc.)
    "postgres(ql)?://[^\s'""]+",                             # database connection strings
    "SUPABASE_(KEY|URL)",
    "service_role",
    "ADMIN_PASSWORD\s*=\s*['""]",
    "-----BEGIN [A-Z ]*PRIVATE KEY-----"
  )
  $textTypes = "*.html", "*.js", "*.mjs", "*.cjs", "*.json", "*.css", "*.txt", "*.xml", "*.sql", "*.toml", "*.md", "*.svg"
  $files = Get-ChildItem $Stage -Recurse -File -Include $textTypes |
           Where-Object { $_.FullName -notmatch "\\node_modules\\" }
  $hits = foreach ($p in $patterns) { $files | Select-String -Pattern $p }
  if ($hits) {
    Write-Host "Found something that looks private:" -ForegroundColor Red
    # Windows can spell the temp folder two ways (short and long), so find it by name
    $stageName = Split-Path $Stage -Leaf
    $hits | Select-Object -First 10 | ForEach-Object {
      $rel = $_.Path.Substring($_.Path.IndexOf($stageName) + $stageName.Length + 1)
      Write-Host ("  {0}:{1}" -f $rel, $_.LineNumber)
    }
    Fail "Nothing was deployed. Remove those lines (or tell Claude) and run this again."
  }
  Write-Host "Clean: nothing private found in $($files.Count) files." -ForegroundColor Green

  if ($DryRun) {
    Write-Host ""
    Write-Host "Dry run finished. Nothing was deployed." -ForegroundColor Green
    return
  }

  # ── 3. Deploy ──────────────────────────────────────────────────────────────
  $target = if ($Draft) { "a private PREVIEW (the live site is not changed)" } else { "PRODUCTION (the live site)" }
  Step "Ready to deploy to $target"
  if (-not $Yes) {
    $answer = Read-Host "Type y and press Enter to continue"
    if ($answer -ne "y") { Fail "Cancelled. Nothing was deployed." }
  }

  Push-Location $Stage
  try {
    $deployArgs = @("deploy", "--build", "--site", $SiteId, "--message", $Message)
    if (-not $Draft) { $deployArgs += "--prod" }
    & netlify @deployArgs
    if ($LASTEXITCODE -ne 0) { Fail "Netlify reported an error. Scroll up for details." }
  } finally { Pop-Location }

  # ── 4. Check the live site ─────────────────────────────────────────────────
  if (-not $Draft) {
    Step "Checking the live site"
    $problems = 0
    foreach ($path in "/", "/schedule.html", "/admin", "/manifest.json", "/css/site.css") {
      try {
        $r = Invoke-WebRequest -Uri ($SiteUrl + $path) -UseBasicParsing -TimeoutSec 40
        Write-Host ("  OK    {0,-18} {1}" -f $path, $r.StatusCode)
      } catch { Write-Host ("  FAIL  {0}" -f $path) -ForegroundColor Red; $problems++ }
    }
    try {
      $rows = Invoke-RestMethod -Uri "$SiteUrl/api/db" -TimeoutSec 40
      Write-Host ("  OK    database          {0} masjid rows" -f @($rows).Count)
    } catch { Write-Host "  FAIL  database (/api/db)" -ForegroundColor Red; $problems++ }
    try {
      Invoke-WebRequest -Uri "$SiteUrl/api/health" -UseBasicParsing -TimeoutSec 60 | Out-Null
      Write-Host "  OK    live-source health check"
    } catch { Write-Host "  WARN  health check did not answer (the masjid boards may be slow)" -ForegroundColor Yellow }

    Write-Host ""
    if ($problems -eq 0) { Write-Host "Deployed and checked. $SiteUrl" -ForegroundColor Green }
    else { Fail "Deployed, but $problems check(s) failed. Look at the site now." }
  }
}
finally {
  # ── 5. Clean up ────────────────────────────────────────────────────────────
  if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force -ErrorAction SilentlyContinue }
}
