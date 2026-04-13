const $ = (id) => document.getElementById(id);
const prompt = $("prompt");
const send = $("send");
const status = $("status");
const response = $("response");

async function refresh() {
  const [{ ok }, config] = await Promise.all([
    window.agentAPI.health().catch(() => ({ ok: false })),
    window.configAPI.get().catch(() => null),
  ]);
  const ready = ok && Boolean(config?.openaiChatModel);

  status.textContent = !ok ? "starting" : ready ? "ready" : "config needed";
  send.disabled = !ready;
}

async function run() {
  const message = prompt.value.trim();
  if (!message || send.disabled) {
    return;
  }

  send.disabled = true;
  response.textContent = "running...";

  try {
    response.textContent = (await window.agentAPI.runPrompt(message)).reply;
    status.textContent = "ready";
  } catch (error) {
    response.textContent = error.message;
    status.textContent = "error";
  }

  await refresh();
}

send.onclick = run;
prompt.onkeydown = (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    run();
  }
};

refresh();
setInterval(refresh, 2000);
