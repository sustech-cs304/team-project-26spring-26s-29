from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .agent_service import run_prompt


class RunRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)


app = FastAPI()


@app.get("/health")
async def health() -> dict[str, bool]:
    return {"ok": True}


@app.post("/api/agent/run")
async def run_agent(payload: RunRequest) -> dict[str, str]:
    try:
        reply = await run_prompt(payload.message.strip())
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Agent request failed: {exc}") from exc

    return {"reply": reply, "agent": "openai-chat"}
