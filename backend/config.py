_CONFIG = {
    "dbPath": None,
    "openaiApiKey": None,
    "openaiChatModel": None,
    "openaiEndpoint": None,
    "workspacePath": None,
    "mimoWebSearchEnabled": False,
}


def get_config() -> dict[str, str | bool | None]:
    return dict(_CONFIG)


def set_config(config: dict[str, str | bool | None]) -> dict[str, str | bool | None]:
    _CONFIG.update(config)
    return get_config()
