export const PIPE_HOST_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$sha = [Security.Cryptography.SHA256]::Create()
try {
  $digest = [BitConverter]::ToString(
    $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($sid.Value))
  ).Replace("-", "").ToLowerInvariant().Substring(0, 24)
} finally {
  $sha.Dispose()
}
$pipeLeaf = "OpenChatGPTSkin-$digest"
$systemSid = [Security.Principal.SecurityIdentifier]::new("S-1-5-18")

function New-SecuredServer {
  $security = [IO.Pipes.PipeSecurity]::new()
  $security.SetAccessRuleProtection($true, $false)
  $security.AddAccessRule([IO.Pipes.PipeAccessRule]::new(
    $sid,
    [IO.Pipes.PipeAccessRights]::FullControl,
    [Security.AccessControl.AccessControlType]::Allow
  ))
  $security.AddAccessRule([IO.Pipes.PipeAccessRule]::new(
    $systemSid,
    [IO.Pipes.PipeAccessRights]::FullControl,
    [Security.AccessControl.AccessControlType]::Allow
  ))
  return [IO.Pipes.NamedPipeServerStream]::new(
    $pipeLeaf,
    [IO.Pipes.PipeDirection]::InOut,
    2,
    [IO.Pipes.PipeTransmissionMode]::Byte,
    [IO.Pipes.PipeOptions]::Asynchronous,
    65536,
    65536,
    $security
  )
}

function Assert-ExactAcl([IO.Pipes.NamedPipeServerStream]$server) {
  $expected = @($sid.Value, $systemSid.Value) | Sort-Object -Unique
  $acl = $server.GetAccessControl()
  $actual = @($acl.Access | ForEach-Object {
    $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
  } | Sort-Object -Unique)
  if (($actual -join "|") -ne ($expected -join "|")) {
    throw "Named Pipe ACL verification failed"
  }
}

function Read-Exactly([IO.Stream]$stream, [int]$count) {
  $buffer = New-Object byte[] $count
  $offset = 0
  while ($offset -lt $count) {
    $read = $stream.Read($buffer, $offset, $count - $offset)
    if ($read -le 0) { return $null }
    $offset += $read
  }
  return ,$buffer
}

$ready = $false
$sequence = 0
while ($true) {
  $server = New-SecuredServer
  try {
    Assert-ExactAcl $server
    if (-not $ready) {
      [Console]::Out.WriteLine("READY $pipeLeaf")
      [Console]::Out.Flush()
      $ready = $true
    }

    $server.WaitForConnection()
    $header = Read-Exactly $server 4
    if ($null -eq $header) { continue }
    $length = [BitConverter]::ToUInt32($header, 0)
    if ($length -lt 1 -or $length -gt 65536) { continue }
    $payload = Read-Exactly $server ([int]$length)
    if ($null -eq $payload) { continue }

    $sequence += 1
    $encodedRequest = [Convert]::ToBase64String($payload)
    [Console]::Out.WriteLine("REQUEST $sequence $encodedRequest")
    [Console]::Out.Flush()

    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { throw "Pipe host stdin closed" }
    $match = [regex]::Match($line, "^RESPONSE ([0-9]+) ([A-Za-z0-9+/=]+)$")
    if (-not $match.Success -or $match.Groups[1].Value -ne [string]$sequence) {
      throw "Pipe host response sequence is invalid"
    }
    $response = [Convert]::FromBase64String($match.Groups[2].Value)
    if ($response.Length -lt 1 -or $response.Length -gt 65536) {
      throw "Pipe host response payload is invalid"
    }

    $responseHeader = [BitConverter]::GetBytes([uint32]$response.Length)
    $server.Write($responseHeader, 0, $responseHeader.Length)
    $server.Write($response, 0, $response.Length)
    $server.Flush()
    $server.WaitForPipeDrain()
    $server.Disconnect()
    [Console]::Out.WriteLine("FLUSHED $sequence")
    [Console]::Out.Flush()
    $continue = [Console]::In.ReadLine()
    if ($null -eq $continue) { throw "Pipe host flush acknowledgement is missing" }
    $continueMatch = [regex]::Match($continue, "^CONTINUE ([0-9]+)$")
    if (-not $continueMatch.Success -or $continueMatch.Groups[1].Value -ne [string]$sequence) {
      throw "Pipe host flush acknowledgement is invalid"
    }
  } finally {
    if ($server.IsConnected) { $server.Disconnect() }
    $server.Dispose()
  }
}
`;

export const ENCODED_PIPE_HOST_SCRIPT = Buffer
  .from(PIPE_HOST_SCRIPT, "utf16le")
  .toString("base64");
