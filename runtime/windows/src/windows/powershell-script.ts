export const POWERSHELL_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"
$requestJson = [Environment]::GetEnvironmentVariable(
  "OPEN_CHATGPT_SKIN_REQUEST_JSON",
  [EnvironmentVariableTarget]::Process
)
if ([string]::IsNullOrWhiteSpace($requestJson)) {
  throw "Runtime inspection request is missing"
}
$request = $requestJson | ConvertFrom-Json
[Environment]::SetEnvironmentVariable(
  "OPEN_CHATGPT_SKIN_REQUEST_JSON",
  $null,
  [EnvironmentVariableTarget]::Process
)

$nativeProcessSource = @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;

namespace OpenChatGPTSkin {
  public sealed class NativeProcessEntry {
    public int ProcessId { get; set; }
    public int ParentProcessId { get; set; }
    public string ExecutableName { get; set; }
  }

  public static class NativeProcessInspector {
    private const uint SnapshotProcesses = 0x00000002;
    private const uint QueryLimitedInformation = 0x00001000;
    private const int ProcessCommandLineInformation = 60;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ProcessEntry32 {
      public uint Size;
      public uint Usage;
      public uint ProcessId;
      public IntPtr DefaultHeapId;
      public uint ModuleId;
      public uint Threads;
      public uint ParentProcessId;
      public int BasePriority;
      public uint Flags;
      [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
      public string ExecutableName;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct UnicodeString {
      public ushort Length;
      public ushort MaximumLength;
      public IntPtr Buffer;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool Process32First(IntPtr snapshot, ref ProcessEntry32 entry);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool Process32Next(IntPtr snapshot, ref ProcessEntry32 entry);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inheritHandle, int processId);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("ntdll.dll")]
    private static extern int NtQueryInformationProcess(
      IntPtr process,
      int informationClass,
      IntPtr information,
      int informationLength,
      out int returnLength
    );

    public static NativeProcessEntry[] Snapshot() {
      IntPtr snapshot = CreateToolhelp32Snapshot(SnapshotProcesses, 0);
      if (snapshot == new IntPtr(-1)) {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }
      try {
        var entries = new List<NativeProcessEntry>();
        var entry = new ProcessEntry32();
        entry.Size = (uint)Marshal.SizeOf(typeof(ProcessEntry32));
        if (!Process32First(snapshot, ref entry)) {
          throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        do {
          entries.Add(new NativeProcessEntry {
            ProcessId = checked((int)entry.ProcessId),
            ParentProcessId = checked((int)entry.ParentProcessId),
            ExecutableName = entry.ExecutableName ?? string.Empty,
          });
          entry.Size = (uint)Marshal.SizeOf(typeof(ProcessEntry32));
        } while (Process32Next(snapshot, ref entry));
        int error = Marshal.GetLastWin32Error();
        if (error != 18) {
          throw new Win32Exception(error);
        }
        return entries.ToArray();
      } finally {
        CloseHandle(snapshot);
      }
    }

    public static string ReadCommandLine(int processId) {
      IntPtr process = OpenProcess(QueryLimitedInformation, false, processId);
      if (process == IntPtr.Zero) {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }
      try {
        int length;
        NtQueryInformationProcess(
          process,
          ProcessCommandLineInformation,
          IntPtr.Zero,
          0,
          out length
        );
        if (length < Marshal.SizeOf(typeof(UnicodeString))) {
          throw new InvalidOperationException("Process command line length is invalid");
        }
        IntPtr buffer = Marshal.AllocHGlobal(length);
        try {
          int status = NtQueryInformationProcess(
            process,
            ProcessCommandLineInformation,
            buffer,
            length,
            out length
          );
          if (status != 0) {
            throw new InvalidOperationException("Process command line query failed");
          }
          var value = (UnicodeString)Marshal.PtrToStructure(
            buffer,
            typeof(UnicodeString)
          );
          return value.Buffer == IntPtr.Zero
            ? string.Empty
            : Marshal.PtrToStringUni(value.Buffer, value.Length / 2) ?? string.Empty;
        } finally {
          Marshal.FreeHGlobal(buffer);
        }
      } finally {
        CloseHandle(process);
      }
    }
  }
}
'@

[void](Add-Type -TypeDefinition $nativeProcessSource -ErrorAction Stop)

function Get-ProcessSnapshotById() {
  $byId = @{}
  foreach ($entry in @([OpenChatGPTSkin.NativeProcessInspector]::Snapshot())) {
    $byId[[int]$entry.ProcessId] = $entry
  }
  return $byId
}

function Get-ProcessAncestors([int]$processId, $snapshotById) {
  $ancestors = @()
  $cursor = $processId
  $seen = @{}
  while ($cursor -gt 0 -and -not $seen.ContainsKey($cursor)) {
    $seen[$cursor] = $true
    $ancestors += $cursor
    if (-not $snapshotById.ContainsKey($cursor)) { break }
    $cursor = [int]$snapshotById[$cursor].ParentProcessId
  }
  return $ancestors
}

function Get-SignatureSummary([string]$path) {
  $signature = Get-AuthenticodeSignature -LiteralPath $path
  $signer = ""
  if ($null -ne $signature.SignerCertificate) {
    $signer = $signature.SignerCertificate.GetNameInfo(
      [Security.Cryptography.X509Certificates.X509NameType]::SimpleName,
      $false
    )
  }
  return [pscustomobject]@{ status = [string]$signature.Status; signer = $signer }
}

function Test-AppxBlockMapFile([string]$root, [string]$relativePath) {
  [xml]$blockMap = Get-Content -Raw -LiteralPath ([IO.Path]::Combine($root, "AppxBlockMap.xml"))
  $normalized = $relativePath.Replace("/", "\")
  $file = @($blockMap.BlockMap.File) |
    Where-Object { ([string]$_.Name).Replace("/", "\") -ieq $normalized } |
    Select-Object -First 1
  if ($null -eq $file) { return $false }
  $path = [IO.Path]::Combine($root, $relativePath)
  $info = Get-Item -LiteralPath $path
  if ([int64]$file.Size -ne $info.Length) { return $false }
  $stream = [IO.File]::OpenRead($path)
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    foreach ($block in @($file.Block)) {
      $count = [int][Math]::Min(65536, $stream.Length - $stream.Position)
      if ($count -le 0) { return $false }
      $buffer = New-Object byte[] $count
      $offset = 0
      while ($offset -lt $count) {
        $read = $stream.Read($buffer, $offset, $count - $offset)
        if ($read -le 0) { return $false }
        $offset += $read
      }
      $actual = [Convert]::ToBase64String($sha.ComputeHash($buffer))
      if ($actual -cne [string]$block.Hash) { return $false }
    }
    return $stream.Position -eq $stream.Length
  } finally {
    $sha.Dispose()
    $stream.Dispose()
  }
}

function Get-ExactProcess([int]$processId, [string]$startedAt) {
  if ($processId -lt 1 -or [string]::IsNullOrWhiteSpace($startedAt)) {
    throw "Process identity is invalid"
  }
  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if ($null -eq $process -or
    $process.StartTime.ToUniversalTime().ToString("o") -ne $startedAt) {
    throw "Process identity does not match"
  }
  return $process
}

switch ($request.action) {
  "currentUserPackageRoots" {
    $roots = @(Get-AppxPackage -Name "OpenAI.Codex" -ErrorAction SilentlyContinue |
      ForEach-Object { $_.InstallLocation })
    ConvertTo-Json -InputObject $roots -Compress
  }
  "listCodexRoots" {
    $all = @([OpenChatGPTSkin.NativeProcessInspector]::Snapshot() |
      Where-Object { $_.ExecutableName -ieq "ChatGPT.exe" })
    $ids = @{}
    foreach ($item in $all) { $ids[[int]$item.ProcessId] = $true }
    $roots = @($all | Where-Object { -not $ids.ContainsKey([int]$_.ParentProcessId) } |
      ForEach-Object {
        $process = Get-Process -Id ([int]$_.ProcessId) -ErrorAction Stop
        [pscustomobject]@{
          pid = [int]$_.ProcessId
          parentPid = [int]$_.ParentProcessId
          startedAt = $process.StartTime.ToUniversalTime().ToString("o")
          executablePath = $process.Path
        }
      })
    ConvertTo-Json -InputObject $roots -Compress
  }
  "inspectInstall" {
    $root = [IO.Path]::GetFullPath([string]$request.packageRoot)
    $manifestPath = [IO.Path]::Combine($root, "AppxManifest.xml")
    [xml]$manifest = Get-Content -Raw -LiteralPath $manifestPath
    $application = @($manifest.Package.Applications.Application) |
      Where-Object { $_.Id -eq "App" } | Select-Object -First 1
    if ($null -eq $application) { throw "App entry is missing" }
    $entry = [IO.Path]::GetFullPath([IO.Path]::Combine($root, [string]$application.Executable))
    $packageSignature = Get-SignatureSummary ([IO.Path]::Combine($root, "AppxSignature.p7x"))
    $catalogSignature = Get-SignatureSummary ([IO.Path]::Combine($root, "AppxMetadata\CodeIntegrity.cat"))
    $resourceSignature = Get-SignatureSummary ([IO.Path]::Combine($root, "app\resources\codex.exe"))
    $entryBlockMapValid = Test-AppxBlockMapFile $root ([string]$application.Executable)
    [pscustomobject]@{
      packageRoot = $root
      entryPath = $entry
      identityName = [string]$manifest.Package.Identity.Name
      packageVersion = [string]$manifest.Package.Identity.Version
      packagePublisher = [string]$manifest.Package.Identity.Publisher
      appId = [string]$application.Id
      entryRelativePath = ([string]$application.Executable).Replace("\", "/")
      entryPoint = [string]$application.EntryPoint
      packageSignatureStatus = $packageSignature.status
      packageSignerCommonName = $packageSignature.signer
      catalogSignatureStatus = $catalogSignature.status
      catalogSignerCommonName = $catalogSignature.signer
      entryBlockMapValid = [bool]$entryBlockMapValid
      resourceSignatureStatus = $resourceSignature.status
      resourceSignerCommonName = $resourceSignature.signer
    } | ConvertTo-Json -Compress
  }
  "inspectPort" {
    $connections = @(Get-NetTCPConnection -State Listen -LocalPort ([int]$request.port) -ErrorAction SilentlyContinue)
    if ($connections.Count -eq 0) { $null | ConvertTo-Json -Compress; break }
    if ($connections.Count -ne 1 -or $connections[0].LocalAddress -ne "127.0.0.1") {
      throw "port is not bound exclusively to 127.0.0.1"
    }
    $connection = $connections[0]
    $snapshotById = Get-ProcessSnapshotById
    $ancestors = @(Get-ProcessAncestors ([int]$connection.OwningProcess) $snapshotById)
    [pscustomobject]@{
      host = "127.0.0.1"
      port = [int]$request.port
      owningPid = [int]$connection.OwningProcess
      ancestors = $ancestors
    } | ConvertTo-Json -Compress
  }
  "activateCodexApplication" {
    $aumid = "OpenAI.Codex_2p2nqsd0c76g0!App"
    $shell = New-Object -ComObject Shell.Application
    try {
      $folder = $shell.NameSpace("shell:AppsFolder")
      if ($null -eq $folder) { throw "AppsFolder is unavailable" }
      $item = $folder.ParseName($aumid)
      if ($null -eq $item) { throw "official Codex AUMID is unavailable" }
      $item.InvokeVerb("open")
      [pscustomobject]@{ activated = $true } | ConvertTo-Json -Compress
    } finally {
      if ($null -ne $shell) {
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)
      }
    }
  }
  "inspectManagedWindows" {
    $rootPid = [int]$request.rootPid
    $root = Get-Process -Id $rootPid -ErrorAction SilentlyContinue
    $rootExists = $false
    if ($null -ne $root) {
      $rootExists = $root.StartTime.ToUniversalTime().ToString("o") -eq
        [string]$request.startedAt
    }
    $visible = 0
    if ($rootExists) {
      $snapshotById = Get-ProcessSnapshotById
      foreach ($candidate in @(Get-Process -Name "ChatGPT" -ErrorAction SilentlyContinue)) {
        if ($candidate.MainWindowHandle -eq 0) { continue }
        $ancestors = @(Get-ProcessAncestors ([int]$candidate.Id) $snapshotById)
        if ($ancestors -contains $rootPid) {
          $visible += 1
        }
      }
    }
    [pscustomobject]@{
      rootExists = [bool]$rootExists
      visibleWindowCount = [int]$visible
    } | ConvertTo-Json -Compress
  }
  "inspectProcessStartedAt" {
    $pidText = [string]$request.pid
    if ($pidText -notmatch "^[1-9][0-9]*$") { throw "PID must be a positive integer" }
    $processId = [int]$pidText
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($null -eq $process) { $null | ConvertTo-Json -Compress; break }
    $process.StartTime.ToUniversalTime().ToString("o") | ConvertTo-Json -Compress
  }
  "inspectRemoteDebuggingArguments" {
    $pidText = [string]$request.rootPid
    if ($pidText -notmatch "^[1-9][0-9]*$") { throw "Process identity is invalid" }
    $processId = [int]$pidText
    [void](Get-ExactProcess $processId ([string]$request.startedAt))
    $commandLine = [OpenChatGPTSkin.NativeProcessInspector]::ReadCommandLine($processId)
    [void](Get-ExactProcess $processId ([string]$request.startedAt))
    [pscustomobject]@{
      hasRemoteDebuggingAddress = [regex]::IsMatch(
        $commandLine,
        "(?i)(?:^|\s)--remote-debugging-address(?:=|\s|$)"
      )
      hasRemoteDebuggingPort = [regex]::IsMatch(
        $commandLine,
        "(?i)(?:^|\s)--remote-debugging-port(?:=|\s|$)"
      )
    } | ConvertTo-Json -Compress
  }
  "measureProcessCpuPercent" {
    $pidText = [string]$request.rootPid
    $sampleText = [string]$request.sampleMs
    if ($pidText -notmatch "^[1-9][0-9]*$" -or $sampleText -notmatch "^[0-9]+$") {
      throw "CPU inspection input is invalid"
    }
    $processId = [int]$pidText
    $sampleMs = [int]$sampleText
    if ($sampleMs -lt 1000 -or $sampleMs -gt 5000) {
      throw "CPU sample duration is invalid"
    }
    $process = Get-ExactProcess $processId ([string]$request.startedAt)
    $firstCpuMs = $process.TotalProcessorTime.TotalMilliseconds
    $watch = [Diagnostics.Stopwatch]::StartNew()
    Start-Sleep -Milliseconds $sampleMs
    $process.Refresh()
    if ($process.StartTime.ToUniversalTime().ToString("o") -ne [string]$request.startedAt) {
      throw "Process identity does not match"
    }
    $elapsedMs = $watch.Elapsed.TotalMilliseconds
    $secondCpuMs = $process.TotalProcessorTime.TotalMilliseconds
    $processors = [Environment]::ProcessorCount
    if ($elapsedMs -le 0 -or $processors -lt 1) { throw "CPU sample is invalid" }
    $percent = (($secondCpuMs - $firstCpuMs) / $elapsedMs / $processors) * 100
    if ([double]::IsNaN($percent) -or [double]::IsInfinity($percent) -or $percent -lt 0) {
      throw "CPU sample is invalid"
    }
    [Math]::Round($percent, 2) | ConvertTo-Json -Compress
  }
  "processExists" {
    $process = Get-Process -Id ([int]$request.pid) -ErrorAction SilentlyContinue
    $exists = $false
    if ($null -ne $process) {
      $exists = $process.StartTime.ToUniversalTime().ToString("o") -eq [string]$request.startedAt
    }
    [pscustomobject]@{ exists = $exists } | ConvertTo-Json -Compress
  }
  "currentUserSid" {
    [Security.Principal.WindowsIdentity]::GetCurrent().User.Value | ConvertTo-Json -Compress
  }
  "secureDirectory" {
    $path = [IO.Path]::GetFullPath([string]$request.path)
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $userGrant = "*" + $sid + ":(OI)(CI)F"
    $systemGrant = "*S-1-5-18:(OI)(CI)F"
    & icacls.exe $path /reset | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "icacls reset failed with exit code $LASTEXITCODE" }
    & icacls.exe $path /inheritance:r /grant:r $userGrant $systemGrant | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "icacls ACL update failed with exit code $LASTEXITCODE" }
    $verified = Get-Acl -LiteralPath $path
    $expected = @($sid, "S-1-5-18") | Sort-Object
    $actual = @($verified.Access | ForEach-Object {
      $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    } | Sort-Object -Unique)
    if (-not $verified.AreAccessRulesProtected -or
      ($actual -join "|") -ne ($expected -join "|")) {
      throw "secureDirectory ACL verification failed"
    }
    [pscustomobject]@{ secured = $true } | ConvertTo-Json -Compress
  }
  default { throw "Unsupported action" }
}
`;
