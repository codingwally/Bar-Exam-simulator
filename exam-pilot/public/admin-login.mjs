const form = document.getElementById("professor-login");
const passphrase = document.getElementById("professor-passphrase");
const button = document.getElementById("sign-in");
const message = document.getElementById("login-message");
let signingIn = false;

function showError(text) {
  message.textContent = text;
  message.hidden = false;
}

button.disabled = false;
passphrase.addEventListener("input", () => {
  passphrase.removeAttribute("aria-invalid");
  message.hidden = true;
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (signingIn || !form.reportValidity()) return;
  signingIn = true;
  button.disabled = true;
  button.textContent = "Signing in…";
  button.setAttribute("aria-busy", "true");
  passphrase.readOnly = true;
  message.hidden = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch("/api/admin/login", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ secret: passphrase.value }),
      signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status === 401) {
        passphrase.setAttribute("aria-invalid", "true");
        throw new Error(
          "That passphrase was not recognized. Check it and try again.",
        );
      }
      if (response.status === 429) {
        const seconds = Number(response.headers.get("Retry-After"));
        const wait =
          Number.isFinite(seconds) && seconds > 0
            ? `about ${Math.ceil(seconds / 60)} minute${seconds > 60 ? "s" : ""}`
            : "a few minutes";
        throw new Error(
          `Too many sign-in attempts. Wait ${wait}, then try again.`,
        );
      }
      if (response.status === 503)
        throw new Error(
          "Professor sign-in is not ready yet. Contact the site owner.",
        );
      throw new Error("Sign-in is temporarily unavailable. Please try again.");
    }
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("Your sign-in could not be confirmed. Please try again.");
    }
    if (result.identity?.role !== "owner")
      throw new Error("Your sign-in could not be confirmed. Please try again.");
    passphrase.value = "";
    location.assign("/admin/exams");
  } catch (error) {
    showError(
      error.name === "AbortError"
        ? "Sign-in is taking longer than expected. Please try again."
        : error instanceof TypeError
          ? "Could not connect. Check your internet connection and try again."
          : error.message ||
            "Sign-in could not be completed. Please try again.",
    );
  } finally {
    clearTimeout(timeout);
    signingIn = false;
    button.disabled = false;
    button.textContent = "Sign in";
    button.removeAttribute("aria-busy");
    passphrase.readOnly = false;
  }
});
