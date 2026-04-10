<template>
  <div class="page">
    <div class="header">
      <div class="title">任务矩阵</div>
      <el-button type="primary" @click="refreshAll">刷新状态</el-button>
    </div>

    <el-tabs v-model="mainTab" class="main-tabs">
      <el-tab-pane label="脚本" name="scripts">
        <div class="grid">
          <el-card v-for="item in cards" :key="item.id" shadow="hover">
            <div class="card-title">
              <div class="name">
                <span>{{ item.icon }}</span>
                <span>{{ item.name }}</span>
              </div>
              <el-tag :type="statusType(item.status)">{{ statusText(item.status) }}</el-tag>
            </div>
            <div class="meta">上次运行: {{ item.last_run_time || "-" }}</div>
            <div class="meta">上次退出码: {{ item.last_exit_code ?? "-" }}</div>
            <div v-if="item.last_error" class="meta">错误: {{ item.last_error }}</div>
            <div class="meta">回调时间: {{ item.last_callback_time || "-" }}</div>
            <div class="meta" v-show="false">回调结果: {{ formatResult(item.last_callback_result) }}</div>
            <div style="margin-top: 8px" v-if="item.last_callback_result?.analysis">
              <el-button size="small" type="primary" @click="openMarkdownConfirm(item)">
                确认并编辑（Markdown）
              </el-button>
            </div>
            <div class="actions">
              <el-button size="small" type="primary" @click="runFetch(item)">立即执行</el-button>
              <el-button
                size="small"
                type="danger"
                :disabled="item.status !== 'running'"
                @click="stopTask(item)"
              >
                停止
              </el-button>
              <el-button size="small" @click="openSearch(item)">搜索</el-button>
              <el-button size="small" type="info" @click="openDrawer(item)">实时控制台</el-button>
            </div>
          </el-card>
        </div>
      </el-tab-pane>

      <el-tab-pane label="CDP" name="cdp">
        <div class="cdp-toolbar">
          <el-button type="primary" @click="loadCdpProfiles">刷新 CDP 配置</el-button>
        </div>
        <div v-if="cdpProfiles.length" class="grid">
          <el-card v-for="p in cdpProfiles" :key="p.id" shadow="hover">
            <div class="card-title">
              <div class="name">
                <span>🌐</span>
                <span>{{ p.name || p.id }}</span>
              </div>
              <el-tag type="info">{{ p.id }}</el-tag>
            </div>
            <div class="meta">调试端口: {{ p.remote_debugging_port ?? "-" }}</div>
            <div class="meta cdp-path">user-data-dir: {{ p.user_data_dir || "-" }}</div>
            <div class="meta cdp-path">chrome: {{ p.chrome_path || "-" }}</div>
            <div class="actions">
              <el-button
                size="small"
                type="warning"
                :loading="cdpLoadingId === p.id"
                @click="cdpKillAndStart(p)"
              >
                结束端口进程并启动 Chrome
              </el-button>
            </div>
          </el-card>
        </div>
        <el-empty v-else description="未配置 cdp_profiles，请在 config.yaml 顶层添加 cdp_profiles" />
      </el-tab-pane>

      <el-tab-pane label="数据" name="data">
        <div class="cdp-toolbar">
          <el-button type="primary" @click="loadDataViews">刷新数据视图</el-button>
        </div>
        <div v-if="dataViewItems.length" class="grid">
          <el-card v-for="d in dataViewItems" :key="d.id" shadow="hover">
            <div class="card-title">
              <div class="name">
                <span>📊</span>
                <span>{{ d.name }}</span>
              </div>
              <el-tag type="success">{{ d.id }}</el-tag>
            </div>
            <div class="meta">
              <strong>记录条数</strong> {{ d.record_count ?? "-" }} ｜
              <strong>已浏览</strong> {{ d.browsed_count ?? "-" }} ｜
              <strong>未读</strong> {{ d.unread_count ?? "-" }}
            </div>
            <div class="meta">文件更新时间: {{ d.file_mtime_iso || "-" }}</div>
            <div class="meta cdp-path">配置路径: {{ d.path || "-" }}</div>
            <div v-if="d.resolved_path" class="meta cdp-path">解析路径: {{ d.resolved_path }}</div>
            <div v-if="d.error" class="meta data-view-error">读取异常: {{ d.error }}</div>
            <div class="actions">
              <el-button
                size="small"
                type="success"
                :loading="dataViewBusyId === d.id"
                :disabled="!d.file_exists || !!d.error"
                @click="dataMarkAllSeen(d)"
              >
                全部标为已读
              </el-button>
              <el-button
                size="small"
                :loading="dataViewBusyId === d.id"
                :disabled="!d.file_exists || !!d.error"
                @click="dataSetBrowsed(d)"
              >
                设置已浏览条数
              </el-button>
              <el-button
                size="small"
                type="primary"
                :loading="dataPostsLoading && dataPostsViewId === d.id"
                :disabled="!d.file_exists || !!d.error"
                @click="openDataPosts(d)"
              >
                查看帖子
              </el-button>
            </div>
          </el-card>
        </div>
        <el-empty
          v-else
          description="未配置 data_views，请在 config.yaml 顶层添加 data_views（id / name / path）"
        />
      </el-tab-pane>
    </el-tabs>

    <el-dialog
      v-model="dataPostsVisible"
      :title="dataPostsDialogTitle"
      width="min(960px, 96vw)"
      destroy-on-close
      class="data-posts-dialog"
    >
      <div v-loading="dataPostsLoading" class="data-posts-wrap">
        <el-table :data="dataPostsRows" stripe border size="small" max-height="520">
          <el-table-column prop="_author_slug" label="作者" width="110" show-overflow-tooltip />
          <el-table-column prop="title" label="标题" min-width="200" show-overflow-tooltip />
          <el-table-column prop="published_at" label="发布时间" width="200" show-overflow-tooltip />
          <el-table-column label="链接" width="88">
            <template #default="{ row }">
              <el-link v-if="row.href" :href="row.href" target="_blank" type="primary">打开</el-link>
              <span v-else>-</span>
            </template>
          </el-table-column>
          <el-table-column prop="raw" label="正文摘要" min-width="160" show-overflow-tooltip>
            <template #default="{ row }">
              {{ truncateText(row.raw, 120) }}
            </template>
          </el-table-column>
        </el-table>
        <div class="data-posts-pager">
          <el-pagination
            v-model:current-page="dataPostsPage"
            v-model:page-size="dataPostsPageSize"
            :page-sizes="[20, 50, 100, 200]"
            layout="total, sizes, prev, pager, next"
            :total="dataPostsTotal"
            background
            @size-change="onDataPostsSizeChange"
            @current-change="loadDataPostsPage"
          />
        </div>
      </div>
    </el-dialog>

    <el-dialog v-model="searchDialogVisible" title="输入搜索关键字" width="420px">
      <el-input v-model="searchKeyword" placeholder="请输入 keyword" clearable />
      <template #footer>
        <el-button @click="searchDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmSearch">执行搜索</el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="drawerVisible" title="实时控制台" size="55%" direction="btt">
      <div class="meta">当前任务: {{ activeScriptName || "-" }}</div>
      <div style="display: flex; justify-content: flex-end; margin: 8px 0 6px">
        <el-button size="small" type="warning" @click="clearConsole">
          清空
        </el-button>
      </div>
      <div ref="consoleEl" class="console">{{ logText }}</div>
    </el-drawer>

    <el-dialog
      v-model="markdownDialogVisible"
      title="确认并发布到 Memos"
      width="720px"
    >
      <div style="margin-bottom: 10px; color: #606266; font-size: 13px">
        先点击「确认暂存」把当前 Markdown 保存到本地；再点击「发布到 Memos」写入云端。
      </div>
      <el-input
        v-model="markdownDraft"
        type="textarea"
        :autosize="{ minRows: 10, maxRows: 24 }"
      />
      <template #footer>
        <el-button @click="markdownDialogVisible = false">关闭</el-button>
        <el-button type="primary" @click="confirmDraft">确认暂存</el-button>
        <el-button type="success" @click="publishDraft">发布到 Memos</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted, nextTick, computed } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";

const mainTab = ref("scripts");
const cards = ref([]);
const cdpProfiles = ref([]);
const cdpLoadingId = ref("");
const dataViewItems = ref([]);
const dataViewBusyId = ref("");
const dataPostsVisible = ref(false);
const dataPostsViewId = ref("");
const dataPostsLoading = ref(false);
const dataPostsRows = ref([]);
const dataPostsTotal = ref(0);
const dataPostsVersion = ref(null);
const dataPostsPage = ref(1);
const dataPostsPageSize = ref(50);
const dataPostsCardName = ref("");

const dataPostsDialogTitle = computed(() => {
  const base = dataPostsCardName.value || "帖子列表";
  const v =
    dataPostsVersion.value !== null && dataPostsVersion.value !== undefined
      ? `（version ${dataPostsVersion.value}）`
      : "";
  return `${base} ${v}`.trim();
});

const searchDialogVisible = ref(false);
const searchKeyword = ref("");
const targetScript = ref(null);
const drawerVisible = ref(false);
const activeScriptName = ref("");
const activeScriptId = ref("");
const logText = ref("");
const consoleByScriptId = ref({});
const eventSource = ref(null);
const consoleEl = ref(null);

let pollTimer = null;

const markdownDialogVisible = ref(false);
const markdownDraft = ref("");
const markdownTargetId = ref("");

function draftKey(scriptId) {
  return `memo_draft:${scriptId}`;
}

function statusText(status) {
  const m = { online: "在线", running: "运行中", error: "异常" };
  return m[status] || status;
}

function statusType(status) {
  const m = { online: "success", running: "warning", error: "danger" };
  return m[status] || "info";
}

function formatResult(result) {
  if (result === null || result === undefined) return "-";
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

async function loadCards() {
  const res = await fetch("/api/scripts");
  const data = await res.json();
  cards.value = data.items || [];
}

async function loadCdpProfiles() {
  const res = await fetch("/api/cdp/profiles");
  const data = await res.json();
  cdpProfiles.value = data.items || [];
}

async function loadDataViews() {
  const res = await fetch("/api/data-views");
  const data = await res.json();
  dataViewItems.value = data.items || [];
}

function refreshAll() {
  loadCards();
  loadCdpProfiles();
  loadDataViews();
}

async function dataMarkAllSeen(item) {
  if (!item?.id) return;
  dataViewBusyId.value = item.id;
  try {
    const res = await fetch(`/api/data-views/${item.id}/browsed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mark_all_seen: true }),
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      // ignore
    }
    if (!res.ok) {
      ElMessage.error(data?.detail || "设置失败");
      return;
    }
    ElMessage.success("已同步为全部已读");
    await loadDataViews();
  } finally {
    dataViewBusyId.value = "";
  }
}

async function dataSetBrowsed(item) {
  if (!item?.id) return;
  try {
    const { value } = await ElMessageBox.prompt("请输入已浏览条数（非负整数）", "设置已浏览", {
      confirmButtonText: "确定",
      cancelButtonText: "取消",
      inputValue: String(item.browsed_count ?? 0),
      inputPattern: /^\d+$/,
      inputErrorMessage: "请输入非负整数",
    });
    const n = parseInt(value, 10);
    dataViewBusyId.value = item.id;
    const res = await fetch(`/api/data-views/${item.id}/browsed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ browsed_count: n }),
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      // ignore
    }
    if (!res.ok) {
      ElMessage.error(data?.detail || "设置失败");
      return;
    }
    ElMessage.success("已更新已浏览条数");
    await loadDataViews();
  } catch (e) {
    if (e !== "cancel") {
      /* 用户取消不提示 */
    }
  } finally {
    dataViewBusyId.value = "";
  }
}

function truncateText(s, n) {
  if (s == null || s === "") return "-";
  const str = String(s);
  return str.length <= n ? str : `${str.slice(0, n)}…`;
}

async function openDataPosts(d) {
  if (!d?.id) return;
  dataPostsViewId.value = d.id;
  dataPostsCardName.value = d.name || d.id;
  dataPostsPage.value = 1;
  dataPostsVisible.value = true;
  await loadDataPostsPage();
}

async function loadDataPostsPage() {
  const id = dataPostsViewId.value;
  if (!id) return;
  dataPostsLoading.value = true;
  try {
    const offset = (dataPostsPage.value - 1) * dataPostsPageSize.value;
    const res = await fetch(
      `/api/data-views/${encodeURIComponent(id)}/posts?limit=${dataPostsPageSize.value}&offset=${offset}`
    );
    let data = null;
    try {
      data = await res.json();
    } catch {
      // ignore
    }
    if (!res.ok) {
      ElMessage.error(data?.detail || "加载失败");
      dataPostsRows.value = [];
      dataPostsTotal.value = 0;
      dataPostsVersion.value = null;
      return;
    }
    dataPostsRows.value = data.items || [];
    dataPostsTotal.value = data.total ?? 0;
    dataPostsVersion.value = data.version ?? null;
  } finally {
    dataPostsLoading.value = false;
  }
}

async function onDataPostsSizeChange() {
  dataPostsPage.value = 1;
  await loadDataPostsPage();
}

async function cdpKillAndStart(p) {
  if (!p?.id) return;
  cdpLoadingId.value = p.id;
  try {
    const res = await fetch("/api/cdp/restart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile_id: p.id }),
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      // ignore
    }
    if (!res.ok) {
      const msg = data?.detail || data?.message || res.statusText || "request failed";
      ElMessage.error(`CDP 操作失败：${msg}`);
      return;
    }
    const logs = (data?.logs || []).join("\n");
    const cmd = Array.isArray(data?.command) ? data.command.join(" ") : "";
    await ElMessageBox.alert(
      `${logs || "完成"}\n\n命令：${cmd || "-"}`,
      `已执行：${p.name || p.id}`,
      { confirmButtonText: "确定" }
    );
    ElMessage.success("CDP：已结束端口进程并尝试启动 Chrome");
  } finally {
    cdpLoadingId.value = "";
  }
}

async function runFetch(item) {
  await fetch(`/api/scripts/${item.id}/fetch`, { method: "POST" });
  openDrawer(item);
  loadCards();
}

async function stopTask(item) {
  await fetch(`/api/scripts/${item.id}/stop`, { method: "POST" });
  openDrawer(item);
  loadCards();
}

function openSearch(item) {
  targetScript.value = item;
  searchKeyword.value = "";
  searchDialogVisible.value = true;
}

async function confirmSearch() {
  if (!targetScript.value) return;
  await fetch(`/api/scripts/${targetScript.value.id}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keyword: searchKeyword.value }),
  });
  searchDialogVisible.value = false;
  openDrawer(targetScript.value);
  loadCards();
}

function openMarkdownConfirm(item) {
  markdownTargetId.value = item.id;
  const analysis = item?.last_callback_result?.analysis;
  const content =
    analysis && typeof analysis === "string" ? analysis : formatResult(item.last_callback_result);

  // 若之前已确认暂存，则优先加载已暂存版本
  const saved = localStorage.getItem(draftKey(item.id));
  markdownDraft.value = saved ? saved : content || "";
  markdownDialogVisible.value = true;
}

function confirmDraft() {
  if (!markdownTargetId.value) return;
  localStorage.setItem(draftKey(markdownTargetId.value), markdownDraft.value || "");
  ElMessage.success("已确认暂存到本地");
}

async function publishDraft() {
  const scriptId = markdownTargetId.value;
  if (!scriptId) return;
  const saved = localStorage.getItem(draftKey(scriptId));
  if (!saved) {
    ElMessage.warning("请先点击「确认暂存」后再发布");
    return;
  }

  const res = await fetch(`/api/scripts/${scriptId}/sync-memos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: saved, visibility: "PRIVATE" }),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // ignore
  }
  if (!res.ok) {
    const msg = data?.detail || data?.message || res.statusText || "request failed";
    ElMessage.error(`发布到 Memos 失败：${msg}`);
    return;
  }
  const memoName =
    data?.memo?.name || data?.memo?.uid || data?.memo?.id || data?.memo?.title;
  ElMessage.success(`发布到 Memos 成功${memoName ? `：${memoName}` : ""}`);
  markdownDialogVisible.value = false;
  loadCards();
}

function openDrawer(item) {
  drawerVisible.value = true;
  activeScriptName.value = item.name;
  activeScriptId.value = item.id;
  if (!consoleByScriptId.value[item.id]) consoleByScriptId.value[item.id] = "";
  logText.value = consoleByScriptId.value[item.id];
  bindLogStream(item.id);
}

function bindLogStream(scriptId) {
  if (eventSource.value) {
    eventSource.value.close();
    eventSource.value = null;
  }
  const es = new EventSource(`/api/scripts/${scriptId}/logs`);
  eventSource.value = es;
  es.onmessage = (e) => {
    logText.value += `${e.data}\n`;
    consoleByScriptId.value[scriptId] = logText.value;
    nextTick(() => {
      const el = consoleEl.value;
      if (el) el.scrollTop = el.scrollHeight;
    });
  };
}

async function clearConsole() {
  const sid = activeScriptId.value;
  if (!sid) return;
  // 清空服务端 stdout 队列，避免清空后又立刻回灌旧日志
  try {
    await fetch(`/api/scripts/${sid}/clear-logs`, { method: "POST" });
  } catch (e) {
    // 忽略：前端也会清空显示内容
  }
  consoleByScriptId.value[sid] = "";
  logText.value = "";
}

watch(drawerVisible, (v) => {
  if (!v && eventSource.value) {
    eventSource.value.close();
    eventSource.value = null;
  }
});

onMounted(() => {
  refreshAll();
  pollTimer = setInterval(() => loadCards(), 300000);
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
  if (eventSource.value) {
    eventSource.value.close();
    eventSource.value = null;
  }
});
</script>

<style scoped>
.page {
  padding: 20px;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.main-tabs {
  margin-top: 4px;
}
.main-tabs :deep(.el-tabs__header) {
  margin-bottom: 14px;
}
.cdp-toolbar {
  margin-bottom: 12px;
}
.cdp-path {
  word-break: break-all;
}
.data-view-error {
  color: #f56c6c;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 14px;
}
.title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 20px;
  font-weight: 600;
}
.meta {
  color: #606266;
  font-size: 13px;
  margin-top: 8px;
}
.actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
}
.console {
  white-space: pre-wrap;
  background: #101014;
  color: #e4e7ed;
  border-radius: 6px;
  padding: 12px;
  max-height: calc(60vh - 180px);
  overflow-y: auto;
  font-family: Consolas, "Courier New", monospace;
  font-size: 12px;
}
.card-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}
</style>

<style>
body {
  margin: 0;
  background: #f5f7fa;
  font-family:
    Inter,
    "PingFang SC",
    "Microsoft YaHei",
    sans-serif;
}
</style>
