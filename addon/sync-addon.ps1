param()

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$source = Join-Path $root "behavior_pack"
$tempZip = Join-Path $env:TEMP "SpamTraceLoggerBP.zip"
$mcpack = Join-Path $root "SpamTraceLoggerBP.mcpack"
$targets = @(
  (Join-Path $env:USERPROFILE "AppData\Roaming\Minecraft Bedrock\Users\Shared\games\com.mojang\development_behavior_packs\CodexSpamTraceBP"),
  (Join-Path $env:LOCALAPPDATA "Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe\LocalState\games\com.mojang\development_behavior_packs\CodexSpamTraceBP")
)

foreach ($target in $targets) {
  $parent = Split-Path -Parent $target
  if (-not (Test-Path $parent)) {
    continue
  }

  if (Test-Path $target) {
    Remove-Item -LiteralPath $target -Recurse -Force
  }

  Copy-Item -LiteralPath $source -Destination $target -Recurse
}

if (Test-Path $tempZip) {
  Remove-Item -LiteralPath $tempZip -Force
}

if (Test-Path $mcpack) {
  Remove-Item -LiteralPath $mcpack -Force
}

Compress-Archive -Path (Join-Path $source "*") -DestinationPath $tempZip -CompressionLevel Optimal
Move-Item -LiteralPath $tempZip -Destination $mcpack

Write-Output "Synced and rebuilt: $mcpack"
