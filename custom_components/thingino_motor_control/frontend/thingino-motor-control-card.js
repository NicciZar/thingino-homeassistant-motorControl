const CARD_TYPE_STANDARD = "custom:thingino-motor-control-card";
const CARD_TYPE_COMPACT = "custom:thingino-motor-control-compact-card";
const DEFAULT_STEP_SIZE = 40.5;
const IR_MODE_DAY = "day";
const IR_MODE_NIGHT = "night";
const HEARTBEAT_KEYS = [
  "time_now",
  "daynight_brightness",
  "total_gain",
  "daynight_mode",
  "rec_ch0",
  "rec_ch1",
  "motion_enabled",
  "privacy_enabled",
  "color_mode",
  "ircut_state",
  "ir850_state",
  "ir940_state",
  "white_state",
  "mic_enabled",
  "spk_enabled",
  "daynight_enabled",
  "wg_status",
];

function normalizeIrMode(value) {
  return value === IR_MODE_NIGHT ? IR_MODE_NIGHT : IR_MODE_DAY;
}

function isIrEnabledFromMode(mode) {
  return normalizeIrMode(mode) === IR_MODE_NIGHT;
}

function modeFromIrEnabled(enabled) {
  return enabled ? IR_MODE_NIGHT : IR_MODE_DAY;
}

function hasHeartbeatKeys(payload) {
  return Boolean(
    payload &&
      typeof payload === "object" &&
      HEARTBEAT_KEYS.some((key) => Object.prototype.hasOwnProperty.call(payload, key))
  );
}

function unwrapHeartbeatPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  if (hasHeartbeatKeys(payload)) {
    return payload;
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const candidate = unwrapHeartbeatPayload(item);
      if (candidate) {
        return candidate;
      }
    }
    return null;
  }

  const nestedCandidates = [
    payload.response,
    payload.service_response,
    payload.result,
    payload.message,
  ];
  for (const candidate of nestedCandidates) {
    const unwrapped = unwrapHeartbeatPayload(candidate);
    if (unwrapped) {
      return unwrapped;
    }
  }

  const objectValues = Object.values(payload).filter(
    (value) => value && typeof value === "object"
  );
  if (objectValues.length === 1) {
    return unwrapHeartbeatPayload(objectValues[0]);
  }

  return null;
}

function toPositiveNumberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }
  return number;
}

function isCompactCardType(type) {
  return type === CARD_TYPE_COMPACT;
}

class ThinginoMotorControlCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("thingino-motor-control-card-editor");
  }

  static getStubConfig() {
    return {
      type: CARD_TYPE_STANDARD,
      title: "Camera Motor",
      host: "192.168.178.118",
      show_title: true,
      step_size: DEFAULT_STEP_SIZE,
      show_heartbeat: false,
      show_mic_control: false,
      show_speaker_control: false,
    };
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = null;
    this._hass = null;
    this._compactMode = false;
    this._irEnabled = false;
    this._micEnabled = false;
    this._speakerEnabled = false;
    this._heartbeatData = null;
    this._heartbeatLoading = false;
    this._heartbeatError = null;
  }

  setConfig(config) {
    if (!config || (!config.host && !config.entry_id)) {
      throw new Error("Set host or entry_id for thingino-motor-control-card");
    }

    const cardType = config.type || CARD_TYPE_STANDARD;
    const compactMode = Boolean(config.compact) || isCompactCardType(cardType);
    const defaultTitle = compactMode ? "Camera Motor Compact" : "Camera Motor";

    this._config = {
      type: cardType,
      title: defaultTitle,
      show_title: true,
      step_size: DEFAULT_STEP_SIZE,
      show_heartbeat: false,
      show_heartbeat_time_now: true,
      show_heartbeat_camera_status: true,
      show_heartbeat_recording: true,
      show_heartbeat_ir_states: true,
      show_heartbeat_audio: true,
      show_mic_control: false,
      show_speaker_control: false,
      ...config,
      compact: compactMode,
    };
    this._compactMode = compactMode;
    this._irEnabled = isIrEnabledFromMode(this._config.ir_mode);
    this._micEnabled = Boolean(this._config.mic_enabled);
    this._speakerEnabled = Boolean(this._config.speaker_enabled);
    this._heartbeatData = null;
    this._heartbeatError = null;

    this._render();

    if (this._config.show_heartbeat && this._hass) {
      this._fetchHeartbeat();
    }
  }

  set hass(hass) {
    this._hass = hass;

    if (
      this._config &&
      this._config.show_heartbeat &&
      !this._heartbeatData &&
      !this._heartbeatLoading
    ) {
      this._fetchHeartbeat();
    }
  }

  getCardSize() {
    const heartbeatBonus = this._config && this._config.show_heartbeat ? 2 : 0;

    if (this._compactMode) {
      const base = this._config && this._config.show_title === false ? 3 : 4;
      return base + heartbeatBonus;
    }

    return 5 + heartbeatBonus;
  }

  _targetData() {
    const data = {};
    if (this._config.host) {
      data.host = this._config.host;
    }
    if (this._config.entry_id) {
      data.entry_id = this._config.entry_id;
    }

    return data;
  }

  _resolveStepSize(serviceName) {
    const globalStep = toPositiveNumberOrNull(this._config.step_size) ?? DEFAULT_STEP_SIZE;

    if (serviceName === "move_up") {
      return toPositiveNumberOrNull(this._config.step_size_up) ?? globalStep;
    }
    if (serviceName === "move_down") {
      return toPositiveNumberOrNull(this._config.step_size_down) ?? globalStep;
    }
    if (serviceName === "move_left") {
      return toPositiveNumberOrNull(this._config.step_size_left) ?? globalStep;
    }
    if (serviceName === "move_right") {
      return toPositiveNumberOrNull(this._config.step_size_right) ?? globalStep;
    }

    return globalStep;
  }

  _serviceData(serviceName) {
    const data = this._targetData();

    if (serviceName !== "stop") {
      data.step_size = this._resolveStepSize(serviceName);
    }

    return data;
  }

  _callService(serviceName) {
    if (!this._hass || !this._config) {
      return;
    }

    const data = this._serviceData(serviceName);
    this._hass.callService("thingino_motor_control", serviceName, data);
  }

  _setIrEnabled(enabled) {
    if (!this._hass || !this._config) {
      return;
    }

    const irMode = modeFromIrEnabled(enabled);

    this._hass.callService("thingino_motor_control", "set_ircut", {
      ...this._targetData(),
      ir_mode: irMode,
    });

    // Keep the switch state in sync with the last command sent.
    this._irEnabled = enabled;
    this._render();
  }

  _setMicEnabled(enabled) {
    if (!this._hass || !this._config) {
      return;
    }

    this._hass.callService("thingino_motor_control", "set_microphone", {
      ...this._targetData(),
      enabled: enabled,
    });

    // Keep the switch state in sync with the last command sent.
    this._micEnabled = enabled;
    this._render();
  }

  _setSpeakerEnabled(enabled) {
    if (!this._hass || !this._config) {
      return;
    }

    this._hass.callService("thingino_motor_control", "set_speaker", {
      ...this._targetData(),
      enabled: enabled,
    });

    // Keep the switch state in sync with the last command sent.
    this._speakerEnabled = enabled;
    this._render();
  }

  _extractServiceResponse(result) {
    return unwrapHeartbeatPayload(result);
  }

  async _fetchHeartbeat() {
    if (!this._hass || !this._config || this._heartbeatLoading) {
      return;
    }

    this._heartbeatLoading = true;
    this._heartbeatError = null;
    this._render();

    try {
      let result = null;
      const serviceData = this._targetData();

      // Prefer REST call with explicit return_response for broad HA frontend compatibility.
      try {
        result = await this._hass.callApi(
          "POST",
          "services/thingino_motor_control/get_heartbeat?return_response=1",
          serviceData
        );
      }
      catch (apiErr) {
        // Fallback to callService for environments where callApi behavior differs.
        result = await this._hass.callService(
          "thingino_motor_control",
          "get_heartbeat",
          serviceData,
          undefined,
          true
        );
      }

      const payload = this._extractServiceResponse(result);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("Camera heartbeat response was empty, wrapped, or invalid.");
      }

      this._heartbeatData = payload;
      this._heartbeatError = null;
    }
    catch (err) {
      this._heartbeatError = err?.message || String(err);
    }
    finally {
      this._heartbeatLoading = false;
      this._render();
    }
  }

  _heartbeatValue(key) {
    if (!this._heartbeatData || this._heartbeatData[key] === undefined) {
      return "-";
    }

    const value = this._heartbeatData[key];
    return value === null || value === "" ? "-" : String(value);
  }

  _heartbeatTimeDisplay() {
    if (!this._heartbeatData || this._heartbeatData.time_now === undefined) {
      return "-";
    }

    const rawValue = this._heartbeatData.time_now;
    if (rawValue === null || rawValue === "") {
      return "-";
    }

    const epochSeconds = Number(rawValue);
    if (!Number.isFinite(epochSeconds)) {
      return String(rawValue);
    }

    const date = new Date(epochSeconds * 1000);
    if (Number.isNaN(date.getTime())) {
      return String(rawValue);
    }

    const timezone = this._heartbeatValue("timezone");
    const baseFormat = {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    };

    if (timezone !== "-") {
      try {
        return new Intl.DateTimeFormat(undefined, {
          ...baseFormat,
          timeZone: timezone,
        }).format(date);
      }
      catch (err) {
        // Ignore invalid timezone values and fall back to local rendering.
      }
    }

    return new Intl.DateTimeFormat(undefined, baseFormat).format(date);
  }

  _render() {
    if (!this.shadowRoot || !this._config) {
      return;
    }

    const subtitle = this._config.host || this._config.entry_id || "";
    const showTitle = this._config.show_title !== false;
    const cardPadding = this._compactMode ? 8 : 12;
    const controlGap = this._compactMode ? 6 : 8;
    const buttonSize = this._compactMode ? 34 : 42;
    const borderRadius = this._compactMode ? 10 : 12;
    const titleFont = this._compactMode ? "0.9rem" : "1rem";
    const subtitleFont = this._compactMode ? "0.75rem" : "0.8rem";
    const subtitleMargin = this._compactMode ? 8 : 12;
    const irRowFont = this._compactMode ? "0.75rem" : "0.8rem";
    const irIcon = this._irEnabled ? "mdi:weather-night" : "mdi:white-balance-sunny";
    const irState = this._irEnabled ? "Enabled" : "Disabled";
    const micIcon = this._micEnabled ? "mdi:microphone" : "mdi:microphone-off";
    const micState = this._micEnabled ? "Enabled" : "Disabled";
    const speakerIcon = this._speakerEnabled ? "mdi:volume-high" : "mdi:volume-off";
    const speakerState = this._speakerEnabled ? "Enabled" : "Disabled";
    const showMicControl = this._config.show_mic_control === true;
    const showSpeakerControl = this._config.show_speaker_control === true;
    const showHeartbeat = this._config.show_heartbeat === true;

    if (
      showHeartbeat &&
      this._hass &&
      !this._heartbeatData &&
      !this._heartbeatLoading &&
      !this._heartbeatError
    ) {
      this._fetchHeartbeat();
    }

    const heartbeatRows = [];
    if (showHeartbeat) {
      if (this._config.show_heartbeat_time_now !== false) {
        heartbeatRows.push(["Time", this._heartbeatTimeDisplay()]);
      }
      if (this._config.show_heartbeat_camera_status !== false) {
        heartbeatRows.push(["Day/Night Mode", this._heartbeatValue("daynight_mode")]);
        heartbeatRows.push(["Day/Night Enabled", this._heartbeatValue("daynight_enabled")]);
        heartbeatRows.push(["Brightness", this._heartbeatValue("daynight_brightness")]);
        heartbeatRows.push(["Total Gain", this._heartbeatValue("total_gain")]);
        heartbeatRows.push(["Color Mode", this._heartbeatValue("color_mode")]);
        heartbeatRows.push(["Motion Detection", this._heartbeatValue("motion_enabled")]);
        heartbeatRows.push(["Privacy Mode", this._heartbeatValue("privacy_enabled")]);
        heartbeatRows.push(["WireGuard Status", this._heartbeatValue("wg_status")]);
      }
      if (this._config.show_heartbeat_recording !== false) {
        heartbeatRows.push(["Recording Ch0", this._heartbeatValue("rec_ch0")]);
        heartbeatRows.push(["Recording Ch1", this._heartbeatValue("rec_ch1")]);
      }
      if (this._config.show_heartbeat_ir_states !== false) {
        heartbeatRows.push(["IR Cut State", this._heartbeatValue("ircut_state")]);
        heartbeatRows.push(["IR 850nm State", this._heartbeatValue("ir850_state")]);
        heartbeatRows.push(["IR 940nm State", this._heartbeatValue("ir940_state")]);
        heartbeatRows.push(["White LED State", this._heartbeatValue("white_state")]);
      }
      if (this._config.show_heartbeat_audio !== false) {
        heartbeatRows.push(["Microphone", this._heartbeatValue("mic_enabled")]);
        heartbeatRows.push(["Speaker", this._heartbeatValue("spk_enabled")]);
      }
    }

    const heartbeatRowsHtml = heartbeatRows
      .map(
        ([label, value]) => `
          <div class="heartbeat-row">
            <span class="heartbeat-key">${label}</span>
            <span class="heartbeat-value">${value}</span>
          </div>
        `
      )
      .join("");

    let heartbeatBodyHtml = "";
    if (showHeartbeat) {
      if (this._heartbeatLoading) {
        heartbeatBodyHtml = '<div class="heartbeat-note">Loading heartbeat...</div>';
      }
      else if (this._heartbeatError) {
        heartbeatBodyHtml = `<div class="heartbeat-error">${this._heartbeatError}</div>`;
      }
      else if (!this._heartbeatData) {
        heartbeatBodyHtml = '<div class="heartbeat-note">Heartbeat not loaded yet.</div>';
      }
      else if (heartbeatRowsHtml) {
        heartbeatBodyHtml = heartbeatRowsHtml;
      }
      else {
        heartbeatBodyHtml = '<div class="heartbeat-note">No heartbeat fields selected.</div>';
      }
    }

    const heartbeatSectionHtml = showHeartbeat
      ? `
        <div class="heartbeat-panel">
          <div class="heartbeat-header">
            <span class="heartbeat-title">Heartbeat</span>
            <button type="button" class="heartbeat-refresh" data-heartbeat-refresh="true" title="Refresh heartbeat">
              Refresh
            </button>
          </div>
          <div class="heartbeat-content">
            ${heartbeatBodyHtml}
          </div>
        </div>
      `
      : "";

    const headerHtml = showTitle
      ? `<div class="title">${this._config.title}</div>
        <div class="subtitle">${subtitle}</div>`
      : "";

    this.shadowRoot.innerHTML = `
      <style>
        ha-card {
          padding: ${cardPadding}px;
        }

        .title {
          font-size: ${titleFont};
          font-weight: 600;
          margin-bottom: 2px;
        }

        .subtitle {
          color: var(--secondary-text-color);
          font-size: ${subtitleFont};
          margin-bottom: ${subtitleMargin}px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .controls {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: ${controlGap}px;
          align-items: center;
          justify-items: center;
          margin-bottom: ${this._compactMode ? 6 : 8}px;
        }

        .empty {
          width: ${buttonSize}px;
          height: ${buttonSize}px;
        }

        button {
          width: ${buttonSize}px;
          height: ${buttonSize}px;
          border: none;
          border-radius: ${borderRadius}px;
          background: var(--secondary-background-color);
          color: var(--primary-text-color);
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .ir-controls {
          display: grid;
          grid-template-columns: 1fr;
          gap: ${controlGap}px;
        }

        .ir-switch {
          width: 100%;
          display: grid;
          grid-template-columns: 1fr auto;
          align-items: center;
          border-radius: ${borderRadius}px;
          background: var(--secondary-background-color);
          padding: ${this._compactMode ? "6px 8px" : "8px 10px"};
          font-size: ${irRowFont};
          gap: 8px;
        }

        .ir-switch-label {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 6px;
          font-weight: 600;
          cursor: pointer;
        }

        .ir-switch-state {
          color: var(--secondary-text-color);
          font-size: ${this._compactMode ? "0.72rem" : "0.78rem"};
          margin-left: 6px;
        }

        .ir-switch input[type="checkbox"] {
          margin: 0;
          width: ${this._compactMode ? "16px" : "18px"};
          height: ${this._compactMode ? "16px" : "18px"};
          accent-color: var(--paper-item-icon-active-color, var(--accent-color));
          cursor: pointer;
        }

        .ir-switch ha-icon {
          --mdc-icon-size: ${this._compactMode ? 16 : 18}px;
        }

        .heartbeat-panel {
          border: 1px solid var(--divider-color);
          border-radius: ${borderRadius}px;
          margin-top: ${this._compactMode ? 6 : 8}px;
          padding: ${this._compactMode ? "8px" : "10px"};
          background: var(--card-background-color);
        }

        .heartbeat-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
          gap: 8px;
        }

        .heartbeat-title {
          font-size: ${this._compactMode ? "0.82rem" : "0.9rem"};
          font-weight: 600;
        }

        .heartbeat-refresh {
          width: auto;
          height: auto;
          padding: ${this._compactMode ? "4px 8px" : "5px 10px"};
          border-radius: ${this._compactMode ? 8 : 10}px;
          font-size: ${this._compactMode ? "0.72rem" : "0.78rem"};
          font-weight: 600;
        }

        .heartbeat-content {
          display: grid;
          gap: 4px;
        }

        .heartbeat-row {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 8px;
          font-size: ${this._compactMode ? "0.72rem" : "0.78rem"};
        }

        .heartbeat-key {
          color: var(--secondary-text-color);
        }

        .heartbeat-value {
          font-family: monospace;
        }

        .heartbeat-note {
          font-size: ${this._compactMode ? "0.72rem" : "0.78rem"};
          color: var(--secondary-text-color);
        }

        .heartbeat-error {
          font-size: ${this._compactMode ? "0.72rem" : "0.78rem"};
          color: var(--error-color);
        }

        button:hover {
          background: var(--paper-item-icon-active-color, var(--accent-color));
          color: white;
        }

        ha-icon {
          --mdc-icon-size: ${this._compactMode ? 20 : 24}px;
        }
      </style>

      <ha-card>
        ${headerHtml}
        <div class="controls">
          <div class="empty"></div>
          <button type="button" data-service="move_up" title="Up">
            <ha-icon icon="mdi:arrow-up-bold"></ha-icon>
          </button>
          <div class="empty"></div>

          <button type="button" data-service="move_left" title="Left">
            <ha-icon icon="mdi:arrow-left-bold"></ha-icon>
          </button>
          <button type="button" data-service="stop" title="Stop">
            <ha-icon icon="mdi:stop-circle-outline"></ha-icon>
          </button>
          <button type="button" data-service="move_right" title="Right">
            <ha-icon icon="mdi:arrow-right-bold"></ha-icon>
          </button>

          <div class="empty"></div>
          <button type="button" data-service="move_down" title="Down">
            <ha-icon icon="mdi:arrow-down-bold"></ha-icon>
          </button>
          <div class="empty"></div>
        </div>
        <div class="ir-controls">
          <div class="ir-switch" title="Enable or disable IR night mode">
            <label class="ir-switch-label" for="ir-enabled-input">
              <ha-icon icon="${irIcon}"></ha-icon>
              IR
              <span class="ir-switch-state">${irState}</span>
            </label>
            <input
              id="ir-enabled-input"
              type="checkbox"
              data-ir-enabled="true"
              ${this._irEnabled ? "checked" : ""}
            />
          </div>
          ${showMicControl ? `
          <div class="ir-switch" title="Enable or disable microphone">
            <label class="ir-switch-label" for="mic-enabled-input">
              <ha-icon icon="${micIcon}"></ha-icon>
              Microphone
              <span class="ir-switch-state">${micState}</span>
            </label>
            <input
              id="mic-enabled-input"
              type="checkbox"
              data-mic-enabled="true"
              ${this._micEnabled ? "checked" : ""}
            />
          </div>
          ` : ""}
          ${showSpeakerControl ? `
          <div class="ir-switch" title="Enable or disable speaker">
            <label class="ir-switch-label" for="speaker-enabled-input">
              <ha-icon icon="${speakerIcon}"></ha-icon>
              Speaker
              <span class="ir-switch-state">${speakerState}</span>
            </label>
            <input
              id="speaker-enabled-input"
              type="checkbox"
              data-speaker-enabled="true"
              ${this._speakerEnabled ? "checked" : ""}
            />
          </div>
          ` : ""}
        </div>
        ${heartbeatSectionHtml}
      </ha-card>
    `;

    this.shadowRoot.querySelectorAll("button[data-service]").forEach((button) => {
      button.addEventListener("click", () => {
        this._callService(button.dataset.service);
      });
    });

    this.shadowRoot.querySelectorAll('input[data-ir-enabled="true"]').forEach((input) => {
      input.addEventListener("change", () => {
        this._setIrEnabled(input.checked);
      });
    });

    this.shadowRoot.querySelectorAll('input[data-mic-enabled="true"]').forEach((input) => {
      input.addEventListener("change", () => {
        this._setMicEnabled(input.checked);
      });
    });

    this.shadowRoot.querySelectorAll('input[data-speaker-enabled="true"]').forEach((input) => {
      input.addEventListener("change", () => {
        this._setSpeakerEnabled(input.checked);
      });
    });

    this.shadowRoot
      .querySelectorAll('button[data-heartbeat-refresh="true"]')
      .forEach((button) => {
        button.addEventListener("click", () => {
          this._fetchHeartbeat();
        });
      });
  }
}

class ThinginoMotorControlCompactCard extends ThinginoMotorControlCard {
  static getConfigElement() {
    return document.createElement("thingino-motor-control-card-editor");
  }

  static getStubConfig() {
    return {
      type: CARD_TYPE_COMPACT,
      title: "Camera Motor Compact",
      host: "192.168.178.118",
      show_title: false,
      step_size: DEFAULT_STEP_SIZE,
      show_heartbeat: false,
      show_mic_control: false,
      show_speaker_control: false,
    };
  }

  setConfig(config) {
    super.setConfig({
      ...config,
      type: CARD_TYPE_COMPACT,
      compact: true,
    });
  }
}

class ThinginoMotorControlCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._cardType = CARD_TYPE_STANDARD;
  }

  setConfig(config) {
    this._cardType = config.type || CARD_TYPE_STANDARD;
    const defaultTitle = isCompactCardType(this._cardType)
      ? "Camera Motor Compact"
      : "Camera Motor";

    this._config = {
      type: this._cardType,
      title: defaultTitle,
      show_title: true,
      step_size: DEFAULT_STEP_SIZE,
      show_heartbeat: false,
      show_heartbeat_time_now: true,
      show_heartbeat_timezone: true,
      show_heartbeat_memory: true,
      show_heartbeat_overlay: true,
      show_heartbeat_extras: true,
      show_heartbeat_daynight: true,
      show_heartbeat_uptime: true,
      ...config,
    };
    this._render();
  }

  _emitConfig(config) {
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config },
        bubbles: true,
        composed: true,
      })
    );
  }

  _render() {
    if (!this.shadowRoot) {
      return;
    }

    const previousFocused = this.shadowRoot.activeElement;
    const focusedKey = previousFocused?.dataset?.key || null;
    const focusedType = previousFocused?.type || null;
    const focusedSelectionStart =
      typeof previousFocused?.selectionStart === "number"
        ? previousFocused.selectionStart
        : null;
    const focusedSelectionEnd =
      typeof previousFocused?.selectionEnd === "number"
        ? previousFocused.selectionEnd
        : null;

    const title = this._config.title || "";
    const host = this._config.host || "";
    const entryId = this._config.entry_id || "";
    const stepSize = this._config.step_size ?? DEFAULT_STEP_SIZE;
    const stepUp = this._config.step_size_up ?? "";
    const stepDown = this._config.step_size_down ?? "";
    const stepLeft = this._config.step_size_left ?? "";
    const stepRight = this._config.step_size_right ?? "";
    const showTitle = this._config.show_title !== false;
    const showHeartbeat = this._config.show_heartbeat === true;
    const showHeartbeatTimeNow = this._config.show_heartbeat_time_now !== false;
    const showHeartbeatCameraStatus = this._config.show_heartbeat_camera_status !== false;
    const showHeartbeatRecording = this._config.show_heartbeat_recording !== false;
    const showHeartbeatIrStates = this._config.show_heartbeat_ir_states !== false;
    const showHeartbeatAudio = this._config.show_heartbeat_audio !== false;
    const showMicControl = this._config.show_mic_control === true;
    const showSpeakerControl = this._config.show_speaker_control === true;

    this.shadowRoot.innerHTML = `
      <style>
        .wrapper {
          display: grid;
          gap: 12px;
          padding: 8px 0;
        }

        label {
          display: grid;
          gap: 4px;
          font-size: 0.9rem;
        }

        input {
          padding: 8px;
          border: 1px solid var(--divider-color);
          border-radius: 8px;
          background: var(--card-background-color);
          color: var(--primary-text-color);
        }

        .hint {
          color: var(--secondary-text-color);
          font-size: 0.8rem;
        }
      </style>
      <div class="wrapper">
        <label>
          Title
          <input type="text" data-key="title" value="${title}" placeholder="Camera Motor" />
        </label>
        <label>
          Host
          <input type="text" data-key="host" value="${host}" placeholder="192.168.178.118" />
        </label>
        <label>
          Entry ID (optional alternative to host)
          <input type="text" data-key="entry_id" value="${entryId}" placeholder="abc123..." />
        </label>
        <label>
          Step Size
          <input
            type="number"
            data-key="step_size"
            value="${stepSize}"
            min="0.1"
            step="0.1"
          />
        </label>
        <label>
          Step Size Up (optional override)
          <input
            type="number"
            data-key="step_size_up"
            value="${stepUp}"
            min="0.1"
            step="0.1"
            placeholder="Use global"
          />
        </label>
        <label>
          Step Size Down (optional override)
          <input
            type="number"
            data-key="step_size_down"
            value="${stepDown}"
            min="0.1"
            step="0.1"
            placeholder="Use global"
          />
        </label>
        <label>
          Step Size Left (optional override)
          <input
            type="number"
            data-key="step_size_left"
            value="${stepLeft}"
            min="0.1"
            step="0.1"
            placeholder="Use global"
          />
        </label>
        <label>
          Step Size Right (optional override)
          <input
            type="number"
            data-key="step_size_right"
            value="${stepRight}"
            min="0.1"
            step="0.1"
            placeholder="Use global"
          />
        </label>
        <label>
          <input type="checkbox" data-key="show_title" ${showTitle ? "checked" : ""} />
          Show title and subtitle
        </label>
        <label>
          <input type="checkbox" data-key="show_heartbeat" ${showHeartbeat ? "checked" : ""} />
          Show heartbeat panel
        </label>
        <label>
          <input type="checkbox" data-key="show_heartbeat_time_now" ${showHeartbeatTimeNow ? "checked" : ""} />
          Show heartbeat time
        </label>
        <label>
          <input type="checkbox" data-key="show_heartbeat_camera_status" ${showHeartbeatCameraStatus ? "checked" : ""} />
          Show camera status fields
        </label>
        <label>
          <input type="checkbox" data-key="show_heartbeat_recording" ${showHeartbeatRecording ? "checked" : ""} />
          Show recording status
        </label>
        <label>
          <input type="checkbox" data-key="show_heartbeat_ir_states" ${showHeartbeatIrStates ? "checked" : ""} />
          Show IR/LED states
        </label>
        <label>
          <input type="checkbox" data-key="show_heartbeat_audio" ${showHeartbeatAudio ? "checked" : ""} />
          Show audio (mic/speaker)
        </label>
        <label>
          <input type="checkbox" data-key="show_mic_control" ${showMicControl ? "checked" : ""} />
          Show microphone control
        </label>
        <label>
          <input type="checkbox" data-key="show_speaker_control" ${showSpeakerControl ? "checked" : ""} />
          Show speaker control
        </label>
        <div class="hint">Set host or entry_id. Host can be plain IP/host or URL.</div>
      </div>
    `;

    const updateConfig = () => {
      const next = {
        type: this._cardType,
        title:
          this.shadowRoot.querySelector('input[data-key="title"]').value.trim() ||
          (isCompactCardType(this._cardType)
            ? "Camera Motor Compact"
            : "Camera Motor"),
        show_title: this.shadowRoot.querySelector('input[data-key="show_title"]').checked,
        show_heartbeat: this.shadowRoot.querySelector('input[data-key="show_heartbeat"]').checked,
        show_heartbeat_time_now: this.shadowRoot.querySelector('input[data-key="show_heartbeat_time_now"]').checked,
        show_heartbeat_camera_status: this.shadowRoot.querySelector('input[data-key="show_heartbeat_camera_status"]').checked,
        show_heartbeat_recording: this.shadowRoot.querySelector('input[data-key="show_heartbeat_recording"]').checked,
        show_heartbeat_ir_states: this.shadowRoot.querySelector('input[data-key="show_heartbeat_ir_states"]').checked,
        show_heartbeat_audio: this.shadowRoot.querySelector('input[data-key="show_heartbeat_audio"]').checked,
        show_mic_control: this.shadowRoot.querySelector('input[data-key="show_mic_control"]').checked,
        show_speaker_control: this.shadowRoot.querySelector('input[data-key="show_speaker_control"]').checked,
      };

      const nextHost = this.shadowRoot
        .querySelector('input[data-key="host"]')
        .value.trim();
      const nextEntryId = this.shadowRoot
        .querySelector('input[data-key="entry_id"]')
        .value.trim();
      const stepSizeInput = this.shadowRoot.querySelector('input[data-key="step_size"]');
      const nextStepSize = toPositiveNumberOrNull(stepSizeInput.value);
      const nextStepUp = toPositiveNumberOrNull(
        this.shadowRoot.querySelector('input[data-key="step_size_up"]').value
      );
      const nextStepDown = toPositiveNumberOrNull(
        this.shadowRoot.querySelector('input[data-key="step_size_down"]').value
      );
      const nextStepLeft = toPositiveNumberOrNull(
        this.shadowRoot.querySelector('input[data-key="step_size_left"]').value
      );
      const nextStepRight = toPositiveNumberOrNull(
        this.shadowRoot.querySelector('input[data-key="step_size_right"]').value
      );

      if (nextHost) {
        next.host = nextHost;
      }

      if (nextEntryId) {
        next.entry_id = nextEntryId;
      }

      if (nextStepSize !== null) {
        next.step_size = nextStepSize;
      }
      else {
        next.step_size = DEFAULT_STEP_SIZE;
      }

      if (nextStepUp !== null) {
        next.step_size_up = nextStepUp;
      }
      if (nextStepDown !== null) {
        next.step_size_down = nextStepDown;
      }
      if (nextStepLeft !== null) {
        next.step_size_left = nextStepLeft;
      }
      if (nextStepRight !== null) {
        next.step_size_right = nextStepRight;
      }

      this._config = next;
      this._emitConfig(next);
    };

    // Avoid focus loss in the HA editor by updating config only on committed field changes.
    this.shadowRoot.querySelectorAll('input[type="text"], input[type="number"]').forEach((input) => {
      input.addEventListener("change", updateConfig);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          updateConfig();
        }
      });
    });

    this.shadowRoot.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.addEventListener("change", updateConfig);
    });

    if (focusedKey) {
      const restoredInput = this.shadowRoot.querySelector(`input[data-key="${focusedKey}"]`);
      if (restoredInput) {
        restoredInput.focus();
        if (
          focusedType === "text" &&
          typeof focusedSelectionStart === "number" &&
          typeof focusedSelectionEnd === "number" &&
          typeof restoredInput.setSelectionRange === "function"
        ) {
          const maxIndex = restoredInput.value.length;
          const safeStart = Math.min(focusedSelectionStart, maxIndex);
          const safeEnd = Math.min(focusedSelectionEnd, maxIndex);
          restoredInput.setSelectionRange(safeStart, safeEnd);
        }
      }
    }
  }
}

if (!customElements.get("thingino-motor-control-card")) {
  customElements.define("thingino-motor-control-card", ThinginoMotorControlCard);
}

if (!customElements.get("thingino-motor-control-compact-card")) {
  customElements.define(
    "thingino-motor-control-compact-card",
    ThinginoMotorControlCompactCard
  );
}

if (!customElements.get("thingino-motor-control-card-editor")) {
  customElements.define(
    "thingino-motor-control-card-editor",
    ThinginoMotorControlCardEditor
  );
}

window.customCards = window.customCards || [];
if (!window.customCards.find((card) => card.type === "thingino-motor-control-card")) {
  window.customCards.push({
    type: "thingino-motor-control-card",
    name: "Thingino Motor Control",
    description: "Directional controls for Thingino camera motor service calls.",
  });
}

if (
  !window.customCards.find(
    (card) => card.type === "thingino-motor-control-compact-card"
  )
) {
  window.customCards.push({
    type: "thingino-motor-control-compact-card",
    name: "Thingino Motor Control Compact",
    description: "Compact directional controls for smaller dashboard spaces.",
  });
}
