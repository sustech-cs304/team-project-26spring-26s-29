from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, field_validator

from .agent_service import run_prompt
from .config import get_config, set_config


class RunRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)

    @field_validator("message")
    @classmethod
    def normalize_message(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Message is empty.")
        return value


class RuntimeConfigRequest(BaseModel):
    openaiApiKey: str | None = None
    openaiChatModel: str | None = None
    openaiEndpoint: str | None = None


app = FastAPI()


@app.get("/health")
async def health() -> dict[str, bool]:
    return {"ok": True}


@app.get("/api/config")
async def read_runtime_config() -> dict[str, str | None]:
    return get_config()


@app.post("/api/config")
async def write_runtime_config(payload: RuntimeConfigRequest) -> dict[str, str | None]:
    return set_config(payload.model_dump())


@app.post("/api/agent/run")
async def run_agent(payload: RunRequest) -> dict[str, str]:
    try:
        reply = await run_prompt(payload.message)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Agent request failed: {exc}") from exc

    return {"reply": reply, "agent": "openai-chat"}
