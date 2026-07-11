import { callFunction } from "./supabaseClient.js";
import { pickBotFormationPlacements } from "./bot.js";

function storeSession(roomCode, token, slot) {
  localStorage.setItem(`stratego:${roomCode}:token`, token);
  localStorage.setItem(`stratego:${roomCode}:slot`, String(slot));
}

document.getElementById("new-game-btn").addEventListener("click", async () => {
  const button = document.getElementById("new-game-btn");
  const resultEl = document.getElementById("new-game-result");
  button.disabled = true;
  try {
    const { roomCode, token, invitePath } = await callFunction("create-game", {});
    storeSession(roomCode, token, 1);
    const inviteUrl = `${location.origin}${invitePath}`;
    resultEl.hidden = false;
    resultEl.innerHTML = `
      <p class="success-text">Room created!</p>
      <p class="room-code-label">Room code:</p>
      <div class="room-code-box">${roomCode}</div>
      <div class="copy-buttons">
        <button id="copy-link-btn" class="copy-btn">Copy Link</button>
        <button id="copy-code-btn" class="copy-btn">Copy Code</button>
      </div>
      <button id="continue-to-setup-btn" class="btn-primary" style="width:100%;margin-top:0.75rem;">Continue to setup</button>
    `;
    document.getElementById("copy-link-btn").addEventListener("click", async () => {
      await navigator.clipboard.writeText(inviteUrl);
      const btn = document.getElementById("copy-link-btn");
      btn.textContent = "Copied!";
      setTimeout(() => { btn.textContent = "Copy Link"; }, 1500);
    });
    document.getElementById("copy-code-btn").addEventListener("click", async () => {
      await navigator.clipboard.writeText(roomCode);
      const btn = document.getElementById("copy-code-btn");
      btn.textContent = "Copied!";
      setTimeout(() => { btn.textContent = "Copy Code"; }, 1500);
    });
    document.getElementById("continue-to-setup-btn").addEventListener("click", () => {
      location.href = `setup.html?code=${roomCode}`;
    });
  } catch (err) {
    resultEl.hidden = false;
    resultEl.textContent = `Failed to create game: ${err.message}`;
  } finally {
    button.disabled = false;
  }
});

document.getElementById("join-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorEl = document.getElementById("join-error");
  const roomCode = document.getElementById("room-code-input").value.trim().toUpperCase();
  errorEl.hidden = true;
  try {
    const { token } = await callFunction("join-game", { roomCode });
    storeSession(roomCode, token, 2);
    location.href = `setup.html?code=${roomCode}`;
  } catch (err) {
    errorEl.hidden = false;
    errorEl.textContent = `Could not join: ${err.message}`;
  }
});

document.getElementById("play-bot-btn").addEventListener("click", async () => {
  const button = document.getElementById("play-bot-btn");
  const resultEl = document.getElementById("play-bot-error");
  button.disabled = true;
  try {
    const { roomCode, token } = await callFunction("create-game", { isBotGame: true });
    storeSession(roomCode, token, 1);

    const { token: botToken } = await callFunction("join-game", { roomCode });
    localStorage.setItem(`stratego:${roomCode}:botToken`, botToken);
    const placements = pickBotFormationPlacements();
    await callFunction("submit-setup", { token: botToken, placements });

    location.href = `setup.html?code=${roomCode}`;
  } catch (err) {
    resultEl.hidden = false;
    resultEl.textContent = `Failed to start bot game: ${err.message}`;
    button.disabled = false;
  }
});
