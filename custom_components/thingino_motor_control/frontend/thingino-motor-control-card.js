const CARD_TYPE_STANDARD = "custom:thingino-motor-control-card";
const CARD_TYPE_COMPACT = "custom:thingino-motor-control-compact-card";
const DEFAULT_STEP_SIZE = 40.5;

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
    };
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = null;
    this._hass = null;
    this._compactMode = false;
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
      ...config,
      compact: compactMode,
    };
    this._compactMode = compactMode;

    this._render();
  }

  set hass(hass) {
    this._hass = hass;
  }

  getCardSize() {
    if (this._compactMode) {
      return this._config && this._config.show_title === false ? 2 : 3;
    }
    return 4;
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
    const data = {};
    if (this._config.host) {
      data.host = this._config.host;
    }
    if (this._config.entry_id) {
      data.entry_id = this._config.entry_id;
    }

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
      </ha-card>
    `;

    this.shadowRoot.querySelectorAll("button[data-service]").forEach((button) => {
      button.addEventListener("click", () => {
        this._callService(button.dataset.service);
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

    this.shadowRoot.querySelectorAll('input[type="text"], input[type="number"]').forEach((input) => {
      input.addEventListener("input", updateConfig);
    });

    const showTitleInput = this.shadowRoot.querySelector('input[data-key="show_title"]');
    showTitleInput.addEventListener("change", updateConfig);

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
