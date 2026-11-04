#Requires -Version 7
<#
.SYNOPSIS
  SSH to the VM and open psql on the TikTok or Instagram database, so you can ask questions of the data.

.EXAMPLES
  .\scripts\db-shell.ps1 tiktok                          # interactive psql, read-only
  .\scripts\db-shell.ps1 instagram
  .\scripts\db-shell.ps1 tiktok -Query "select count(*) from posts"
  .\scripts\db-shell.ps1 tiktok -File .\my-questions.sql
  .\scripts\db-shell.ps1 tiktok -Write                   # can change data; asks you to confirm

  Read-only is enforced by the database session itself, not just by this script.
  The database password stays on the VM; it is never sent to this PC.
#>
param(
    [Parameter(Mandatory, Position = 0)][ValidateSet('tiktok', 'instagram')][string]$Platform,
    [string]$Query,
    [string]$File,
    [switch]$Write,
    [string]$Server = 'medpush@100.115.149.3'
)
$ErrorActionPreference = 'Stop'
if ($Query -and $File) { throw 'Use either -Query or -File, not both.' }
if ($Write -and ($Query -or $File)) { throw '-Write is interactive only. Run it without -Query/-File and type your statements.' }

$remoteScript = '/tmp/db-psql-' + $env:USERNAME + '.sh'
# Copy the helper fresh every time so the VM always runs the version in this repo (LF endings required).
$local = Join-Path $PSScriptRoot 'db-psql.sh'
$tmp = New-TemporaryFile
(Get-Content $local -Raw) -replace "`r`n", "`n" | Set-Content $tmp -NoNewline
& scp -q $tmp "${Server}:$remoteScript"; if ($LASTEXITCODE) { throw 'scp to the VM failed (is Tailscale up?)' }
Remove-Item $tmp

$cmd = "bash $remoteScript $Platform" + $(if ($Write) { ' --write' } else { '' })

try {
    if ($Query -or $File) {
        $sql = if ($File) { Get-Content $File -Raw } else { $Query }
        $sql | & ssh $Server "$cmd -f -"
    } else {
        & ssh -t $Server $cmd            # -t: a real terminal, so psql is interactive
    }
} finally {
    & ssh $Server "rm -f $remoteScript" 2>$null
}
