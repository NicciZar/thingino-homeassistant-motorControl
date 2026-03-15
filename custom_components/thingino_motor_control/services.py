"""Service handlers for camera motor control."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit

import voluptuous as vol

from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse
from homeassistant.exceptions import HomeAssistantError

from .api import CameraMotorClient
from .const import (
    CONF_HOST,
    CONF_ENTRY_ID,
    CONF_IR_MODE,
    CONF_IR_MODE_CAMEL,
    CONF_STEP_SIZE,
    CONF_VALUE,
    DATA_ENTRIES,
    DATA_SERVICES_REGISTERED,
    DOMAIN,
    SERVICE_GET_HEARTBEAT,
    SERVICE_SET_IRCUT,
    SERVICE_TO_COMMAND,
)

BASE_SERVICE_SCHEMA = vol.Schema(
    {
        vol.Optional(CONF_ENTRY_ID): str,
        vol.Optional(CONF_HOST): str,
        vol.Optional(CONF_STEP_SIZE): vol.All(vol.Coerce(float), vol.Range(min=0.1)),
    }
)

IRCUT_SERVICE_SCHEMA = vol.Schema(
    {
        vol.Optional(CONF_ENTRY_ID): str,
        vol.Optional(CONF_HOST): str,
        vol.Optional(CONF_IR_MODE): vol.All(str, vol.Lower, vol.In(["day", "night"])),
        vol.Optional(CONF_IR_MODE_CAMEL): vol.All(
            str, vol.Lower, vol.In(["day", "night"])
        ),
        # Backward compatibility with older service calls.
        vol.Optional(CONF_VALUE): vol.All(vol.Coerce(int), vol.In([0, 1])),
    }
)

HEARTBEAT_SERVICE_SCHEMA = vol.Schema(
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
    step_size = call.data.get(CONF_STEP_SIZE)
    client = _resolve_client(hass, entry_id, host)
    await client.send_command(command, step_size=step_size)


async def _handle_ircut(call: ServiceCall, hass: HomeAssistant) -> None:
    entry_id = call.data.get(CONF_ENTRY_ID)
    host = call.data.get(CONF_HOST)
    ir_mode = call.data.get(CONF_IR_MODE) or call.data.get(CONF_IR_MODE_CAMEL)
    if ir_mode is not None:
        value = 1 if ir_mode == "day" else 0
    else:
        value = call.data.get(CONF_VALUE)
        if value is None:
            raise HomeAssistantError(
                "set_ircut requires ir_mode='day' or ir_mode='night'"
            )
    client = _resolve_client(hass, entry_id, host)
    await client.send_ircut(value)


async def _handle_get_heartbeat(call: ServiceCall, hass: HomeAssistant) -> dict[str, Any]:
    entry_id = call.data.get(CONF_ENTRY_ID)
    host = call.data.get(CONF_HOST)
    client = _resolve_client(hass, entry_id, host)
    return await client.get_heartbeat()


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

    async def _ircut_service_handler(call: ServiceCall) -> None:
        await _handle_ircut(call, hass)

    hass.services.async_register(
        DOMAIN,
        SERVICE_SET_IRCUT,
        _ircut_service_handler,
        schema=IRCUT_SERVICE_SCHEMA,
    )

    async def _heartbeat_service_handler(call: ServiceCall) -> dict[str, Any]:
        return await _handle_get_heartbeat(call, hass)

    hass.services.async_register(
        DOMAIN,
        SERVICE_GET_HEARTBEAT,
        _heartbeat_service_handler,
        schema=HEARTBEAT_SERVICE_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )

    domain_data[DATA_SERVICES_REGISTERED] = True


async def async_unload_services(hass: HomeAssistant) -> None:
    """Unregister domain services."""
    domain_data = hass.data.get(DOMAIN, {})
    if not domain_data.get(DATA_SERVICES_REGISTERED):
        return

    for service_name in SERVICE_TO_COMMAND:
        hass.services.async_remove(DOMAIN, service_name)

    hass.services.async_remove(DOMAIN, SERVICE_SET_IRCUT)
    hass.services.async_remove(DOMAIN, SERVICE_GET_HEARTBEAT)

    domain_data[DATA_SERVICES_REGISTERED] = False
