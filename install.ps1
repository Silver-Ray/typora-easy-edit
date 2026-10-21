param(
    [string]$TyporaPath,
    [switch]$Uninstall,
    [switch]$DryRun,
    [switch]$NoElevation,
    [string]$NodePath
)

# Keep this file ASCII so Windows PowerShell 5.1 and PowerShell 7 both parse it.
$ErrorActionPreference = 'Stop'
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $OutputEncoding

if (-not $NodePath) {
    $nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $nodeCommand) { throw 'Node.js 18 or newer is required to run the installer.' }
    $NodePath = $nodeCommand.Source
}
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw "Node.js executable not found: $NodePath" }
$NodePath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($NodePath)
if ($TyporaPath) { $TyporaPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($TyporaPath) }

$installerArgs = @((Join-Path $PSScriptRoot 'scripts\install.cjs'))
if ($TyporaPath) { $installerArgs += @('--resources', $TyporaPath) }
if ($Uninstall) { $installerArgs += '--uninstall' }
if ($DryRun) { $installerArgs += '--dry-run' }
# PowerShell 5.1 turns redirected native stderr into error records. Capture those
# without terminating the script so the Node exit code survives UAC log capture.
$previousErrorPreference = $ErrorActionPreference
try {
    $ErrorActionPreference = 'Continue'
    $installerOutput = & $NodePath @installerArgs 2>&1
    $installerExitCode = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $previousErrorPreference
}
@($installerOutput) | ForEach-Object { Write-Host $_.ToString() }
if ($installerExitCode -eq 0) { exit 0 }

# The Node installer reserves exit code 5 for EACCES / EPERM. Other errors must
# not trigger an administrator prompt, and an elevated retry must never loop.
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$isAdministrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($installerExitCode -ne 5 -or $NoElevation -or $DryRun -or $isAdministrator) { exit $installerExitCode }

function ConvertTo-SingleQuotedLiteral([string]$Value) {
    return "'" + $Value.Replace("'", "''") + "'"
}

Write-Host 'Windows administrator permission is required. Accept the UAC prompt to continue.'
$elevatedCommand = '& ' + (ConvertTo-SingleQuotedLiteral $PSCommandPath)
$elevatedCommand += ' -NoElevation -NodePath ' + (ConvertTo-SingleQuotedLiteral $NodePath)
if ($TyporaPath) { $elevatedCommand += ' -TyporaPath ' + (ConvertTo-SingleQuotedLiteral $TyporaPath) }
if ($Uninstall) { $elevatedCommand += ' -Uninstall' }

# Pass an encoded command to preserve spaces, apostrophes and non-ASCII paths.
# Preserve the resolved node.exe path because elevation may use a different PATH.
$elevatedLog = Join-Path ([IO.Path]::GetTempPath()) ('typora-easy-edit-' + [Guid]::NewGuid().ToString('N') + '.log')
$elevatedCommand += ' *> ' + (ConvertTo-SingleQuotedLiteral $elevatedLog) + '; exit $LASTEXITCODE'
$encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($elevatedCommand))
$powershellExe = Join-Path ([Environment]::SystemDirectory) 'WindowsPowerShell\v1.0\powershell.exe'

try {
    $elevatedProcess = Start-Process -FilePath $powershellExe -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encodedCommand
    ) -Verb RunAs -WindowStyle Hidden -Wait -PassThru
    $installerExitCode = $elevatedProcess.ExitCode
} catch {
    Write-Host ('Administrator permission was not granted or the elevated process could not start: ' + $_.Exception.Message)
    $installerExitCode = 5
} finally {
    if (Test-Path -LiteralPath $elevatedLog) {
        Get-Content -LiteralPath $elevatedLog | ForEach-Object { Write-Host $_ }
        Remove-Item -LiteralPath $elevatedLog -Force
    }
}
exit $installerExitCode
