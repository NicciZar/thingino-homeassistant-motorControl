"""Local camera motor API client."""

from __future__ import annotations

import base64

from aiohttp import ClientError, ClientTimeout

from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import (
    COMMAND_PARAMS,
    CONF_AUTH_HEADER_NAME,
    CONF_AUTH_HEADER_VALUE,
    CONF_HOST,
    CONF_PASSWORD,
    CONF_USE_HTTPS,
    CONF_USERNAME,
    DEFAULT_AUTH_HEADER_NAME,
    MOTOR_ENDPOINT_PATH,
)


class CameraMotorClient:
    """Send camera motor commands over local HTTP GET requests."""

    def __init__(self, hass, config: dict) -> None:
        self._hass = hass
        self._host: str = config[CONF_HOST]
        self._use_https: bool = config.get(CONF_USE_HTTPS, False)
        self._auth_header_name: str | None = config.get(CONF_AUTH_HEADER_NAME)
        self._auth_header_value: str | None = config.get(CONF_AUTH_HEADER_VALUE)
        self._username: str | None = config.get(CONF_USERNAME)
        self._password: str | None = config.get(CONF_PASSWORD)

    @property
    def _base_url(self) -> str:
        scheme = "https" if self._use_https else "http"
        return f"{scheme}://{self._host}"

    @property
    def host(self) -> str:
        """Return configured host for this camera entry."""
        return self._host

    def _build_headers(self) -> dict[str, str]:
        """Build authorization headers for the request.

        Priority:
        1) Explicit auth header value (for advanced use)
        2) Generated Basic token from username/password
        """
        headers: dict[str, str] = {}

        if self._auth_header_name and self._auth_header_value:
            headers[self._auth_header_name] = self._auth_header_value.strip()
            return headers

        has_basic_credentials = bool(self._username or self._password)
        if has_basic_credentials:
            token = base64.b64encode(
                f"{self._username or ''}:{self._password or ''}".encode("utf-8")
            ).decode("ascii")
            header_name = self._auth_header_name or DEFAULT_AUTH_HEADER_NAME
            headers[header_name] = f"Basic {token}"

        return headers

    async def send_command(self, command: str) -> None:
        """Call the local camera API for a motor command."""
        if command not in COMMAND_PARAMS:
            raise HomeAssistantError(f"Unsupported motor command: {command}")

        session = async_get_clientsession(self._hass)
        url = f"{self._base_url}{MOTOR_ENDPOINT_PATH}"
        params = COMMAND_PARAMS[command]
        headers = self._build_headers()

        try:
            response = await session.get(
                url,
                params=params,
                headers=headers,
                timeout=ClientTimeout(total=8),
            )
        except ClientError as err:
            raise HomeAssistantError(
                f"Could not reach camera motor API at {url}: {err}"
            ) from err

        if response.status >= 400:
            body = await response.text()
            raise HomeAssistantError(
                f"Camera motor API returned {response.status} for {response.url}: {body}"
            )
