(function () {
  "use strict";

  const page = document.body.dataset.page || "setup";
  const form = document.getElementById("server-form");
  const input = document.getElementById("server-url");
  const connectButton = document.getElementById("connect-button");
  const status = document.getElementById("status");
  const currentLabel = document.getElementById("current-server");
  const scanButton = document.getElementById("scan-button");
  const qrInput = document.getElementById("qr-file");
  const retryButton = document.getElementById("retry-button");
  const forgetButton = document.getElementById("forget-button");
  const platformLabel = document.getElementById("platform-label");

  function nativePlugin() {
    return window.Capacitor && window.Capacitor.Plugins ? window.Capacitor.Plugins.HomeOrbitServer : null;
  }

  async function waitForPlugin(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const plugin = nativePlugin();
      if (plugin) return plugin;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return null;
  }

  function setStatus(message, kind) {
    if (!status) return;
    status.textContent = message || "";
    status.className = `status${kind ? ` ${kind}` : ""}`;
  }

  function normalizeServer(raw) {
    const value = String(raw || "").trim();
    if (!value) throw new Error("Enter the address of your HomeOrbit server.");
    if (/\s/.test(value)) throw new Error("Server addresses cannot contain spaces.");
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
    let url;
    try {
      url = new URL(withScheme);
    } catch {
      throw new Error("That does not look like a valid server address.");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("Use an http(s) server address.");
    }
    if (url.username || url.password) throw new Error("Do not include credentials in the server address.");
    if (!url.hostname) throw new Error("The server address needs a hostname.");
    if (!/^[a-z0-9._:\[\]-]+$/i.test(url.hostname) || url.hostname.includes("%")) {
      throw new Error("The server hostname contains invalid characters.");
    }
    if (url.pathname !== "/" || url.search || url.hash) {
      throw new Error("Use the HomeOrbit root address without a path, query or fragment.");
    }
    return url.origin;
  }

  function extractQrServer(text) {
    const value = String(text || "").trim();
    if (!value) return "";
    try {
      const parsed = new URL(value);
      if (parsed.protocol === "homeorbit:" && parsed.searchParams.get("url")) {
        return parsed.searchParams.get("url");
      }
    } catch {
      // Plain server URL below.
    }
    return value;
  }

  async function getCurrent() {
    const plugin = await waitForPlugin(1500);
    if (!plugin) return { plugin: null, url: null };
    try {
      const result = await plugin.get();
      return { plugin, url: result && result.url ? result.url : null };
    } catch {
      return { plugin, url: null };
    }
  }

  async function connect(raw) {
    let server;
    try {
      server = normalizeServer(raw);
    } catch (error) {
      setStatus(error.message, "error");
      return;
    }
    setStatus("Connecting…");
    if (connectButton) {
      connectButton.disabled = true;
      connectButton.innerHTML = '<span class="spinner"></span> Connecting…';
    }
    try {
      const plugin = await waitForPlugin(2500);
      if (plugin) {
        await plugin.set({ url: server });
        await plugin.reload();
        return;
      }
      window.location.replace(server);
    } catch (error) {
      setStatus(error && error.message ? error.message : "Could not save the server address.", "error");
      if (connectButton) {
        connectButton.disabled = false;
        connectButton.textContent = "Connect";
      }
    }
  }

  async function decodeQr(file) {
    if (!file) return;
    if (typeof window.jsQR !== "function") {
      setStatus("QR decoding is unavailable in this build. Enter the address manually.", "error");
      return;
    }
    setStatus("Reading QR code…");
    const objectUrl = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("That image could not be read."));
        img.src = objectUrl;
      });
      const maxSide = Math.max(image.naturalWidth, image.naturalHeight);
      const scale = maxSide > 1600 ? 1600 / maxSide : 1;
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("This device cannot decode the QR image.");
      context.drawImage(image, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height);
      const code = window.jsQR(pixels.data, width, height, { inversionAttempts: "attemptBoth" });
      if (!code || !code.data) {
        setStatus("No QR code found. Try a closer, brighter photo.", "error");
        return;
      }
      let server = extractQrServer(code.data);
      try {
        server = normalizeServer(server);
      } catch (error) {
        setStatus(error.message, "error");
        return;
      }
      if (input) input.value = server;
      setStatus("QR code read. Tap Connect to save it.", "ok");
    } catch (error) {
      setStatus(error && error.message ? error.message : "Could not read that QR image.", "error");
    } finally {
      URL.revokeObjectURL(objectUrl);
      if (qrInput) qrInput.value = "";
    }
  }

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    void connect(input ? input.value : "");
  });

  scanButton?.addEventListener("click", () => qrInput?.click());
  qrInput?.addEventListener("change", () => {
    const file = qrInput.files && qrInput.files[0];
    if (file) void decodeQr(file);
  });

  retryButton?.addEventListener("click", () => window.location.reload());
  forgetButton?.addEventListener("click", async () => {
    if (!window.confirm("Forget the saved server and return to setup?")) return;
    try {
      const plugin = await waitForPlugin(2000);
      if (plugin) {
        await plugin.clear();
        await plugin.reload();
      } else {
        window.location.href = "index.html";
      }
    } catch (error) {
      setStatus(error && error.message ? error.message : "Could not reset the server address.", "error");
    }
  });

  document.addEventListener("DOMContentLoaded", async () => {
    if (platformLabel) {
      const platform = window.Capacitor && window.Capacitor.getPlatform ? window.Capacitor.getPlatform() : "web";
      platformLabel.textContent = platform === "ios" ? "iOS app" : platform === "android" ? "Android app" : "Mobile setup";
    }
    const current = await getCurrent();
    if (current.url) {
      if (input && !input.value) input.value = current.url;
      if (currentLabel) {
        currentLabel.textContent = current.url;
        currentLabel.classList.remove("hidden");
      }
    }
    if (page === "offline" && !current.url) {
      setStatus("No server is saved. Enter the HomeOrbit address below.", "error");
    }
  });
})();
