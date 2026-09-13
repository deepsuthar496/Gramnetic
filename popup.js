const $ = (id) => document.getElementById(id);

async function refresh() {
  $("ver").textContent = "v" + chrome.runtime.getManifest().version;

  // 1. engine state from background worker
  let engine = "unknown", engineError = "", enabled = true;
  try {
    const s = await chrome.runtime.sendMessage({ type: "RTG_STATUS" });
    engine = s.engine; engineError = s.engineError || ""; enabled = s.enabled !== false;
  } catch { engine = "unreachable"; }

  // 2. page state from content script
  const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  let page = null;
  if (tab?.id) {
    try {
      page = await chrome.tabs.sendMessage(tab.id, { type: "RTG_PAGE_STATUS" });
    } catch { page = null; }
  }
  if (page) {
    $("cSpell").textContent = page.spelling ?? 0;
    $("cGram").textContent = page.grammar ?? 0;
  }

  // 3. status line
  const st = $("status");
  st.className = "";
  if (engine === "ready" && page) {
    st.classList.add("ok");
    st.textContent = `Engine ready · ${page.fields} field${page.fields === 1 ? "" : "s"} on this page`;
    if (page.fields === 0) st.textContent += " — click into a text field";
  } else if (engine === "ready" && !page) {
    st.textContent = "Engine ready, but checker isn't on this page — reload the tab (chrome:// pages unsupported)";
  } else if (engine === "loading") {
    st.textContent = "Loading dictionary…";
  } else if (engine === "unreachable") {
    st.classList.add("bad");
    st.textContent = "Background unreachable — reload the extension";
  } else {
    st.classList.add("bad");
    st.textContent = "Engine error" + (engineError ? ": " + engineError : "") + " — reload the extension";
  }
  if (!enabled) st.textContent = "Paused — enable to resume checking";

  $("toggle").checked = enabled;
  $("toggleLabel").textContent = enabled ? "Enabled" : "Paused";
  $("clear").className = enabled ? "on" : "";
}

$("toggle").addEventListener("change", (e) => {
  chrome.runtime.sendMessage({ type: "RTG_SET_ENABLED", enabled: e.target.checked }, () => refresh());
});

$("clear").addEventListener("click", () => {
  chrome.storage.local.set({ ignored: [] }, () => refresh());
});

refresh();
