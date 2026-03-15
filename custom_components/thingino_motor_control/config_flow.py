"""Config flow for Thingino camera motor control."""

from __future__ import annotations

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.const import CONF_HOST
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers import selector

from .const import (
    CONF_AUTH_HEADER_NAME,
    CONF_AUTH_HEADER_VALUE,
    CONF_PASSWORD,
    CONF_USE_HTTPS,
    CONF_USERNAME,
    DEFAULT_AUTH_HEADER_NAME,
    DEFAULT_USE_HTTPS,
    DOMAIN,
)


class ThinginoMotorControlConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for camera motor control."""

    VERSION = 1

    async def async_step_user(self, user_input: dict | None = None) -> FlowResult:
        if user_input is not None:
            await self.async_set_unique_id(user_input[CONF_HOST])
            self._abort_if_unique_id_configured()

            return self.async_create_entry(
                title=f"Camera @ {user_input[CONF_HOST]}",
                data=user_input,
            )

        schema = vol.Schema(
            {
                vol.Required(CONF_HOST): str,
                vol.Optional(CONF_USE_HTTPS, default=DEFAULT_USE_HTTPS): bool,
                vol.Optional(
                    CONF_AUTH_HEADER_NAME,
                    default=DEFAULT_AUTH_HEADER_NAME,
                ): str,
                vol.Optional(CONF_AUTH_HEADER_VALUE, default=""): str,
                vol.Optional(CONF_USERNAME, default=""): str,
                vol.Optional(CONF_PASSWORD, default=""): selector.TextSelector(
                    selector.TextSelectorConfig(type=selector.TextSelectorType.PASSWORD)
                ),
            }
        )

        return self.async_show_form(step_id="user", data_schema=schema)
