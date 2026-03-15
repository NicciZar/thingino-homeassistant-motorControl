"""Constants for Thingino camera motor control."""

DOMAIN = "thingino_motor_control"

CONF_HOST = "host"
CONF_USE_HTTPS = "use_https"
CONF_AUTH_HEADER_NAME = "auth_header_name"
CONF_AUTH_HEADER_VALUE = "auth_header_value"
CONF_USERNAME = "username"
CONF_PASSWORD = "password"
CONF_ENTRY_ID = "entry_id"
CONF_STEP_SIZE = "step_size"

DEFAULT_AUTH_HEADER_NAME = "Authorization"
DEFAULT_USE_HTTPS = False
DEFAULT_STEP_SIZE = 40.5

SERVICE_MOVE_UP = "move_up"
SERVICE_MOVE_DOWN = "move_down"
SERVICE_MOVE_LEFT = "move_left"
SERVICE_MOVE_RIGHT = "move_right"
SERVICE_STOP = "stop"

COMMAND_UP = "up"
COMMAND_DOWN = "down"
COMMAND_LEFT = "left"
COMMAND_RIGHT = "right"
COMMAND_STOP = "stop"

MOTOR_ENDPOINT_PATH = "/x/json-motor.cgi"

COMMAND_VECTORS = {
    COMMAND_UP: (0, -1),
    COMMAND_DOWN: (0, 1),
    COMMAND_LEFT: (-1, 0),
    COMMAND_RIGHT: (1, 0),
    COMMAND_STOP: (0, 0),
}

SERVICE_TO_COMMAND = {
    SERVICE_MOVE_UP: COMMAND_UP,
    SERVICE_MOVE_DOWN: COMMAND_DOWN,
    SERVICE_MOVE_LEFT: COMMAND_LEFT,
    SERVICE_MOVE_RIGHT: COMMAND_RIGHT,
    SERVICE_STOP: COMMAND_STOP,
}

DATA_ENTRIES = "entries"
DATA_SERVICES_REGISTERED = "services_registered"
DATA_FRONTEND_REGISTERED = "frontend_registered"

FRONTEND_CARD_URL = "/thingino_motor_control/thingino-motor-control-card.js"
