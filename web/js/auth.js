const STORAGE_KEY_TOKEN = "stratego:authToken";
const STORAGE_KEY_USER = "stratego:username";

export function getAuthToken() {
  return localStorage.getItem(STORAGE_KEY_TOKEN);
}

export function getUsername() {
  return localStorage.getItem(STORAGE_KEY_USER);
}

export function isLoggedIn() {
  return !!getAuthToken();
}

export function saveSession(token, username) {
  localStorage.setItem(STORAGE_KEY_TOKEN, token);
  localStorage.setItem(STORAGE_KEY_USER, username);
}

export function logout() {
  localStorage.removeItem(STORAGE_KEY_TOKEN);
  localStorage.removeItem(STORAGE_KEY_USER);
  location.reload();
}

export function renderNavAuth(navEl) {
  if (!navEl) return;
  if (isLoggedIn()) {
    navEl.innerHTML = `
      <a href="profile.html?user=${encodeURIComponent(getUsername())}" class="nav-user">${getUsername()}</a>
      <button id="logout-btn" class="nav-link-btn">Log out</button>
    `;
    navEl.querySelector("#logout-btn").addEventListener("click", logout);
  } else {
    navEl.innerHTML = `
      <button id="open-login-btn" class="nav-link-btn">Log in</button>
      <button id="open-signup-btn" class="nav-link-btn">Sign up</button>
    `;
    navEl.querySelector("#open-login-btn").addEventListener("click", () => showModal("login"));
    navEl.querySelector("#open-signup-btn").addEventListener("click", () => showModal("signup"));
  }
}

function showModal(type) {
  let modal = document.getElementById("auth-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "auth-modal";
    modal.className = "modal-overlay";
    document.body.appendChild(modal);
  }
  const isSignup = type === "signup";
  modal.innerHTML = `
    <div class="modal-content auth-modal-content">
      <h3>${isSignup ? "Sign Up" : "Log In"}</h3>
      <form id="auth-form">
        <input id="auth-username" type="text" placeholder="Username" required autocomplete="username" />
        <input id="auth-password" type="password" placeholder="Password" required autocomplete="${isSignup ? "new-password" : "current-password"}" />
        ${isSignup ? '<input id="auth-confirm" type="password" placeholder="Confirm password" required autocomplete="new-password" />' : ""}
        <p id="auth-error" class="error" hidden></p>
        <button type="submit" class="btn-primary">${isSignup ? "Sign Up" : "Log In"}</button>
      </form>
      <p class="auth-switch">${isSignup ? "Already have an account?" : "Need an account?"}
        <button id="auth-switch-btn" class="link-btn">${isSignup ? "Log in" : "Sign up"}</button>
      </p>
      <button id="auth-close-btn" class="modal-close">&times;</button>
    </div>
  `;
  modal.hidden = false;
  modal.querySelector("#auth-close-btn").addEventListener("click", () => { modal.hidden = true; });
  modal.querySelector("#auth-switch-btn").addEventListener("click", () => showModal(isSignup ? "login" : "signup"));
  modal.querySelector("#auth-form").addEventListener("submit", (e) => handleAuthSubmit(e, type));
}

async function handleAuthSubmit(e, type) {
  e.preventDefault();
  const errorEl = document.getElementById("auth-error");
  errorEl.hidden = true;
  const username = document.getElementById("auth-username").value.trim();
  const password = document.getElementById("auth-password").value;

  if (type === "signup") {
    const confirm = document.getElementById("auth-confirm").value;
    if (password !== confirm) {
      errorEl.textContent = "Passwords do not match";
      errorEl.hidden = false;
      return;
    }
  }

  try {
    const { callFunction } = await import("./supabaseClient.js");
    const data = await callFunction(type, { username, password });
    saveSession(data.token, data.username);
    document.getElementById("auth-modal").hidden = true;
    location.reload();
  } catch (err) {
    errorEl.textContent = err.message.replace(/_/g, " ").toLowerCase();
    errorEl.hidden = false;
  }
}
