document.addEventListener("DOMContentLoaded", () => {
  const chatBox = document.getElementById("chat-box");
  const input = document.getElementById("user-input");
  const sendBtn = document.getElementById("send-btn");

  // Enable GitHub-flavored markdown for tables
  marked.setOptions({ gfm: true, breaks: true });

  function scrollToBottom() {
    chatBox.scrollTop = chatBox.scrollHeight;
  }

  function appendUser(text) {
    const wrap = document.createElement("div");
    wrap.className = "msg me";
    wrap.textContent = text;
    chatBox.appendChild(wrap);
    scrollToBottom();
  }

  function appendBotContainer() {
    const wrap = document.createElement("div");
    wrap.className = "msg bot";

    const md = document.createElement("div");
    md.className = "md";
    md.innerHTML = ""; // streamed in

    wrap.appendChild(md);
    chatBox.appendChild(wrap);
    scrollToBottom();

    return md; // return inner container for incremental updates
  }

  function renderMarkdownInto(el, markdownText) {
    const html = marked.parse(markdownText);
    el.innerHTML = DOMPurify.sanitize(html);
  }

  async function sendMessage() {
    const userMessage = input.value.trim();
    if (!userMessage) return;

    appendUser(userMessage);
    input.value = "";

    const botEl = appendBotContainer();
    let fullText = "";

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage })
      });

      if (!response.ok || !response.body) {
        renderMarkdownInto(botEl, `**Server error:** ${response.status}`);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // parse SSE lines
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();

          // error event
          if (trimmed.startsWith("event: error")) continue;

          // data line
          if (!trimmed.startsWith("data:")) continue;

          const data = trimmed.slice(5).trim();

          if (data === "[DONE]") {
            renderMarkdownInto(botEl, fullText);
            return;
          }

          // If Groq sends JSON chunks like OpenAI:
          // data: {"choices":[{"delta":{"content":"hi"}}]}
          try {
            const json = JSON.parse(data);

            // handle explicit streamed errors
            if (json?.error) {
              renderMarkdownInto(botEl, `**Error:** ${json.error}`);
              return;
            }

            const delta = json?.choices?.[0]?.delta?.content || "";
            if (delta) {
              fullText += delta;
              // render progressively (safe + looks good)
              renderMarkdownInto(botEl, fullText);
              scrollToBottom();
            }
          } catch {
            // sometimes we get comments/pings or non-json lines; ignore
          }
        }
      }

      // If stream ended unexpectedly:
      if (!fullText) {
        renderMarkdownInto(botEl, "**No reply returned.** (Stream ended)");
      }
    } catch (err) {
      renderMarkdownInto(botEl, `**Client error:** ${err.message}`);
      console.error(err);
    }
  }

  sendBtn.addEventListener("click", sendMessage);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMessage();
  });
});