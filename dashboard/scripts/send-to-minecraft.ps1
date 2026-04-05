param(
  [Parameter(Mandatory = $true)]
  [string]$Command,
  [string]$WindowTitle = "Minecraft",
  [int]$DelayMs = 180
)

Add-Type -AssemblyName System.Windows.Forms

$result = [ordered]@{
  ok = $false
  command = $Command
  activated = $false
  timestamp = (Get-Date).ToString("o")
}

if ([string]::IsNullOrWhiteSpace($Command)) {
  $result.message = "Empty command"
  $result | ConvertTo-Json -Depth 4
  exit 1
}

try {
  $wshell = New-Object -ComObject WScript.Shell
  $result.activated = $wshell.AppActivate($WindowTitle)

  if (-not $result.activated) {
    throw "Minecraft window not found"
  }

  Start-Sleep -Milliseconds $DelayMs
  [System.Windows.Forms.Clipboard]::SetText($Command)
  $wshell.SendKeys("{ESC}")
  Start-Sleep -Milliseconds 80
  $wshell.SendKeys("t")
  Start-Sleep -Milliseconds ($DelayMs + 60)
  $wshell.SendKeys("^a")
  Start-Sleep -Milliseconds 60
  $wshell.SendKeys("^v")
  Start-Sleep -Milliseconds 60
  $wshell.SendKeys("{ENTER}")

  $result.ok = $true
  $result.message = "Sent to Minecraft"
}
catch {
  $result.message = $_.Exception.Message
}

$result | ConvertTo-Json -Depth 4
