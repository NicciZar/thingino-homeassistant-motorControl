"""Thingino camera motor control integration."""

from __future__ import annotations

from pathlib import Path

from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .api import CameraMotorClient
from .const import (
    DATA_ENTRIES,
    DATA_FRONTEND_REGISTERED,
    DATA_SERVICES_REGISTERED,
    DOMAIN,
    FRONTEND_CARD_URL,
)
from .services import async_setup_services, async_unload_services


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up from YAML (not used)."""
    return True


async def _async_register_frontend_card(hass: HomeAssistant, domain_data: dict) -> None:
    """Expose custom Lovelace card JS as a static resource."""
    if domain_data.get(DATA_FRONTEND_REGISTERED):
        return

    card_path = (
        Path(__file__).resolve().parent / "frontend" / "thingino-motor-control-card.js"
    )
    if not card_path.exists():
        return

    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(
                FRONTEND_CARD_URL,
                str(card_path),
                cache_headers=False,
            )
        ]
    )
    domain_data[DATA_FRONTEND_REGISTERED] = True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up integration from a config entry."""
    domain_data = hass.data.setdefault(
        DOMAIN,
        {
            DATA_ENTRIES: {},
            DATA_SERVICES_REGISTERED: False,
            DATA_FRONTEND_REGISTERED: False,
        },
    )

    await _async_register_frontend_card(hass, domain_data)

    client = CameraMotorClient(hass, entry.data)
    domain_data[DATA_ENTRIES][entry.entry_id] = client
    entry.runtime_data = client

    await async_setup_services(hass)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    domain_data = hass.data.get(DOMAIN)
    if not domain_data:
        return True

    domain_data[DATA_ENTRIES].pop(entry.entry_id, None)

    if not domain_data[DATA_ENTRIES]:
        await async_unload_services(hass)

    return True
