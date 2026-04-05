$proc = Get-Process | Where-Object { $_.ProcessName -like "*Minecraft*" } | Select-Object -First 1

if (-not $proc) {
  [ordered]@{
    running = $false
    collectedAt = (Get-Date).ToString("o")
    caveat = "Minecraft is not running, so no endpoints were collected."
    tcp = @()
    udp = @()
  } | ConvertTo-Json -Depth 6
  exit 0
}

$tcp = @()
$udp = @()

try {
  $tcp = @(Get-NetTCPConnection -OwningProcess $proc.Id -ErrorAction Stop |
    Sort-Object State, RemoteAddress, RemotePort |
    Select-Object LocalAddress, LocalPort, RemoteAddress, RemotePort, State)
}
catch {
}

try {
  $udp = @(Get-NetUDPEndpoint -OwningProcess $proc.Id -ErrorAction Stop |
    Sort-Object LocalAddress, LocalPort |
    Select-Object LocalAddress, LocalPort)
}
catch {
}

[ordered]@{
  running = $true
  collectedAt = (Get-Date).ToString("o")
  process = [ordered]@{
    id = $proc.Id
    name = $proc.ProcessName
    title = $proc.MainWindowTitle
    path = $proc.Path
  }
  caveat = "These endpoints are only what the host PC can observe. Bedrock relays and NAT can hide the true remote origin."
  tcp = $tcp
  udp = $udp
} | ConvertTo-Json -Depth 6
