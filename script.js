const chatBox = document.getElementById("chatBox");
const input = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");

function renderMarkdown(md) {
  const html = marked.parse(md, { gfm: true, breaks: true });
  return DOMPurify.sanitize(html);
}

function appendMessage(text, role) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;

  if (role === "bot") div.innerHTML = renderMarkdown(text);
  else div.textContent = text;

  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
  return div;
}

async function streamChat(message) {
  appendMessage(message, "user");
  const botDiv = appendMessage("…", "bot");

  const resp = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });

  if (!resp.ok || !resp.body) {
    botDiv.innerHTML = renderMarkdown("⚠️ Server error. Please try again.");
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder("utf-8");

  let buffer = "";
  let fullText = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // SSE messages are separated by blank lines
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";

    for (const evt of events) {
      // Find all "data:" lines (some streams may include multiple lines)
      const dataLines = evt
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.replace(/^data:\s*/, "").trim())
        .filter(Boolean);

      for (const dataStr of dataLines) {
        if (dataStr === "[DONE]") continue;

        try {
          const json = JSON.parse(dataStr);
          const delta = json?.choices?.[0]?.delta?.content || "";
          if (!delta) continue;

          fullText += delta;

          // ✅ render markdown as it streams
          botDiv.innerHTML = renderMarkdown(fullText);
          chatBox.scrollTop = chatBox.scrollHeight;
        } catch {
          // ignore malformed/partial JSON chunks
        }
      }
    }
  }

  botDiv.innerHTML = renderMarkdown(fullText || "No reply returned.");
}

function onSend() {
  const msg = input.value.trim();
  if (!msg) return;
  input.value = "";
  streamChat(msg).catch((e) => {
    console.error(e);
    appendMessage("⚠️ Something went wrong.", "bot");
  });
}

sendBtn.addEventListener("click", onSend);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") onSend();
});