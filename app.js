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
  importFile: document.querySelector("#importFile"),
  narrowColumns: document.querySelector("#narrowColumns"),
  wideColumns: document.querySelector("#wideColumns"),
  columnWidthLabel: document.querySelector("#columnWidthLabel"),
  newPageName: document.querySelector("#newPageName"),
  addPageButton: document.querySelector("#addPageButton"),
  renamePageName: document.querySelector("#renamePageName"),
  renamePageButton: document.querySelector("#renamePageButton"),
  movePageLeft: document.querySelector("#movePageLeft"),
  movePageRight: document.querySelector("#movePageRight"),
  dataPanel: document.querySelector("#dataPanel"),
  dataPanelTitle: document.querySelector("#dataPanelTitle"),
  dataText: document.querySelector("#dataText"),
  copyDataButton: document.querySelector("#copyDataButton"),
  applyImportButton: document.querySelector("#applyImportButton"),
  closeDataPanel: document.querySelector("#closeDataPanel")
};

const pending = new Map();
const COLUMN_WIDTH_KEY = "inventoryColumnWidth";
const COLUMN_WIDTH_MIN = 32;
const COLUMN_WIDTH_MAX = 150;
const COLUMN_WIDTH_STEP = 8;

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
      const matrixColors = Object.keys(style.matrix || {});
      const matrixSizes = Object.values(style.matrix || {})
        .flatMap(row => Object.keys(row || {}));
      const sizes = uniqueList([
        ...(Array.isArray(style.sizes) ? style.sizes : []),
        ...matrixSizes,
        ...(next.settings.sizes || [])
      ]);
      const colors = uniqueList([
        ...(Array.isArray(style.colors) ? style.colors : []),
        ...matrixColors,
        ...(next.settings.colors || [])
      ]);
      style.sizes = sizes;
      style.colors = colors;
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
  const sizes = styleSizes(style);
  const colors = styleColors(style);
  style.sizes = sizes;
  style.colors = colors;
  style.matrix = style.matrix || {};
  colors.forEach(color => {
    style.matrix[color] = style.matrix[color] || {};
    sizes.forEach(size => {
      if (style.matrix[color][size] == null) style.matrix[color][size] = 0;
    });
  });
}

function styleSizes(style) {
  const fromStyle = Array.isArray(style?.sizes) ? style.sizes : [];
  const fromMatrix = Object.values(style?.matrix || {})
    .flatMap(row => Object.keys(row || {}));
  const fallback = fromStyle.length ? [] : (state.settings.sizes || []);
  return uniqueList([...fromStyle, ...fromMatrix, ...fallback]);
}

function styleColors(style) {
  const fromStyle = Array.isArray(style?.colors) ? style.colors : [];
  const fromMatrix = Object.keys(style?.matrix || {});
  const fallback = fromStyle.length ? [] : (state.settings.colors || []);
  return uniqueList([...fromStyle, ...fromMatrix, ...fallback]);
}

function uniqueList(values) {
  return [...new Set(values.map(value => String(value || "").trim()).filter(Boolean))];
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
    const style = {
      id: makeId("style"),
      name: body.name.trim(),
      colors: ["黑色"],
      sizes: cloneData(state.settings.sizes || []),
      matrix: {}
    };
    ensureStyleMatrix(style);
    page.styles.push(style);
  } else if (pathname === "/api/style-colors" && method === "POST") {
    const style = findLocalStyle(body.pageId, body.styleId);
    const color = body.color?.trim();
    if (!color) throw new Error("请输入颜色");
    ensureStyleMatrix(style);
    if (!style.colors.includes(color)) style.colors.push(color);
    style.matrix[color] = style.matrix[color] || {};
    style.sizes.forEach(size => {
      if (style.matrix[color][size] == null) style.matrix[color][size] = 0;
    });
  } else if (pathname === "/api/style-colors" && method === "PUT") {
    const style = findLocalStyle(body.pageId, body.styleId);
    const oldColor = body.oldColor;
    const newColor = body.newColor?.trim();
    if (!newColor) throw new Error("请输入颜色");
    ensureStyleMatrix(style);
    if (oldColor !== newColor && style.colors.includes(newColor)) throw new Error("这个款已有这个颜色");
    style.colors = style.colors.map(color => color === oldColor ? newColor : color);
    if (style.matrix[oldColor] && oldColor !== newColor) {
      style.matrix[newColor] = style.matrix[oldColor];
      delete style.matrix[oldColor];
    }
  } else if (pathname === "/api/style-colors" && method === "DELETE") {
    const style = findLocalStyle(body.pageId, body.styleId);
    const color = body.color;
    ensureStyleMatrix(style);
    style.colors = style.colors.filter(next => next !== color);
    delete style.matrix[color];
  } else if (pathname === "/api/style-sizes" && method === "POST") {
    const style = findLocalStyle(body.pageId, body.styleId);
    const size = body.size?.trim();
    if (!size) throw new Error("请输入尺码");
    ensureStyleMatrix(style);
    if (!style.sizes.includes(size)) style.sizes.push(size);
    style.colors.forEach(color => {
      style.matrix[color] = style.matrix[color] || {};
      if (style.matrix[color][size] == null) style.matrix[color][size] = 0;
    });
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
  updateFixedControlsOffset();
}

function activePage() {
  return state.pages.find(page => page.id === state.activePageId) || state.pages[0] || { styles: [] };
}

function activePageIndex() {
  return state.pages.findIndex(page => page.id === activePage().id);
}

function findLocalStyle(pageId, styleId) {
  const targetPage = state.pages.find(page => page.id === pageId) || activePage();
  const style = targetPage.styles.find(next => next.id === styleId);
  if (!style) throw new Error("没有找到这个款");
  return style;
}

function renderTabs() {
  els.pageTabs.innerHTML = state.pages.map(page => `
    <button
      class="pageTab ${page.id === state.activePageId ? "active" : ""}"
      type="button"
      data-page-id="${escapeHtml(page.id)}"
    >${escapeHtml(page.name)}</button>
  `).join("");
  if (els.renamePageName) els.renamePageName.value = activePage().name || "";
  updateFixedControlsOffset();
}

async function persistPages() {
  const data = currentInventoryData();
  if (isLocalMode()) {
    saveLocalInventory();
    setState(data);
    return;
  }
  await importInventoryData(data);
}

async function addPage() {
  const name = els.newPageName.value.trim();
  if (!name) return;
  if (state.pages.some(page => page.name === name)) {
    alert("已经有这个页面名了");
    return;
  }

  const page = {
    id: makeId("page"),
    name,
    styles: [{
      id: makeId("style"),
      name: "款1",
      colors: ["黑色"],
      sizes: cloneData(state.settings.sizes || []),
      matrix: {}
    }]
  };
  state.pages.push(page);
  state.activePageId = page.id;
  localStorage.setItem("activePageId", state.activePageId);
  els.newPageName.value = "";
  await persistPages();
}

async function renamePage() {
  const page = activePage();
  const name = els.renamePageName.value.trim();
  if (!name) {
    els.renamePageName.value = page.name || "";
    return;
  }
  if (state.pages.some(next => next.id !== page.id && next.name === name)) {
    alert("已经有这个页面名了");
    els.renamePageName.value = page.name || "";
    return;
  }
  page.name = name;
  await persistPages();
}

async function movePage(offset) {
  const index = activePageIndex();
  const nextIndex = index + offset;
  if (index < 0 || nextIndex < 0 || nextIndex >= state.pages.length) return;
  const [page] = state.pages.splice(index, 1);
  state.pages.splice(nextIndex, 0, page);
  await persistPages();
}

function cssNumber(name, fallback) {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
}

function clampColumnWidth(width) {
  return Math.max(COLUMN_WIDTH_MIN, Math.min(COLUMN_WIDTH_MAX, Math.round(width)));
}

function currentColumnWidth() {
  return clampColumnWidth(cssNumber("--cell-width", 92));
}

function applyColumnWidth(width, save = true) {
  const next = clampColumnWidth(width);
  document.documentElement.style.setProperty("--cell-width", `${next}px`);
  document.documentElement.style.setProperty("--row-head-width", `${Math.max(52, Math.min(92, next + 16))}px`);
  document.documentElement.style.setProperty("--delete-width", `${Math.max(48, Math.min(74, next))}px`);
  if (els.columnWidthLabel) els.columnWidthLabel.textContent = `${next}px`;
  if (save) localStorage.setItem(COLUMN_WIDTH_KEY, String(next));
  updateFixedControlsOffset();
}

function changeColumnWidth(delta) {
  applyColumnWidth(currentColumnWidth() + delta);
}

function initColumnWidth() {
  const saved = Number(localStorage.getItem(COLUMN_WIDTH_KEY));
  if (Number.isFinite(saved) && saved > 0) {
    applyColumnWidth(saved, false);
  } else if (els.columnWidthLabel) {
    els.columnWidthLabel.textContent = `${currentColumnWidth()}px`;
  }
}

function updateFixedControlsOffset() {
  const controls = document.querySelector(".stickyControls");
  if (!controls) return;
  document.documentElement.style.setProperty("--fixed-controls-height", `${Math.ceil(controls.getBoundingClientRect().height)}px`);
}

function renderSheets() {
  const page = activePage();

  if (!page.styles.length) {
    els.sheets.innerHTML = `<section class="emptyPage">这个页面还没有款，输入款名后点“加款”。</section>`;
    return;
  }

  els.sheets.innerHTML = page.styles.map(style => {
    ensureStyleMatrix(style);
    const sizes = styleSizes(style);
    const colors = styleColors(style);
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
              data-page-id="${escapeHtml(page.id)}"
              data-style-id="${escapeHtml(style.id)}"
              data-old-color="${escapeHtml(color)}"
              aria-label="${escapeHtml(color)} 颜色名称"
            >
          </th>
          ${cells}
          <td class="deleteCell">
            <button
              class="deleteRowButton"
              type="button"
              data-page-id="${escapeHtml(page.id)}"
              data-style-id="${escapeHtml(style.id)}"
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
        <div class="sheetTools">
          <form class="styleColorForm" data-page-id="${escapeHtml(page.id)}" data-style-id="${escapeHtml(style.id)}">
            <input autocomplete="off" name="color" placeholder="本款新增颜色">
            <button type="submit">加行</button>
          </form>
          <form class="styleSizeForm" data-page-id="${escapeHtml(page.id)}" data-style-id="${escapeHtml(style.id)}">
            <input autocomplete="off" name="size" placeholder="本款新增尺码">
            <button type="submit">加列</button>
          </form>
          <button
            class="ocrButton"
            type="button"
            data-page-id="${escapeHtml(page.id)}"
            data-style-id="${escapeHtml(style.id)}"
          >导入TXT加行</button>
        </div>
        <div class="sheetWrap">
          <table class="inventorySheet">
            ${head}
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="sheetFooter">
          <button
            class="deleteStyleButton"
            type="button"
            data-page-id="${escapeHtml(page.id)}"
            data-style-id="${escapeHtml(style.id)}"
            data-style-name="${escapeHtml(style.name)}"
          >删除款</button>
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
  const pageId = input.dataset.pageId;
  const styleId = input.dataset.styleId;
  const oldColor = input.dataset.oldColor;
  const newColor = input.value.trim();

  if (!newColor) {
    input.value = oldColor;
    return;
  }

  if (newColor === oldColor) return;

  input.classList.add("saving");
  try {
    await requestJson("/api/style-colors", {
      method: "PUT",
      body: JSON.stringify({ pageId, styleId, oldColor, newColor })
    });
  } catch (error) {
    input.value = oldColor;
    alert(error.message);
  } finally {
    input.classList.remove("saving");
  }
}

async function deleteColor(button) {
  const pageId = button.dataset.pageId;
  const styleId = button.dataset.styleId;
  const color = button.dataset.color;
  if (!color) return;
  if (!confirm(`确定只删除这个款里的“${color}”这一行吗？`)) return;

  button.disabled = true;
  try {
    await requestJson("/api/style-colors", {
      method: "DELETE",
      body: JSON.stringify({ pageId, styleId, color })
    });
  } catch (error) {
    button.disabled = false;
    alert(error.message);
  }
}

async function deleteStyle(button) {
  const pageId = button.dataset.pageId;
  const styleId = button.dataset.styleId;
  const styleName = button.dataset.styleName || "这个款";
  const page = state.pages.find(next => next.id === pageId);
  if (!page) return;
  const index = page.styles.findIndex(style => style.id === styleId);
  if (index < 0) return;
  if (!confirm(`确定删除“${styleName}”这个款吗？里面的库存也会一起删除。`)) return;

  page.styles.splice(index, 1);
  button.disabled = true;
  try {
    await importInventoryData(currentInventoryData());
  } catch (error) {
    alert(error.message || "删除款失败");
    button.disabled = false;
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
  const form = event.target.closest(".styleColorForm");
  const colorInput = form.elements.color;
  const color = colorInput.value.trim();
  if (!color) return;

  try {
    await requestJson("/api/style-colors", {
      method: "POST",
      body: JSON.stringify({
        pageId: form.dataset.pageId,
        styleId: form.dataset.styleId,
        color
      })
    });
    colorInput.value = "";
  } catch (error) {
    alert(error.message);
  }
}

async function addSize(event) {
  event.preventDefault();
  const form = event.target.closest(".styleSizeForm");
  const sizeInput = form.elements.size;
  const size = sizeInput.value.trim();
  if (!size) return;

  try {
    await requestJson("/api/style-sizes", {
      method: "POST",
      body: JSON.stringify({
        pageId: form.dataset.pageId,
        styleId: form.dataset.styleId,
        size
      })
    });
    sizeInput.value = "";
  } catch (error) {
    alert(error.message);
  }
}

function parseTextRows(text) {
  const blocked = [
    "颜色分类",
    "添加图片",
    "删除",
    "开始排序",
    "添加定制规格",
    "请输入规格名称"
  ];

  return uniqueList(
    String(text || "")
      .replaceAll("删除", "")
      .replace(/[ \u3000]+/g, "")
      .replace(/[|｜]/g, "\n")
      .split(/[\n\r\t]+/)
      .flatMap(line => line.split(/\s{2,}/))
      .map(item => item.trim())
      .map(item => item.replace(/^[·•\-—\s]+|[·•\-—\s]+$/g, ""))
      .map(item => item.replace(/\s*[-－–—]\s*/g, "-"))
      .filter(item => item.length >= 2 && item.length <= 24)
      .filter(item => !blocked.some(word => item.includes(word)))
      .filter(item => /[\u4e00-\u9fa5A-Za-z0-9]/.test(item))
  );
}

function chooseTextFile() {
  return new Promise(resolve => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".txt,text/plain";
    input.hidden = true;
    document.body.appendChild(input);
    input.addEventListener("change", () => {
      const file = input.files?.[0] || null;
      input.remove();
      resolve(file);
    }, { once: true });
    input.click();
  });
}

async function addTextRows(button) {
  const file = await chooseTextFile();
  if (!file) return;

  button.disabled = true;
  const oldText = button.textContent;
  button.textContent = "读取中...";
  try {
    const text = await file.text();
    const rows = parseTextRows(text);
    if (!rows.length) {
      alert("TXT 里没有找到可添加的规格。");
      return;
    }

    const ok = confirm(`读取到 ${rows.length} 个规格，是否加到这个款？\n\n${rows.join("\n")}`);
    if (!ok) return;

    for (const color of rows) {
      await requestJson("/api/style-colors", {
        method: "POST",
        body: JSON.stringify({
          pageId: button.dataset.pageId,
          styleId: button.dataset.styleId,
          color
        })
      });
    }
    alert(`已加行：${rows.length} 个`);
  } catch (error) {
    alert(error.message || "TXT 读取失败，请确认选择的是文本文档。");
  } finally {
    button.disabled = false;
    button.textContent = oldText;
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

function inventoryFileName() {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0")
  ].join("");
  return `服装库存-${stamp}.json`;
}

function exportInventoryFile() {
  const fileName = inventoryFileName();
  const content = JSON.stringify(currentInventoryData(), null, 2);

  if (window.AndroidInventory?.saveFile) {
    window.AndroidInventory.saveFile(fileName, content);
    return;
  }

  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function chooseImportFile() {
  els.importFile.value = "";
  els.importFile.click();
}

async function importInventoryFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!confirm("确定导入这个库存文件吗？当前库存会被覆盖。")) return;

  try {
    const data = JSON.parse(await file.text());
    await importInventoryData(data);
    alert("导入完成");
  } catch (error) {
    alert(error.message || "导入失败，请确认选择的是导出的库存 JSON 文件");
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
    navigator.serviceWorker.register("sw.js").catch(() => {});
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

  const deleteStyleButton = event.target.closest(".deleteStyleButton");
  if (deleteStyleButton) deleteStyle(deleteStyleButton);

  const ocrButton = event.target.closest(".ocrButton");
  if (ocrButton) addTextRows(ocrButton);
});

els.sheets.addEventListener("keydown", event => {
  const input = event.target.closest(".cellInput, .colorInput, .styleInput");
  if (input && event.key === "Enter") {
    event.preventDefault();
    input.blur();
  }
});

els.sheets.addEventListener("submit", event => {
  const colorForm = event.target.closest(".styleColorForm");
  if (colorForm) {
    addColor(event);
    return;
  }

  const sizeForm = event.target.closest(".styleSizeForm");
  if (sizeForm) addSize(event);
});

els.pageTabs.addEventListener("click", event => {
  const button = event.target.closest(".pageTab");
  if (!button) return;
  const targetPage = button.dataset.pageId
    ? state.pages.find(page => page.id === button.dataset.pageId)
    : state.pages.find(page => page.name === button.dataset.pageName);
  if (!targetPage) return;
  state.activePageId = targetPage.id;
  localStorage.setItem("activePageId", state.activePageId);
  renderTabs();
  renderSheets();
});

els.styleForm.addEventListener("submit", addStyle);
els.styleSearch.addEventListener("input", searchStyle);
els.exportButton.addEventListener("click", exportInventoryFile);
els.importButton.addEventListener("click", chooseImportFile);
els.importFile.addEventListener("change", importInventoryFile);
els.narrowColumns.addEventListener("click", () => changeColumnWidth(-COLUMN_WIDTH_STEP));
els.wideColumns.addEventListener("click", () => changeColumnWidth(COLUMN_WIDTH_STEP));
els.addPageButton.addEventListener("click", addPage);
els.renamePageButton.addEventListener("click", renamePage);
els.renamePageName.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    renamePage();
  }
});
els.movePageLeft.addEventListener("click", () => movePage(-1));
els.movePageRight.addEventListener("click", () => movePage(1));
els.copyDataButton.addEventListener("click", exportInventoryFile);
els.applyImportButton.addEventListener("click", importInventoryFile);
els.closeDataPanel.addEventListener("click", () => {
  els.dataPanel.hidden = true;
});

initColumnWidth();
loadInventory();
connectEvents();
registerServiceWorker();
window.addEventListener("resize", updateFixedControlsOffset);
setTimeout(updateFixedControlsOffset, 0);
setTimeout(updateFixedControlsOffset, 300);
