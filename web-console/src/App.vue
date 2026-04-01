<template>
  <div class="page">
    <div class="header">
      <div class="title">任务矩阵</div>
      <el-button type="primary" @click="loadCards">刷新状态</el-button>
    </div>

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
        <div class="meta">回调结果: {{ formatResult(item.last_callback_result) }}</div>
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
          <el-button size="small" type="success" @click="syncMemos(item)">同步到 Memos</el-button>
          <el-button size="small" type="info" @click="openDrawer(item)">实时控制台</el-button>
        </div>
      </el-card>
    </div>

    <el-dialog v-model="searchDialogVisible" title="输入搜索关键字" width="420px">
      <el-input v-model="searchKeyword" placeholder="请输入 keyword" clearable />
      <template #footer>
        <el-button @click="searchDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmSearch">执行搜索</el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="drawerVisible" title="实时控制台" size="55%" direction="btt">
      <div class="meta">当前任务: {{ activeScriptName || "-" }}</div>
      <div ref="consoleEl" class="console">{{ logText }}</div>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted, nextTick } from "vue";

const cards = ref([]);
const searchDialogVisible = ref(false);
const searchKeyword = ref("");
const targetScript = ref(null);
const drawerVisible = ref(false);
const activeScriptName = ref("");
const logText = ref("");
const eventSource = ref(null);
const consoleEl = ref(null);

let pollTimer = null;

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

async function syncMemos(item) {
  const content = `${item.name} @ ${new Date().toLocaleString()}`;
  await fetch(`/api/scripts/${item.id}/sync-memos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  openDrawer(item);
  loadCards();
}

function openDrawer(item) {
  drawerVisible.value = true;
  activeScriptName.value = item.name;
  logText.value = "";
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
    nextTick(() => {
      const el = consoleEl.value;
      if (el) el.scrollTop = el.scrollHeight;
    });
  };
}

watch(drawerVisible, (v) => {
  if (!v && eventSource.value) {
    eventSource.value.close();
    eventSource.value = null;
  }
});

onMounted(() => {
  loadCards();
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
  margin-bottom: 16px;
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
