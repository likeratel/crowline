param(
  [Parameter(Mandatory = $true)]
  [string]$ArtifactPath,

  [Parameter(Mandatory = $true)]
  [string]$ExpectedThumbprint
)

$ErrorActionPreference = 'Stop'
$signature = Get-AuthenticodeSignature -LiteralPath $ArtifactPath
$actual = if ($null -eq $signature.SignerCertificate) {
  ''
} else {
  $signature.SignerCertificate.Thumbprint -replace '\s', ''
}
$expected = $ExpectedThumbprint -replace '\s', ''

if ([string]$signature.Status -ne 'Valid') {
  throw "Authenticode status is $($signature.Status)"
}
if ($actual.ToUpperInvariant() -ne $expected.ToUpperInvariant()) {
  throw 'Signer thumbprint does not match release configuration'
}
if ($null -eq $signature.TimeStamperCertificate) {
  throw 'Authenticode timestamp is missing'
}
