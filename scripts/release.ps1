param(
    [string]$Version,
    [switch]$SkipGitHubRelease,
    [switch]$Draft,
    [switch]$Prerelease,
    [switch]$ReuseTag,
    [switch]$AllowDirty,
    [switch]$Yes
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-CommandExists {
    param([string]$CommandName)

    if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
        throw "Required command '$CommandName' was not found in PATH."
    }
}

function Get-HttpsRepoUrl {
    param([string]$RemoteUrl)

    if ($RemoteUrl -match "^https://") {
        return ($RemoteUrl -replace "\.git$", "")
    }

    if ($RemoteUrl -match "^git@github.com:(.+?)\.git$") {
        return "https://github.com/$($Matches[1])"
    }

    if ($RemoteUrl -match "^git@github.com:(.+)$") {
        return "https://github.com/$($Matches[1])"
    }

    return $RemoteUrl
}

function Convert-ToTrimmedText {
    param([AllowNull()]$Value)

    if ($null -eq $Value) {
        return ""
    }

    if ($Value -is [array]) {
        if ($Value.Count -eq 0) {
            return ""
        }
        return (($Value -join "`n").Trim())
    }

    return ([string]$Value).Trim()
}

try {

Assert-CommandExists -CommandName "git"

$repoRootRaw = git rev-parse --show-toplevel 2>$null
$repoRoot = Convert-ToTrimmedText -Value $repoRootRaw
if (-not $repoRoot) {
    throw "Could not determine git repository root."
}

Set-Location $repoRoot

$manifestPath = Join-Path $repoRoot "custom_components/thingino_motor_control/manifest.json"
if (-not (Test-Path $manifestPath)) {
    throw "manifest.json not found at expected path: $manifestPath"
}

$manifestJson = Get-Content -Raw -Path $manifestPath | ConvertFrom-Json
$manifestVersion = [string]$manifestJson.version
if ([string]::IsNullOrWhiteSpace($manifestVersion)) {
    throw "manifest.json does not contain a valid 'version'."
}

if ([string]::IsNullOrWhiteSpace($Version)) {
    $Version = $manifestVersion
}

$semverPattern = '^\d+\.\d+\.\d+([\-+][0-9A-Za-z\.-]+)?$'
if ($Version -notmatch $semverPattern) {
    throw "Version '$Version' is not a valid semver-like value (example: 1.2.3 or 1.2.3-beta.1)."
}

if ($Version -ne $manifestVersion) {
    throw "Version mismatch: manifest.json has '$manifestVersion' but release version is '$Version'. Update manifest first."
}

$tag = "v$Version"
$currentBranchRaw = git branch --show-current 2>$null
$currentBranch = Convert-ToTrimmedText -Value $currentBranchRaw
if (-not $currentBranch) {
    throw "Could not determine current branch."
}

if ($currentBranch -ne "main") {
    throw "Current branch is '$currentBranch'. Switch to 'main' before releasing."
}

if (-not $AllowDirty) {
    $dirty = git status --porcelain
    if ($dirty) {
        $dirtyLines = @($dirty)
        $previewLines = @($dirtyLines | Select-Object -First 8)
        $previewText = ($previewLines | ForEach-Object { "  $_" }) -join "`n"
        $remaining = $dirtyLines.Count - $previewLines.Count
        $remainingText = if ($remaining -gt 0) {
            "`n  ... and $remaining more"
        }
        else {
            ""
        }

        throw "Working tree has uncommitted changes.`n$previewText$remainingText`nCommit/stash first, or rerun with -AllowDirty."
    }
}

$localTagExistsRaw = git tag --list $tag 2>$null
$localTagExists = Convert-ToTrimmedText -Value $localTagExistsRaw
$hasLocalTag = -not [string]::IsNullOrWhiteSpace($localTagExists)
if ($hasLocalTag -and -not $ReuseTag) {
    throw "Local tag '$tag' already exists. Use -ReuseTag to continue with the existing tag."
}
if ($hasLocalTag -and $ReuseTag) {
    Write-Warning "Local tag '$tag' already exists. Reusing existing local tag."
}

Write-Host "Fetching remote tags..."
git fetch --tags origin | Out-Null

$remoteTagExistsRaw = git ls-remote --tags origin "refs/tags/$tag" 2>$null
$remoteTagExists = Convert-ToTrimmedText -Value $remoteTagExistsRaw
$hasRemoteTag = -not [string]::IsNullOrWhiteSpace($remoteTagExists)
if ($hasRemoteTag -and -not $ReuseTag) {
    throw "Remote tag '$tag' already exists on origin. Use -ReuseTag to continue with the existing tag."
}
if ($hasRemoteTag -and $ReuseTag) {
    Write-Warning "Remote tag '$tag' already exists on origin."
}

$remoteUrlRaw = git remote get-url origin 2>$null
$remoteUrl = Convert-ToTrimmedText -Value $remoteUrlRaw
if (-not $remoteUrl) {
    throw "Could not determine origin remote URL."
}
$repoUrl = Get-HttpsRepoUrl -RemoteUrl $remoteUrl

Write-Host "Ready to create release:"
Write-Host "- Repository: $repoUrl"
Write-Host "- Branch: $currentBranch"
Write-Host "- Version: $Version"
Write-Host "- Tag: $tag"
Write-Host "- Reuse existing tag: $ReuseTag"
Write-Host "- Create GitHub release: $(-not $SkipGitHubRelease)"

if (-not $Yes) {
    $nonInteractive = $false
    try {
        $nonInteractive =
            [Console]::IsInputRedirected -or
            [Console]::IsOutputRedirected -or
            [Console]::IsErrorRedirected
    }
    catch {
        # Some hosts do not expose a full console; treat that as non-interactive.
        $nonInteractive = $true
    }

    if ($nonInteractive) {
        throw "Interactive confirmation is not available in this terminal host. Re-run with -Yes (and optionally -AllowDirty)."
    }

    $confirmation = Read-Host "Continue? [y/N]"
    if ($confirmation -notin @("y", "Y", "yes", "YES")) {
        throw "Release aborted by user."
    }
}

Write-Host "Pushing branch '$currentBranch'..."
git push origin $currentBranch

if (-not $hasLocalTag) {
    Write-Host "Creating annotated tag '$tag'..."
    git tag -a $tag -m "Release $tag"
}
else {
    Write-Host "Skipping tag creation, '$tag' already exists locally."
}

if (-not $hasRemoteTag) {
    Write-Host "Pushing tag '$tag'..."
    git push origin $tag
}
else {
    Write-Host "Skipping tag push, '$tag' already exists on origin."
}

if (-not $SkipGitHubRelease) {
    if (Get-Command gh -ErrorAction SilentlyContinue) {
        $releaseExists = $false

        # gh returns exit code 1 when a release does not exist; treat that as normal.
        $nativePrefVar = Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue
        if ($nativePrefVar) {
            $oldNativePref = $PSNativeCommandUseErrorActionPreference
            $PSNativeCommandUseErrorActionPreference = $false
        }

        $oldErrorActionPreference = $ErrorActionPreference
        $ErrorActionPreference = "Continue"

        try {
            $null = & gh release view $tag --json tagName 2>$null
            $releaseExists = ($LASTEXITCODE -eq 0)
        }
        finally {
            $ErrorActionPreference = $oldErrorActionPreference
            if ($nativePrefVar) {
                $PSNativeCommandUseErrorActionPreference = $oldNativePref
            }
        }

        if ($releaseExists) {
            Write-Host "GitHub release '$tag' already exists. Skipping release creation."
            Write-Host "Release flow completed successfully for $tag"
            return
        }

        $ghArgs = @(
            "release",
            "create",
            $tag,
            "--title",
            $tag,
            "--generate-notes"
        )

        if ($Draft) {
            $ghArgs += "--draft"
        }

        if ($Prerelease) {
            $ghArgs += "--prerelease"
        }

        Write-Host "Creating GitHub release via gh CLI..."
        gh @ghArgs
    }
    else {
        Write-Warning "gh CLI not found. Tag was pushed, but release was not created automatically."
        Write-Host "Create release manually: $repoUrl/releases/new?tag=$tag"
    }
}

Write-Host "Release flow completed successfully for $tag"

}
catch {
    $message = $_.Exception.Message
    Write-Host ""
    Write-Host "Release script failed:" -ForegroundColor Red
    Write-Host "  $message" -ForegroundColor Red
    Write-Host ""
    Write-Host "Hints:" -ForegroundColor Yellow
    Write-Host "  - Use -Yes in non-interactive terminals"
    Write-Host "  - Use -AllowDirty if you want to release with local changes"
    Write-Host "  - Use -ReuseTag if the release tag already exists"
    exit 1
}
