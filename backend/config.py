_CONFIG = {
    "dbPath": None,
    "openaiApiKey": None,
    "openaiChatModel": None,
    "openaiEndpoint": None,
    "appLanguage": "zh-CN",
    "workspacePath": None,
}
_CONFIG_KEYS = set(_CONFIG)


def normalize_app_language(value: object) -> str:
    normalized = str(value or "").strip().lower()
    return "en" if normalized in {"en", "english"} else "zh-CN"


def get_config() -> dict[str, str | None]:
    return dict(_CONFIG)


def set_config(config: dict[str, str | None]) -> dict[str, str | None]:
    next_config = {key: value for key, value in config.items() if key in _CONFIG_KEYS}
    language = next_config.get("appLanguage")
    if language is not None:
        next_config["appLanguage"] = normalize_app_language(language)
    _CONFIG.update(next_config)
    return get_config()
