const $ = (id) => document.getElementById(id);
const prompt = $("prompt");
const send = $("send");
const status = $("status");
const response = $("response");
let isRunning = false;
let activeRequestId = null;

async function refresh() {
  const [{ ok }, config] = await Promise.all([
    window.agentAPI.health().catch(() => ({ ok: false })),
    window.configAPI.get().catch(() => null),
  ]);
  const ready = ok && Boolean(config?.openaiChatModel);

  status.textContent = isRunning ? "running" : !ok ? "starting" : ready ? "ready" : "config needed";
  send.disabled = isRunning || !ready;
}

async function run() {
  const message = prompt.value.trim();
  if (!message || send.disabled) {
    return;
  }

  isRunning = true;
  activeRequestId = crypto.randomUUID();
  send.disabled = true;
  status.textContent = "running";
  response.textContent = "";

  try {
    const result = await window.agentAPI.runPrompt(message, activeRequestId);
    if (!response.textContent) {
      response.textContent = result.reply;
    }
    status.textContent = "ready";
  } catch (error) {
    const errorText = error?.message || String(error);
    response.textContent = response.textContent
      ? `${response.textContent}\n\n[error] ${errorText}`
      : errorText;
    status.textContent = "error";
  } finally {
    isRunning = false;
    activeRequestId = null;
  }

  await refresh();
}

window.agentAPI.onStreamChunk(({ requestId, chunk }) => {
  if (requestId !== activeRequestId) {
    return;
  }

  response.textContent += chunk;
});

send.onclick = run;
prompt.onkeydown = (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    run();
  }
};

refresh();
setInterval(refresh, 2000);
