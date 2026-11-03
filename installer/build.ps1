# Builds installer\dist\AnnotateSetup.exe. Needs Windows, Python 3.14 (the py launcher) and git.
#   powershell -ExecutionPolicy Bypass -File installer\build.ps1
#   powershell -ExecutionPolicy Bypass -File installer\build.ps1 -BuildDir $env:TEMP\annotate-build
# The exe carries its own Python, so the person installing needs nothing but Chrome or Edge.
param(
  [string]$BuildDir = (Join-Path $PSScriptRoot 'build'),
  [string]$Python = 'py -3.14',
  [string]$DistDir = (Join-Path $PSScriptRoot 'dist')
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot
$pythonVersion = '3.14.5'
$pythonZip = "python-$pythonVersion-embed-amd64.zip"
$pythonSha256 = 'ba6bd811c4eedb19195cf275770ef127e893d63701e24152606e2cb76f6d876a'
$version = (Get-Content (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json).version
$payload = Join-Path $BuildDir 'payload'
$runtime = Join-Path $payload 'runtime'
$dist = $DistDir

function Run([string]$exe, [string[]]$arguments) {
  & $exe @arguments
  if ($LASTEXITCODE) { throw "$exe failed with exit code $LASTEXITCODE" }
}

"Building AnnotateSetup $version in $BuildDir"
New-Item -ItemType Directory -Force $BuildDir | Out-Null
if (Test-Path $payload) { Remove-Item -Recurse -Force $payload }

# 1. A build environment with PyInstaller, apart from any Python the tool itself uses.
$venv = Join-Path $BuildDir 'venv'
$buildPython = Join-Path $venv 'Scripts\python.exe'
if (-not (Test-Path $buildPython)) {
  $launcher = $Python.Split(' ')
  Run $launcher[0] (@($launcher[1..9] | Where-Object { $_ }) + @('-m', 'venv', $venv))
}
Run $buildPython @('-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', '-r', (Join-Path $PSScriptRoot 'build-requirements.txt'))

# 2. The embeddable Python from python.org, checked against the pinned hash.
$zip = Join-Path $BuildDir $pythonZip
if (-not (Test-Path $zip)) {
  Invoke-WebRequest "https://www.python.org/ftp/python/$pythonVersion/$pythonZip" -OutFile $zip -UseBasicParsing
}
if ((Get-FileHash $zip -Algorithm SHA256).Hash -ne $pythonSha256) { throw "$pythonZip doesn't match its pinned hash." }
Expand-Archive $zip $runtime
# The embeddable Python ignores PYTHONPATH and reads its paths from this file. Add the packages,
# and the install folder above runtime so server.py finds live.py and cloud.py. `import site`
# stays off, so packages from a Python the person already has can't leak in.
$pth = Get-ChildItem $runtime -Filter 'python*._pth' | Select-Object -First 1
$paths = (Get-Content $pth.FullName | Where-Object { $_ -and $_ -notmatch '^#' }) + @('Lib\site-packages', '..')
Set-Content $pth.FullName $paths -Encoding ascii

# 3. PyMuPDF, Pillow and Playwright, as wheels for that Python. Playwright drives the installed
#    Chrome or Edge, so no browser is downloaded.
$short = ($pythonVersion.Split('.')[0..1]) -join '.'
Run $buildPython @('-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', '--no-compile',
  '--target', (Join-Path $runtime 'Lib\site-packages'), '--platform', 'win_amd64', '--python-version', $short,
  '--implementation', 'cp', '--only-binary=:all:', '--no-deps', '-r', (Join-Path $PSScriptRoot 'requirements-lock.txt'))

# 4. The tool, as committed. Files that only make sense in a checkout stay out.
$skip = '^(installer/|\.github/|package\.json$|\.git|claude-mod/tests/|start\.(cmd|sh)$|install-service\.)'
$files = Run git @('-C', $repo, 'ls-files') | Where-Object { $_ -notmatch $skip }
foreach ($file in $files) {
  $target = Join-Path $payload $file
  New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
  Copy-Item (Join-Path $repo $file) $target
}
Copy-Item (Join-Path $PSScriptRoot 'payload\*') $payload
Set-Content (Join-Path $payload 'VERSION') $version -Encoding ascii -NoNewline

# 5. The icon, made from the extension's.
$icon = Join-Path $BuildDir 'annotate.ico'
Run $buildPython @('-c', "from PIL import Image; Image.open(r'$repo\extension\icons\128.png').save(r'$icon', sizes=[(16,16),(32,32),(48,48),(64,64),(128,128)])")
Copy-Item $icon $payload

# 6. One LZMA zip for the payload, about a fifth smaller than deflate, then the exe
#    around it.
$payloadZip = Join-Path $BuildDir 'payload.zip'
if (Test-Path $payloadZip) { Remove-Item $payloadZip }
Run $buildPython @('-c', ("import pathlib, zipfile; root = pathlib.Path(r'$payload'); " +
  "z = zipfile.ZipFile(r'$payloadZip', 'w', zipfile.ZIP_LZMA); " +
  "[z.write(f, f.relative_to(root)) for f in sorted(root.rglob('*')) if f.is_file()]; z.close()"))
Run $buildPython @('-m', 'PyInstaller', '--noconfirm', '--clean', '--onefile', '--windowed',
  '--name', 'AnnotateSetup', '--icon', $icon, '--paths', (Join-Path $PSScriptRoot 'payload'),
  '--add-data', "$payloadZip;.", '--add-data', "$icon;.",
  '--distpath', $dist, '--workpath', (Join-Path $BuildDir 'pyinstaller'), '--specpath', $BuildDir,
  (Join-Path $PSScriptRoot 'setup.py'))

$exe = Get-Item (Join-Path $dist 'AnnotateSetup.exe')
"Built $($exe.FullName), $([math]::Round($exe.Length / 1MB)) MB"
