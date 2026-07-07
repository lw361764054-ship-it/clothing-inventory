const state = {
  settings: {
    sizes: ["M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "S"],
    colors: ["黑色", "白色", "酒红", "孔雀蓝", "藏蓝"]
  },
  pages: [],
  activePageId: localStorage.getItem("activePageId") || ""
};

const LOCAL_STORAGE_KEY = "clothingInventoryLocalData";
const REQUIRED_PAGES = ["主店", "牛仔裤", "花巷里"];

const els = {
  syncStatus: document.querySelector("#syncStatus"),
  pageTabs: document.querySelector("#pageTabs"),
  sheets: document.querySelector("#sheets"),
  styleForm: document.querySelector("#styleForm"),
  colorForm: document.querySelector("#colorForm"),
  sizeForm: document.querySelector("#sizeForm"),
  newStyle: document.querySelector("#newStyle"),
  newColor: document.querySelector("#newColor"),
  newSize: document.querySelector("#newSize"),
  styleSearch: document.querySelector("#styleSearch"),
  exportButton: document.querySelector("#exportButton"),
  importButton: document.querySelector("#importButton"),
  dataPanel: document.querySelector("#dataPanel"),
  dataPanelTitle: document.querySelector("#dataPanelTitle"),
  dataText: document.querySelector("#dataText"),
  copyDataButton: document.querySelector("#copyDataButton"),
  applyImportButton: document.querySelector("#applyImportButton"),
  closeDataPanel: document.querySelector("#closeDataPanel")
};

const pending = new Map();

function isLocalMode() {
  return location.protocol === "file:" || location.protocol === "content:" || location.hostname.endsWith("github.io");
}

function cloneData(data) {
  return JSON.parse(JSON.stringify(data));
}

function makeId(prefix) {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function saveLocalInventory() {
  const data = {
    settings: cloneData(state.settings),
    pages: cloneData(state.pages),
    updatedAt: new Date().toISOString()
  };
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
}

function currentInventoryData() {
  return {
    settings: cloneData(state.settings),
    pages: cloneData(state.pages),
    updatedAt: new Date().toISOString()
  };
}

function validateInventoryData(data) {
  if (!data || typeof data !== "object") throw new Error("数据格式不正确");
  if (!data.settings || !Array.isArray(data.settings.sizes) || !Array.isArray(data.settings.colors)) {
    throw new Error("缺少尺码或颜色数据");
  }
  if (!Array.isArray(data.pages) || !data.pages.length) {
    throw new Error("缺少页面数据");
  }
  data.pages.forEach(page => {
    if (!page.name || !Array.isArray(page.styles)) throw new Error("页面数据不完整");
  });
}

function normalizeInventoryData(data) {
  const next = {
    settings: data?.settings || cloneData(state.settings),
    pages: Array.isArray(data?.pages) ? cloneData(data.pages) : [],
    updatedAt: data?.updatedAt || new Date().toISOString()
  };

  REQUIRED_PAGES.forEach((name, index) => {
    if (next.pages.some(page => page.name === name)) return;
    next.pages.push({
      id: `page-${index + 1}`,
      name,
      styles: [{
        id: makeId("style"),
        name: "款1",
        matrix: {}
      }]
    });
  });

  next.pages.forEach(page => {
    page.styles = Array.isArray(page.styles) && page.styles.length
      ? page.styles
      : [{ id: makeId("style"), name: "款1", matrix: {} }];
    page.styles.forEach(style => {
      const sizes = next.settings.sizes || [];
      const colors = next.settings.colors || [];
      style.matrix = style.matrix || {};
      colors.forEach(color => {
        style.matrix[color] = style.matrix[color] || {};
        sizes.forEach(size => {
          if (style.matrix[color][size] == null) style.matrix[color][size] = 0;
        });
      });
    });
  });

  return next;
}

async function loadLocalInventory() {
  const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (saved) {
    const data = normalizeInventoryData(JSON.parse(saved));
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
    return data;
  }

  const response = await fetch("inventory.json");
  const data = normalizeInventoryData(await response.json());
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
  return data;
}

function ensureStyleMatrix(style) {
  const sizes = state.settings.sizes || [];
  const colors = state.settings.colors || [];
  style.matrix = style.matrix || {};
  colors.forEach(color => {
    style.matrix[color] = style.matrix[color] || {};
    sizes.forEach(size => {
      if (style.matrix[color][size] == null) style.matrix[color][size] = 0;
    });
  });
}

function handleLocalRequest(url, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const pathname = new URL(url, location.href).pathname;
  const body = options.body ? JSON.parse(options.body) : {};
  const page = activePage();

  if (pathname === "/api/cell" && method === "PUT") {
    const targetPage = state.pages.find(next => next.id === body.pageId) || page;
    const style = targetPage.styles.find(next => next.id === body.styleId);
    if (!style) throw new Error("没有找到这个款");
    ensureStyleMatrix(style);
    style.matrix[body.color] = style.matrix[body.color] || {};
    style.matrix[body.color][body.size] = Math.max(0, Math.floor(Number(body.quantity || 0)));
  } else if (pathname === "/api/styles" && method === "POST") {
    if (!body.name?.trim()) throw new Error("请输入款名");
    const style = { id: makeId("style"), name: body.name.trim(), matrix: {} };
    ensureStyleMatrix(style);
    page.styles.push(style);
  } else if (pathname === "/api/colors" && method === "POST") {
    const color = body.color?.trim();
    if (!color) throw new Error("请输入颜色");
    if (!state.settings.colors.includes(color)) state.settings.colors.push(color);
    state.pages.forEach(nextPage => nextPage.styles.forEach(ensureStyleMatrix));
  } else if (pathname === "/api/colors" && method === "PUT") {
    const oldColor = body.oldColor;
    const newColor = body.newColor?.trim();
    if (!newColor) throw new Error("请输入颜色");
    state.settings.colors = state.settings.colors.map(color => color === oldColor ? newColor : color);
    state.pages.forEach(nextPage => {
      nextPage.styles.forEach(style => {
        style.matrix = style.matrix || {};
        if (style.matrix[oldColor] && oldColor !== newColor) {
          style.matrix[newColor] = style.matrix[oldColor];
          delete style.matrix[oldColor];
        }
      });
    });
  } else if (pathname.startsWith("/api/colors/") && method === "DELETE") {
    const color = decodeURIComponent(pathname.split("/").pop());
    state.settings.colors = state.settings.colors.filter(next => next !== color);
    state.pages.forEach(nextPage => {
      nextPage.styles.forEach(style => {
        if (style.matrix) delete style.matrix[color];
      });
    });
  } else if (pathname === "/api/sizes" && method === "POST") {
    const size = body.size?.trim();
    if (!size) throw new Error("请输入尺码");
    if (!state.settings.sizes.includes(size)) state.settings.sizes.push(size);
    state.pages.forEach(nextPage => nextPage.styles.forEach(ensureStyleMatrix));
  } else {
    const styleMatch = pathname.match(/^\/api\/pages\/([^/]+)\/styles\/([^/]+)$/);
    if (styleMatch && method === "PUT") {
      const pageId = decodeURIComponent(styleMatch[1]);
      const styleId = decodeURIComponent(styleMatch[2]);
      const targetPage = state.pages.find(next => next.id === pageId) || page;
      const style = targetPage.styles.find(next => next.id === styleId);
      if (!style) throw new Error("没有找到这个款");
      if (!body.name?.trim()) throw new Error("请输入款名");
      style.name = body.name.trim();
    } else {
      throw new Error("本机模式暂不支持这个操作");
    }
  }

  saveLocalInventory();
  setState({ settings: state.settings, pages: state.pages });
  return { ok: true };
}

async function importInventoryData(data) {
  validateInventoryData(data);

  if (isLocalMode()) {
    const next = normalizeInventoryData({
      settings: cloneData(data.settings),
      pages: cloneData(data.pages),
      updatedAt: new Date().toISOString()
    });
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(next));
    setState(next);
    return next;
  }

  return requestJson("/api/import", {
    method: "PUT",
    body: JSON.stringify(data)
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function keyFor(styleId, color, size) {
  return `${state.activePageId}|||${styleId}|||${color}|||${size}`;
}

function quantityFor(style, color, size) {
  return Number(style.matrix?.[color]?.[size] || 0);
}

function setState(data) {
  state.settings = data.settings || state.settings;
  state.pages = Array.isArray(data.pages) ? data.pages : [];
  if (!state.pages.some(page => page.id === state.activePageId)) {
    state.activePageId = state.pages[0]?.id || "";
    localStorage.setItem("activePageId", state.activePageId);
  }
  renderTabs();
  renderSheets();
}

function activePage() {
  return state.pages.find(page => page.id === state.activePageId) || state.pages[0] || { styles: [] };
}

function renderTabs() {
  els.pageTabs.innerHTML = state.pages.map(page => `
    <button
      class="pageTab ${page.id === state.activePageId ? "active" : ""}"
      type="button"
      data-page-id="${escapeHtml(page.id)}"
    >${escapeHtml(page.name)}</button>
  `).join("");
}

function renderSheets() {
  const sizes = state.settings.sizes || [];
  const colors = state.settings.colors || [];
  const page = activePage();

  if (!page.styles.length) {
    els.sheets.innerHTML = `<section class="emptyPage">这个页面还没有款，输入款名后点“加款”。</section>`;
    return;
  }

  els.sheets.innerHTML = page.styles.map(style => {
    const head = `
      <thead>
        <tr>
          <th class="corner">
            <input
              class="styleInput"
              value="${escapeHtml(style.name)}"
              data-style-id="${escapeHtml(style.id)}"
              data-old-name="${escapeHtml(style.name)}"
              aria-label="${escapeHtml(style.name)} 款名"
            >
          </th>
          ${sizes.map(size => `<th>${escapeHtml(size)}</th>`).join("")}
          <th class="actionHead">删除</th>
        </tr>
      </thead>
    `;

    const rows = colors.map(color => {
      const cells = sizes.map(size => {
        const key = keyFor(style.id, color, size);
        const isPending = pending.has(key);
        const value = isPending ? pending.get(key) : quantityFor(style, color, size);
        return `
          <td>
            <input
              class="cellInput"
              type="number"
              inputmode="numeric"
              min="0"
              step="1"
              value="${escapeHtml(value)}"
              data-page-id="${escapeHtml(page.id)}"
              data-style-id="${escapeHtml(style.id)}"
              data-color="${escapeHtml(color)}"
              data-size="${escapeHtml(size)}"
              aria-label="${escapeHtml(style.name)} ${escapeHtml(color)} ${escapeHtml(size)} 库存"
            >
          </td>
        `;
      }).join("");

      return `
        <tr>
          <th class="rowHead">
            <input
              class="colorInput"
              value="${escapeHtml(color)}"
              data-old-color="${escapeHtml(color)}"
              aria-label="${escapeHtml(color)} 颜色名称"
            >
          </th>
          ${cells}
          <td class="deleteCell">
            <button
              class="deleteRowButton"
              type="button"
              data-color="${escapeHtml(color)}"
              title="删除这一行"
              aria-label="删除 ${escapeHtml(color)} 这一行"
            >删除</button>
          </td>
        </tr>
      `;
    }).join("");

    return `
      <article class="sheetPanel" data-style-id="${escapeHtml(style.id)}" data-style-name="${escapeHtml(style.name)}">
        <div class="sheetWrap">
          <table class="inventorySheet">
            ${head}
            <tbody>${rows}</tbody>
          </table>
        </div>
      </article>
    `;
  }).join("");
}

async function requestJson(url, options) {
  if (isLocalMode()) return handleLocalRequest(url, options);

  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "操作失败");
  return data;
}

async function updateCell(input) {
  const pageId = input.dataset.pageId;
  const styleId = input.dataset.styleId;
  const color = input.dataset.color;
  const size = input.dataset.size;
  const key = keyFor(styleId, color, size);
  const quantity = Math.max(0, Math.floor(Number(input.value || 0)));

  input.value = quantity;
  pending.set(key, quantity);
  input.classList.add("saving");

  try {
    await requestJson("/api/cell", {
      method: "PUT",
      body: JSON.stringify({ pageId, styleId, color, size, quantity })
    });
  } catch (error) {
    alert(error.message);
  } finally {
    pending.delete(key);
    input.classList.remove("saving");
  }
}

async function renameColor(input) {
  const oldColor = input.dataset.oldColor;
  const newColor = input.value.trim();

  if (!newColor) {
    input.value = oldColor;
    return;
  }

  if (newColor === oldColor) return;

  input.classList.add("saving");
  try {
    await requestJson("/api/colors", {
      method: "PUT",
      body: JSON.stringify({ oldColor, newColor })
    });
  } catch (error) {
    input.value = oldColor;
    alert(error.message);
  } finally {
    input.classList.remove("saving");
  }
}

async function deleteColor(button) {
  const color = button.dataset.color;
  if (!color) return;
  if (!confirm(`确定删除“${color}”这一行吗？所有款里的这一行库存都会删除。`)) return;

  button.disabled = true;
  try {
    await requestJson(`/api/colors/${encodeURIComponent(color)}`, {
      method: "DELETE"
    });
  } catch (error) {
    button.disabled = false;
    alert(error.message);
  }
}

async function renameStyle(input) {
  const pageId = state.activePageId;
  const styleId = input.dataset.styleId;
  const oldName = input.dataset.oldName;
  const name = input.value.trim();

  if (!name) {
    input.value = oldName;
    return;
  }

  if (name === oldName) return;

  input.classList.add("saving");
  try {
    await requestJson(`/api/pages/${encodeURIComponent(pageId)}/styles/${encodeURIComponent(styleId)}`, {
      method: "PUT",
      body: JSON.stringify({ name })
    });
  } catch (error) {
    input.value = oldName;
    alert(error.message);
  } finally {
    input.classList.remove("saving");
  }
}

async function addStyle(event) {
  event.preventDefault();
  const name = els.newStyle.value.trim();

  try {
    await requestJson("/api/styles", {
      method: "POST",
      body: JSON.stringify({ pageId: state.activePageId, name })
    });
    els.newStyle.value = "";
  } catch (error) {
    alert(error.message);
  }
}

async function addColor(event) {
  event.preventDefault();
  const color = els.newColor.value.trim();
  if (!color) return;

  try {
    await requestJson("/api/colors", {
      method: "POST",
      body: JSON.stringify({ color })
    });
    els.newColor.value = "";
  } catch (error) {
    alert(error.message);
  }
}

async function addSize(event) {
  event.preventDefault();
  const size = els.newSize.value.trim();
  if (!size) return;

  try {
    await requestJson("/api/sizes", {
      method: "POST",
      body: JSON.stringify({ size })
    });
    els.newSize.value = "";
  } catch (error) {
    alert(error.message);
  }
}

function searchStyle() {
  const keyword = els.styleSearch.value.trim().toLowerCase();
  document.querySelectorAll(".sheetPanel").forEach(panel => panel.classList.remove("matched"));
  if (!keyword) return;

  const panel = Array.from(document.querySelectorAll(".sheetPanel"))
    .find(next => next.dataset.styleName.toLowerCase().includes(keyword));
  if (!panel) return;

  panel.classList.add("matched");
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function showDataPanel(mode) {
  const isExport = mode === "export";
  els.dataPanel.hidden = false;
  els.dataPanelTitle.textContent = isExport ? "导出库存数据" : "导入库存数据";
  els.copyDataButton.hidden = !isExport;
  els.applyImportButton.hidden = isExport;
  els.dataText.value = isExport ? JSON.stringify(currentInventoryData(), null, 2) : "";
  els.dataText.placeholder = isExport ? "" : "把导出的库存数据粘贴到这里，然后点“确认导入”。";
  els.dataText.focus();
  els.dataText.select();
}

async function copyExportData() {
  els.dataText.focus();
  els.dataText.select();
  try {
    await navigator.clipboard.writeText(els.dataText.value);
  } catch {
    document.execCommand("copy");
  }
  alert("已复制库存数据");
}

async function applyImportData() {
  if (!confirm("确定导入这份数据吗？当前库存会被覆盖。")) return;

  try {
    const data = JSON.parse(els.dataText.value);
    await importInventoryData(data);
    els.dataPanel.hidden = true;
    alert("导入完成");
  } catch (error) {
    alert(error.message || "导入失败");
  }
}

async function loadInventory() {
  if (isLocalMode()) {
    setState(await loadLocalInventory());
    return;
  }

  const response = await fetch("/api/inventory");
  setState(await response.json());
}

function connectEvents() {
  if (isLocalMode()) {
    els.syncStatus.textContent = "本机模式：不连接 WiFi 也可以使用";
    return;
  }

  const source = new EventSource("/events");
  source.onopen = () => {
    els.syncStatus.textContent = "已连接，电脑和手机会自动同步";
  };
  source.onmessage = event => {
    if (event.data) setState(JSON.parse(event.data));
  };
  source.addEventListener("inventory", event => {
    setState(JSON.parse(event.data));
  });
  source.onerror = () => {
    els.syncStatus.textContent = "同步连接中断，正在重连...";
  };
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

els.sheets.addEventListener("focusout", event => {
  const cellInput = event.target.closest(".cellInput");
  if (cellInput) updateCell(cellInput);

  const colorInput = event.target.closest(".colorInput");
  if (colorInput) renameColor(colorInput);

  const styleInput = event.target.closest(".styleInput");
  if (styleInput) renameStyle(styleInput);
});

els.sheets.addEventListener("focusin", event => {
  const input = event.target.closest(".cellInput, .colorInput, .styleInput");
  if (!input) return;

  setTimeout(() => {
    input.select();
  }, 0);
});

els.sheets.addEventListener("click", event => {
  const deleteButton = event.target.closest(".deleteRowButton");
  if (deleteButton) deleteColor(deleteButton);
});

els.sheets.addEventListener("keydown", event => {
  const input = event.target.closest(".cellInput, .colorInput, .styleInput");
  if (input && event.key === "Enter") {
    event.preventDefault();
    input.blur();
  }
});

els.pageTabs.addEventListener("click", event => {
  const button = event.target.closest(".pageTab");
  if (!button) return;
  state.activePageId = button.dataset.pageId;
  localStorage.setItem("activePageId", state.activePageId);
  renderTabs();
  renderSheets();
});

els.styleForm.addEventListener("submit", addStyle);
els.colorForm.addEventListener("submit", addColor);
els.sizeForm.addEventListener("submit", addSize);
els.styleSearch.addEventListener("input", searchStyle);
els.exportButton.addEventListener("click", () => showDataPanel("export"));
els.importButton.addEventListener("click", () => showDataPanel("import"));
els.copyDataButton.addEventListener("click", copyExportData);
els.applyImportButton.addEventListener("click", applyImportData);
els.closeDataPanel.addEventListener("click", () => {
  els.dataPanel.hidden = true;
});

loadInventory();
connectEvents();
registerServiceWorker();
