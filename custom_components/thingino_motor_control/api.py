"""Local camera motor API client."""

from __future__ import annotations

import base64
from urllib.parse import urlsplit

from aiohttp import ClientError, ClientTimeout

from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import (
    COMMAND_STOP,
    COMMAND_VECTORS,
    CONF_AUTH_HEADER_NAME,
    CONF_AUTH_HEADER_VALUE,
    CONF_HOST,
    CONF_PASSWORD,
    CONF_USE_HTTPS,
    CONF_USERNAME,
    DEFAULT_AUTH_HEADER_NAME,
    DEFAULT_STEP_SIZE,
    HEARTBEAT_ENDPOINT_PATH,
    IMP_ENDPOINT_PATH,
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
        """Return normalized base URL for the configured camera host.

        Accepts plain host/IP values and full URL values.
        """
        raw_host = self._host.strip()
        if not raw_host:
            raise HomeAssistantError("Camera host is empty")

        default_scheme = "https" if self._use_https else "http"
        candidate = raw_host if "://" in raw_host else f"{default_scheme}://{raw_host}"

        parsed = urlsplit(candidate)
        if not parsed.hostname:
            raise HomeAssistantError(f"Invalid camera host value: {self._host}")

        scheme = parsed.scheme or default_scheme
        if parsed.port is not None:
            netloc = f"{parsed.hostname}:{parsed.port}"
        else:
            netloc = parsed.hostname

        return f"{scheme}://{netloc}"

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

    def _build_command_params(self, command: str, step_size: float | None) -> dict:
        """Build query parameters for a motor command."""
        if command not in COMMAND_VECTORS:
            raise HomeAssistantError(f"Unsupported motor command: {command}")

        if command == COMMAND_STOP:
            return {"d": "g", "x": 0, "y": 0}

        resolved_step = DEFAULT_STEP_SIZE if step_size is None else float(step_size)
        if resolved_step <= 0:
            raise HomeAssistantError("step_size must be greater than 0")

        vector_x, vector_y = COMMAND_VECTORS[command]
        return {
            "d": "g",
            "x": vector_x * resolved_step,
            "y": vector_y * resolved_step,
        }

    @staticmethod
    def _build_ircut_params(value: int) -> dict[str, int | str]:
        """Build query parameters for an ircut command."""
        resolved_value = int(value)
        if resolved_value not in (0, 1):
            raise HomeAssistantError("ircut value must be 0 or 1")

        return {
            "cmd": "ircut",
            "val": resolved_value,
        }

    async def _send_get(
        self,
        endpoint_path: str,
        params: dict | None = None,
        *,
        expect_json: bool = False,
    ) -> dict | None:
        """Call a camera API endpoint with query params."""
        session = async_get_clientsession(self._hass)
        url = f"{self._base_url.rstrip('/')}/{endpoint_path.lstrip('/')}"
        headers = self._build_headers()

        try:
            response = await session.get(
                url,
                params=params,
                headers=headers,
                timeout=ClientTimeout(total=8),
            )
        except ClientError as err:
            raise HomeAssistantError(f"Could not reach camera API at {url}: {err}") from err

        if response.status >= 400:
            body = await response.text()
            raise HomeAssistantError(
                f"Camera API returned {response.status} for {response.url}: {body}"
            )

        if not expect_json:
            return None

        try:
            payload = await response.json(content_type=None)
        except ValueError as err:
            body = await response.text()
            raise HomeAssistantError(
                f"Camera API returned invalid JSON for {response.url}: {body}"
            ) from err

        if not isinstance(payload, dict):
            raise HomeAssistantError(
                f"Camera API returned unexpected heartbeat payload type: {type(payload).__name__}"
            )

        return payload

    async def send_command(self, command: str, step_size: float | None = None) -> None:
        """Call the local camera API for a motor command."""
        params = self._build_command_params(command, step_size)
        await self._send_get(MOTOR_ENDPOINT_PATH, params)

    async def send_ircut(self, value: int) -> None:
        """Call the local camera API to set ircut value (0 or 1)."""
        params = self._build_ircut_params(value)
        await self._send_get(IMP_ENDPOINT_PATH, params)

    async def get_heartbeat(self) -> dict:
        """Fetch heartbeat info from the camera."""
        payload = await self._send_get(HEARTBEAT_ENDPOINT_PATH, expect_json=True)
        if payload is None:
            raise HomeAssistantError("Camera API returned no heartbeat payload")

        return payload
