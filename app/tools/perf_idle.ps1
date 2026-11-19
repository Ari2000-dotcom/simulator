# Idle CPU and private memory of the OPTLAB process tree (app + WebView2 children).
# usage: powershell -File tools\perf_idle.ps1 [-Seconds 30]
param([int]$Seconds = 30, [string]$Name = "optlab")

function Get-Tree([int]$rootPid) {
    $all = Get-CimInstance Win32_Process
    $ids = New-Object System.Collections.Generic.HashSet[int]
    [void]$ids.Add($rootPid)
    $grew = $true
    while ($grew) {
        $grew = $false
        foreach ($p in $all) { if ($ids.Contains([int]$p.ParentProcessId) -and -not $ids.Contains([int]$p.ProcessId)) { [void]$ids.Add([int]$p.ProcessId); $grew = $true } }
    }
    return $ids
}

$root = Get-Process $Name -ErrorAction Stop | Select-Object -First 1
$ids = Get-Tree $root.Id
function Snapshot { $ids | ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue } | Where-Object { $_ } }
$a = Snapshot; $cpuA = ($a | Measure-Object -Property CPU -Sum).Sum
Start-Sleep $Seconds
$b = Snapshot; $cpuB = ($b | Measure-Object -Property CPU -Sum).Sum
$cores = [Environment]::ProcessorCount
$pct = 100.0 * ($cpuB - $cpuA) / ($Seconds * $cores)
"processes: $($b.Count)"
"idle CPU over ${Seconds}s: {0:N3}% of total ({1:N3}s CPU time)" -f $pct, ($cpuB - $cpuA)
$priv = 0
foreach ($p in $b) {
    $pm = $p.PrivateMemorySize64 / 1MB; $priv += $pm
    "{0,-22} pid {1,6}  private {2,7:N1} MB  ws {3,7:N1} MB" -f $p.ProcessName, $p.Id, $pm, ($p.WorkingSet64 / 1MB)
}
"TOTAL private: {0:N1} MB" -f $priv
