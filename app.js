// 简单博客前端逻辑，接入后端 API

// 在这里配置你的后端地址，例如：
// const API_BASE = "http://localhost:3000/api";
// 如果你的后端路径不同，只需要修改这一行。
const API_BASE = "http://localhost:3000/api";

let state = {
  posts: [],
  activeId: null,
  editingId: null,
};

// DOM 引用
const postListEl = document.getElementById("post-list");
const emptyStateEl = document.getElementById("empty-state");
const detailEl = document.getElementById("post-detail");
const welcomePanelEl = document.getElementById("welcome-panel");
const detailTitleEl = document.getElementById("detail-title");
const detailDateEl = document.getElementById("detail-date");
const detailBodyEl = document.getElementById("detail-body");

const newPostBtn = document.getElementById("new-post-btn");
const editPostBtn = document.getElementById("edit-post-btn");
const deletePostBtn = document.getElementById("delete-post-btn");

const searchInput = document.getElementById("search-input");

// 弹窗相关
const modalEl = document.getElementById("post-modal");
const modalTitleEl = document.getElementById("modal-title");
const formTitleEl = document.getElementById("form-title");
const formBodyEl = document.getElementById("form-body");
const cancelBtn = document.getElementById("cancel-btn");
const saveBtn = document.getElementById("save-btn");

// ========== API 封装 ==========

async function apiRequest(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const resp = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`请求失败: ${resp.status} ${text}`);
  }

  // 204 No Content 时不解析 JSON
  if (resp.status === 204) return null;

  return resp.json();
}

async function fetchPosts() {
  // 约定后端：GET /posts 返回数组
  return apiRequest("/posts", { method: "GET" });
}

async function createPostOnServer(payload) {
  // 约定后端：POST /posts 接收 {title, body}，返回创建后的完整对象
  return apiRequest("/posts", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function updatePostOnServer(id, payload) {
  // 约定后端：PUT /posts/:id
  return apiRequest(`/posts/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

async function deletePostOnServer(id) {
  // 约定后端：DELETE /posts/:id
  return apiRequest(`/posts/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

function formatDate(ts) {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function getActivePost() {
  return state.posts.find((p) => p.id === state.activeId) || null;
}

function applyFilter(posts, keyword) {
  if (!keyword) return posts;
  const kw = keyword.toLowerCase();
  return posts.filter(
    (p) =>
      p.title.toLowerCase().includes(kw) ||
      p.body.toLowerCase().includes(kw)
  );
}

function renderList() {
  const keyword = searchInput.value.trim();
  const filtered = applyFilter(state.posts, keyword);

  postListEl.innerHTML = "";

  if (filtered.length === 0) {
    emptyStateEl.classList.remove("hidden");
  } else {
    emptyStateEl.classList.add("hidden");
  }

  filtered
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .forEach((post) => {
      const li = document.createElement("li");
      li.className =
        "post-item" + (post.id === state.activeId ? " active" : "");
      li.dataset.id = post.id;

      const titleLine = document.createElement("div");
      titleLine.className = "post-item-title-line";
      const title = document.createElement("div");
      title.className = "post-item-title";
      title.textContent = post.title || "未命名文章";
      const date = document.createElement("div");
      date.className = "post-item-date";
      date.textContent = formatDate(post.updatedAt);

      titleLine.appendChild(title);
      titleLine.appendChild(date);

      const excerpt = document.createElement("div");
      excerpt.className = "post-item-excerpt";
      excerpt.textContent = post.body.replace(/\s+/g, " ").slice(0, 60);

      li.appendChild(titleLine);
      li.appendChild(excerpt);

      li.addEventListener("click", () => {
        state.activeId = post.id;
        renderAll();
      });

      postListEl.appendChild(li);
    });
}

function renderDetail() {
  const post = getActivePost();
  if (!post) {
    detailEl.classList.add("hidden");
    welcomePanelEl.classList.remove("hidden");
    return;
  }
  welcomePanelEl.classList.add("hidden");
  detailEl.classList.remove("hidden");

  detailTitleEl.textContent = post.title || "未命名文章";
  detailDateEl.textContent = `${formatDate(
    post.createdAt
  )} 创建 · ${formatDate(post.updatedAt)} 更新`;
  detailBodyEl.textContent = post.body || "（暂无内容）";
}

function renderAll() {
  renderList();
  renderDetail();
}

// 弹窗控制
function openModal(mode) {
  const post = getActivePost();
  if (mode === "edit" && !post) return;

  modalEl.classList.remove("hidden");
  if (mode === "new") {
    modalTitleEl.textContent = "新建文章";
    formTitleEl.value = "";
    formBodyEl.value = "";
    state.editingId = null;
  } else {
    modalTitleEl.textContent = "编辑文章";
    formTitleEl.value = post.title;
    formBodyEl.value = post.body;
    state.editingId = post.id;
  }
  formTitleEl.focus();
}

function closeModal() {
  modalEl.classList.add("hidden");
  state.editingId = null;
}

// 事件绑定
newPostBtn.addEventListener("click", () => openModal("new"));
editPostBtn.addEventListener("click", () => openModal("edit"));

deletePostBtn.addEventListener("click", async () => {
  const post = getActivePost();
  if (!post) return;
  const ok = confirm(`确定要删除《${post.title || "未命名文章"}》吗？`);
  if (!ok) return;
  try {
    await deletePostOnServer(post.id);
    state.posts = state.posts.filter((p) => p.id !== post.id);
    if (state.activeId === post.id) {
      state.activeId = state.posts[0]?.id ?? null;
    }
    renderAll();
  } catch (e) {
    console.error(e);
    alert("删除失败，请检查后端服务是否正常运行。");
  }
});

cancelBtn.addEventListener("click", () => closeModal());

modalEl.addEventListener("click", (e) => {
  if (e.target === modalEl || e.target.classList.contains("modal-backdrop")) {
    closeModal();
  }
});

saveBtn.addEventListener("click", async () => {
  const title = formTitleEl.value.trim();
  const body = formBodyEl.value.trim();

  if (!title && !body) {
    alert("请至少输入标题或内容。");
    return;
  }

  try {
    if (state.editingId) {
      const updated = await updatePostOnServer(state.editingId, {
        title,
        body,
      });
      // 以服务端返回的数据为准
      state.posts = state.posts.map((p) =>
        p.id === state.editingId ? updated : p
      );
      state.activeId = state.editingId;
    } else {
      const created = await createPostOnServer({ title, body });
      state.posts.push(created);
      state.activeId = created.id;
    }

    closeModal();
    renderAll();
  } catch (e) {
    console.error(e);
    alert("保存失败，请检查后端服务是否正常运行。");
  }
});

searchInput.addEventListener("input", () => renderList());

// 初始化
async function bootstrap() {
  try {
    const posts = await fetchPosts();
    // 兼容不同后端字段名：保证有 createdAt / updatedAt
    state.posts = (posts || []).map((p) => ({
      ...p,
      createdAt: p.createdAt || p.created_at || Date.now(),
      updatedAt: p.updatedAt || p.updated_at || p.createdAt || Date.now(),
    }));
    if (state.posts.length > 0) {
      // 默认选中最近更新的一篇
      state.posts.sort((a, b) => b.updatedAt - a.updatedAt);
      state.activeId = state.posts[0].id;
    }
  } catch (e) {
    console.error(e);
    alert("加载文章失败，请检查后端 API 是否可访问。");
    state.posts = [];
    state.activeId = null;
  }

  renderAll();
}

document.addEventListener("DOMContentLoaded", bootstrap);

