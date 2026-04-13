_CONFIG = {
    "openaiApiKey": None,
    "openaiChatModel": None,
    "openaiEndpoint": None,
}


def get_config() -> dict[str, str | None]:
    return dict(_CONFIG)


def set_config(config: dict[str, str | None]) -> dict[str, str | None]:
    _CONFIG.update(config)
    return get_config()
