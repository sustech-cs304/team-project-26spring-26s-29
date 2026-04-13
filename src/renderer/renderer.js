const $ = (id) => document.getElementById(id);
const prompt = $("prompt");
const send = $("send");
const status = $("status");
const response = $("response");

async function refresh() {
  const { ok } = await window.agentAPI.health().catch(() => ({ ok: false }));
  status.textContent = ok ? "ready" : "starting";
  send.disabled = !ok;
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
