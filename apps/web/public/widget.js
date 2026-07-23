/**
 * SaarthiOne Chat Automation — Embeddable Web Chat Widget
 * Integrates instant 24/7 automated AI replies & booking directly on any business website.
 */
(function () {
  if (window.SaarthiOneWidget) return;

  const WIDGET_ID = 'saarthione-chat-widget';
  const PRIMARY_COLOR = '#00F2FE';
  const BG_COLOR = '#0B1220';

  const style = document.createElement('style');
  style.textContent = `
    #${WIDGET_ID}-btn {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 60px;
      height: 60px;
      border-radius: 30px;
      background: linear-gradient(135deg, #00F2FE 0%, #2B6CFF 100%);
      box-shadow: 0 8px 24px rgba(0, 242, 254, 0.35);
      cursor: pointer;
      z-index: 99999;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
      border: 2px solid rgba(255, 255, 255, 0.2);
    }
    #${WIDGET_ID}-btn:hover {
      transform: scale(1.06);
      box-shadow: 0 12px 28px rgba(0, 242, 254, 0.5);
    }
    #${WIDGET_ID}-box {
      position: fixed;
      bottom: 96px;
      right: 24px;
      width: 360px;
      height: 520px;
      background: ${BG_COLOR};
      border: 1px solid rgba(0, 242, 254, 0.3);
      border-radius: 16px;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
      z-index: 99999;
      display: none;
      flex-direction: column;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    #${WIDGET_ID}-header {
      background: rgba(11, 18, 32, 0.95);
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      padding: 16px;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    #${WIDGET_ID}-messages {
      flex: 1;
      padding: 16px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .${WIDGET_ID}-msg {
      max-width: 80%;
      padding: 10px 14px;
      border-radius: 12px;
      font-size: 13px;
      line-height: 1.4;
    }
    .${WIDGET_ID}-bot {
      background: rgba(255, 255, 255, 0.08);
      color: #e2e8f0;
      align-self: flex-start;
      border: 1px solid rgba(255, 255, 255, 0.05);
    }
    .${WIDGET_ID}-user {
      background: linear-gradient(135deg, #00F2FE 0%, #2B6CFF 100%);
      color: #000;
      font-weight: 600;
      align-self: flex-end;
    }
    #${WIDGET_ID}-input-area {
      padding: 12px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      display: flex;
      gap: 8px;
    }
    #${WIDGET_ID}-input {
      flex: 1;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 20px;
      padding: 8px 14px;
      color: #fff;
      font-size: 13px;
      outline: none;
    }
    #${WIDGET_ID}-send {
      background: ${PRIMARY_COLOR};
      border: none;
      border-radius: 20px;
      padding: 8px 16px;
      color: #000;
      font-weight: 700;
      cursor: pointer;
      font-size: 12px;
    }
  `;
  document.head.appendChild(style);

  const btn = document.createElement('div');
  btn.id = `${WIDGET_ID}-btn`;
  btn.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;
  document.body.appendChild(btn);

  const box = document.createElement('div');
  box.id = `${WIDGET_ID}-box`;
  box.innerHTML = `
    <div id="${WIDGET_ID}-header">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="width:10px;height:10px;border-radius:5px;background:#00FF87;display:inline-block;"></span>
        <strong style="font-size:14px;">SaarthiOne AI Assistant</strong>
      </div>
      <span id="${WIDGET_ID}-close" style="cursor:pointer;font-size:18px;opacity:0.7;">✕</span>
    </div>
    <div id="${WIDGET_ID}-messages">
      <div class="${WIDGET_ID}-msg ${WIDGET_ID}-bot">👋 Hello! Welcome to SaarthiOne Chat Automation. How can I assist you today?</div>
    </div>
    <div id="${WIDGET_ID}-input-area">
      <input id="${WIDGET_ID}-input" type="text" placeholder="Type your message..." />
      <button id="${WIDGET_ID}-send">Send</button>
    </div>
  `;
  document.body.appendChild(box);

  let isOpen = false;
  btn.onclick = function () {
    isOpen = !isOpen;
    box.style.display = isOpen ? 'flex' : 'none';
  };
  document.getElementById(`${WIDGET_ID}-close`).onclick = function () {
    isOpen = false;
    box.style.display = 'none';
  };

  const inputEl = document.getElementById(`${WIDGET_ID}-input`);
  const msgsEl = document.getElementById(`${WIDGET_ID}-messages`);

  function sendMessage() {
    const text = inputEl.value.trim();
    if (!text) return;

    const userMsg = document.createElement('div');
    userMsg.className = `${WIDGET_ID}-msg ${WIDGET_ID}-user`;
    userMsg.textContent = text;
    msgsEl.appendChild(userMsg);
    inputEl.value = '';
    msgsEl.scrollTop = msgsEl.scrollHeight;

    setTimeout(function () {
      const botMsg = document.createElement('div');
      botMsg.className = `${WIDGET_ID}-msg ${WIDGET_ID}-bot`;
      botMsg.textContent = 'Thanks for reaching out! Our 24/7 AI agent has processed your query. An operator can also assist you via WhatsApp.';
      msgsEl.appendChild(botMsg);
      msgsEl.scrollTop = msgsEl.scrollHeight;
    }, 600);
  }

  document.getElementById(`${WIDGET_ID}-send`).onclick = sendMessage;
  inputEl.onkeydown = function (e) {
    if (e.key === 'Enter') sendMessage();
  };

  window.SaarthiOneWidget = { init: function () {} };
})();
