"""Service handlers for camera motor control."""

from __future__ import annotations

from urllib.parse import urlsplit

import voluptuous as vol

from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError

from .api import CameraMotorClient
from .const import (
    CONF_HOST,
    CONF_ENTRY_ID,
    DATA_ENTRIES,
    DATA_SERVICES_REGISTERED,
    DOMAIN,
    SERVICE_TO_COMMAND,
)

BASE_SERVICE_SCHEMA = vol.Schema(
    {
        vol.Optional(CONF_ENTRY_ID): str,
        vol.Optional(CONF_HOST): str,
    }
)


def _host_match_candidates(value: str) -> set[str]:
    """Return normalized host candidates for robust comparisons.

    Supports plain IP/host values and full URLs.
    """
    raw = value.strip().lower()
    if not raw:
        return set()

    parsed = urlsplit(raw if "://" in raw else f"//{raw}")
    hostname = parsed.hostname
    port = parsed.port

    candidates = {raw.rstrip("/")}
    if hostname:
        candidates.add(hostname)
        if port:
            candidates.add(f"{hostname}:{port}")

    return candidates


def _resolve_client(
    hass: HomeAssistant,
    entry_id: str | None,
    host: str | None,
) -> CameraMotorClient:
    domain_data = hass.data.get(DOMAIN, {})
    entries: dict[str, CameraMotorClient] = domain_data.get(DATA_ENTRIES, {})

    if not entries:
        raise HomeAssistantError("No configured camera motor entries are available")

    if entry_id:
        client = entries.get(entry_id)
        if client is None:
            raise HomeAssistantError(f"Unknown camera entry_id: {entry_id}")
        return client

    if host:
        host_candidates = _host_match_candidates(host)
        for client in entries.values():
            client_candidates = _host_match_candidates(client.host)
            if host_candidates.intersection(client_candidates):
                return client
        raise HomeAssistantError(f"Unknown camera host: {host}")

    if len(entries) > 1:
        raise HomeAssistantError(
            "Multiple cameras are configured; specify entry_id or host"
        )

    # Default to the first configured entry for convenience.
    return next(iter(entries.values()))


async def _handle_command(call: ServiceCall, hass: HomeAssistant, command: str) -> None:
    entry_id = call.data.get(CONF_ENTRY_ID)
    host = call.data.get(CONF_HOST)
    client = _resolve_client(hass, entry_id, host)
    await client.send_command(command)


async def async_setup_services(hass: HomeAssistant) -> None:
    """Register domain services once."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get(DATA_SERVICES_REGISTERED):
        return

    for service_name, command in SERVICE_TO_COMMAND.items():

        async def _service_handler(
            call: ServiceCall,
            *,
            _command: str = command,
        ) -> None:
            await _handle_command(call, hass, _command)

        hass.services.async_register(
            DOMAIN,
            service_name,
            _service_handler,
            schema=BASE_SERVICE_SCHEMA,
        )

    domain_data[DATA_SERVICES_REGISTERED] = True


async def async_unload_services(hass: HomeAssistant) -> None:
    """Unregister domain services."""
    domain_data = hass.data.get(DOMAIN, {})
    if not domain_data.get(DATA_SERVICES_REGISTERED):
        return

    for service_name in SERVICE_TO_COMMAND:
        hass.services.async_remove(DOMAIN, service_name)

    domain_data[DATA_SERVICES_REGISTERED] = False
