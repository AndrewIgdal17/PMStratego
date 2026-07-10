import { callFunction } from "./supabaseClient.js";

function storeToken(roomCode, token) {
  localStorage.setItem(`stratego:${roomCode}:token`, token);
}

document.getElementById("new-game-btn").addEventListener("click", async () => {
  const button = document.getElementById("new-game-btn");
  const resultEl = document.getElementById("new-game-result");
  button.disabled = true;
  try {
    const { roomCode, token, invitePath } = await callFunction("create-game", {});
    storeToken(roomCode, token);
    const inviteUrl = `${location.origin}${invitePath}`;
    resultEl.hidden = false;
    resultEl.innerHTML = `Room created! Send this link to your friend: <a href="${inviteUrl}">${inviteUrl}</a>`;
    location.href = `setup.html?code=${roomCode}`;
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
    storeToken(roomCode, token);
    location.href = `setup.html?code=${roomCode}`;
  } catch (err) {
    errorEl.hidden = false;
    errorEl.textContent = `Could not join: ${err.message}`;
  }
});
