# Thingino Camera Motor Control (HACS)

Custom Home Assistant integration for controlling a camera motor over local API calls.

## What this does

- Adds a config flow to store camera IP/host and authentication settings
- Supports multiple configured cameras, each with independent credentials
- Exposes motor services:
  - `thingino_motor_control.move_up`
  - `thingino_motor_control.move_down`
  - `thingino_motor_control.move_left`
  - `thingino_motor_control.move_right`
  - `thingino_motor_control.stop`
- Sends local HTTP `GET` requests to your camera API

## Authentication support

This integration supports both methods:

- Basic auth credentials: provide `username` and `password`, and the addon creates
  `Authorization: Basic <base64(username:password)>` automatically for each request.
- Custom auth header: provide `auth_header_name` and `auth_header_value` directly.

Priority is custom header first, then generated Basic auth.

Credential handling:

- Password input is masked in the Home Assistant config UI.
- Credentials are stored in Home Assistant config entries storage so they persist across restarts.
- Home Assistant config entries are not a dedicated encrypted secret vault by default; OS and file permissions should protect access to the Home Assistant config directory.
- The addon does not log the generated token or raw credentials.

Each configured camera keeps its own auth configuration, so different cameras can use different usernames/passwords or different custom auth headers.

## Install with HACS (Custom repository)

1. Push this repository to GitHub.
2. In Home Assistant: HACS -> Integrations -> menu -> Custom repositories.
3. Add your repo URL and choose category `Integration`.
4. Install `Thingino Camera Motor Control` from HACS.
5. Restart Home Assistant.
6. Go to Settings -> Devices & services -> Add integration.
7. Add `Thingino Camera Motor Control` and enter camera host and optional auth header.

## Creating releases (HACS-friendly)

Use the release script to avoid invalid refs and ensure HACS can install a stable tag.

Prerequisites:

- `git` installed and authenticated for `origin`
- optional: `gh` CLI logged in (for automatic GitHub release creation)

Steps:

1. Update `custom_components/thingino_motor_control/manifest.json` `version`.
2. Commit and push your changes to `main`.
3. Run:

```powershell
./scripts/release.ps1
```

What the script does:

- Verifies clean working tree (unless `-AllowDirty` is used)
- Verifies current branch is `main`
- Verifies `manifest.json` version is valid and matches release version
- Creates and pushes tag `v<manifest-version>`
- Creates GitHub release with generated notes when `gh` is available

Useful flags:

- `-Yes` skip confirmation prompt
- `-SkipGitHubRelease` push tag only
- `-Draft` create draft GitHub release
- `-Prerelease` mark GitHub release as pre-release
- `-ReuseTag` continue if local/remote tag already exists
- `-Version 0.3.1` explicitly set release version (must match manifest)

## Camera API used

The integration now calls your endpoint format:

- `GET /x/json-motor.cgi?d=g&x=<value>&y=<value>`

The request is sent to the configured camera host and includes your configured auth header
(default header name is `Authorization`).

Current directional mapping in `custom_components/thingino_motor_control/const.py`:

- Left: `x=-40.5`, `y=0`
- Right: `x=40.5`, `y=0`
- Up: `x=0`, `y=-40.5`
- Down: `x=0`, `y=40.5`
- Stop: `x=0`, `y=0`

If your camera's vertical axis is inverted, swap signs for `Up` and `Down` in `COMMAND_PARAMS`.

## Multiple camera targeting

Add the integration once per camera (with each camera's own host and credentials).

When calling a service, target a camera with one of:

- `entry_id` (config entry id)
- `host` (recommended, easier for dashboard YAML)

`host` matching accepts either plain host/IP (`192.168.178.118`) or URL form (`http://192.168.178.118`).

If multiple cameras are configured and neither `entry_id` nor `host` is provided, the service call returns an error to avoid moving the wrong camera.

## Lovelace control widget example

This integration now includes a selectable custom card widget with a visual editor.

### 1) Add the card resource once

In Home Assistant:

1. Settings -> Dashboards -> three dots -> Resources
2. Add resource URL:

`/thingino_motor_control/thingino-motor-control-card.js`

3. Resource type: `JavaScript Module`

### 2) Add the widget from card picker

1. Edit dashboard -> Add card
2. Choose `Thingino Motor Control` (regular) or `Thingino Motor Control Compact`
3. Enter `Host` in the card editor (or `entry_id`)
4. Save

Example YAML for the custom card:

```yaml
type: custom:thingino-motor-control-card
title: Front Camera
host: 192.168.178.118
show_title: true
```

Example YAML for the compact custom card:

```yaml
type: custom:thingino-motor-control-compact-card
title: Front Camera Compact
host: 192.168.178.118
show_title: false
```

`show_title` is optional and defaults to `true`.

## Manual card fallback

Use a manual card with service buttons:

```yaml
type: grid
columns: 3
square: true
cards:
  - type: button
    icon: mdi:arrow-up-bold
    name: Up
    tap_action:
      action: call-service
      service: thingino_motor_control.move_up
  - type: button
    icon: mdi:stop-circle-outline
    name: Stop
    tap_action:
      action: call-service
      service: thingino_motor_control.stop
  - type: button
    icon: mdi:arrow-right-bold
    name: Right
    tap_action:
      action: call-service
      service: thingino_motor_control.move_right
  - type: button
    icon: mdi:arrow-left-bold
    name: Left
    tap_action:
      action: call-service
      service: thingino_motor_control.move_left
  - type: button
    icon: mdi:arrow-down-bold
    name: Down
    tap_action:
      action: call-service
      service: thingino_motor_control.move_down
```

Example service data for a specific camera:

```yaml
service: thingino_motor_control.move_left
data:
  host: 192.168.178.118
```

The same widget is also available at `examples/lovelace_motor_widget.yaml`.
Custom-card example is at `examples/lovelace_custom_card_widget.yaml`.
Compact custom-card example is at `examples/lovelace_custom_card_compact_widget.yaml`.
