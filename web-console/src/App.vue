<template>
  <div class="page">
    <div class="header">
      <div class="title">任务列表</div>
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
      width="96vw"
      destroy-on-close
      class="data-posts-dialog"
    >
      <div v-loading="dataPostsLoading" class="data-posts-wrap">
        <div
          v-if="dataPostsGeneratedAt || dataPostsPlatformLabelsText"
          class="data-posts-meta"
        >
          <span v-if="dataPostsGeneratedAt">快照：{{ dataPostsGeneratedAt }}</span>
          <span v-if="dataPostsPlatformLabelsText">
            {{ dataPostsGeneratedAt ? " · " : "" }}{{ dataPostsPlatformLabelsText }}
          </span>
        </div>
        <div class="data-posts-filters">
          <el-select v-model="dataPostsStarFilter" placeholder="按星级筛选" style="width: 180px">
            <el-option label="全部星级" value="all" />
            <el-option label="5 星" :value="5" />
            <el-option label="4 星及以上" :value="4" />
            <el-option label="3 星及以上" :value="3" />
            <el-option label="2 星及以上" :value="2" />
            <el-option label="1 星及以上" :value="1" />
            <el-option label="仅 0 星" :value="0" />
          </el-select>
          <el-input
            v-model="dataPostsKeyword"
            clearable
            placeholder="文本筛选：标题/摘要/信号摘要/作者"
            style="max-width: 360px"
          />
          <span class="data-posts-filter-count">
            当前页筛选：{{ filteredDataPostsRows.length }} / {{ dataPostsRows.length }}
          </span>
        </div>
        <div v-if="filteredDataPostsRows.length" class="data-posts-cards">
          <el-card
            v-for="(row, idx) in filteredDataPostsRows"
            :key="row.id || row.href || `${row.title || 'post'}-${idx}`"
            class="data-post-card"
            shadow="hover"
          >
            <div class="data-post-card-head">
              <div class="data-post-title">
                {{ row.title || "（无标题）" }}
              </div>
              <el-link v-if="row.href" :href="row.href" target="_blank" type="primary">打开</el-link>
            </div>
            <div class="data-post-summary">
              <div class="data-post-signal">
                <span class="data-post-signal-label">交易信号</span>
                <span class="data-post-signal-stars">
                  {{ signalStarsText(getSignalStar(row)) }}
                </span>
                <span class="data-post-signal-score">
                  {{ getSignalStar(row) }}/5
                </span>
                <el-tag
                  size="small"
                  :type="signalTagType(getSignalStar(row))"
                  effect="plain"
                >
                  {{ signalTagText(getSignalStar(row)) }}
                </el-tag>
                <el-tag
                  size="small"
                  :type="isUsefulTagType(getUsefulValue(row))"
                  effect="light"
                >
                  {{ isUsefulTagText(getUsefulValue(row)) }}
                </el-tag>
              </div>
              <div class="data-post-signal-content" v-if="getSignalContent(row)">
                {{ truncateText(getSignalContent(row), 260) }}
              </div>
              <div class="data-post-raw">
                {{ truncateText(row.raw, 220) || "（暂无摘要）" }}
              </div>
              <div v-if="getImageUrls(row).length" class="data-post-images">
                <div
                  v-for="(imgUrl, imgIdx) in getImageUrls(row)"
                  :key="`${row.href || row.id || idx}-img-${imgIdx}`"
                  class="data-post-image-item"
                >
                  <img
                    class="data-post-thumb"
                    :src="imgUrl"
                    :alt="row.title || 'post image'"
                    loading="lazy"
                    decoding="async"
                    referrerpolicy="no-referrer"
                  />
                  <div class="data-post-image-popover">
                    <img
                      class="data-post-large"
                      :src="imgUrl"
                      :alt="row.title || 'post image preview'"
                      loading="lazy"
                      decoding="async"
                      referrerpolicy="no-referrer"
                    />
                  </div>
                </div>
              </div>
              <div
                v-if="getVideoUrl(row)"
                class="data-post-video"
                @contextmenu.prevent="openVideoContextMenu($event, row)"
                title="右键可操作：新页面打开 / 解析文字稿"
              >
                <div class="data-post-video-thumb">
                  <span class="data-post-video-icon">▶</span>
                </div>
                <div class="data-post-video-meta">
                  <div class="data-post-video-title">视频内容</div>
                  <div class="data-post-video-url">{{ truncateText(getVideoUrl(row), 120) }}</div>
                </div>
              </div>
            </div>
            <div class="data-post-foot">
              <span v-if="row.author">{{ row.author }}</span>
              <span v-if="row.category">{{ row.category }}</span>
              <span v-if="row.published_at">{{ row.published_at }}</span>
            </div>
          </el-card>
        </div>
        <el-empty v-else description="当前页暂无帖子数据" />
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

    <div
      v-if="videoMenuVisible"
      class="video-context-menu"
      :style="{ left: `${videoMenuX}px`, top: `${videoMenuY}px` }"
    >
      <button type="button" class="video-menu-item" @click="openVideoInNewTab">
        新页面打开
      </button>
      <button type="button" class="video-menu-item" @click="openVideoTranscript">
        解析文字稿
      </button>
    </div>
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
const dataPostsGeneratedAt = ref("");
const dataPostsPlatformLabels = ref(null);
const dataPostsStarFilter = ref("all");
const dataPostsKeyword = ref("");

const dataPostsPlatformLabelsText = computed(() => {
  const pl = dataPostsPlatformLabels.value;
  if (!pl || typeof pl !== "object") return "";
  return Object.entries(pl)
    .map(([k, v]) => `${k} → ${v}`)
    .join("  ·  ");
});

const dataPostsDialogTitle = computed(() => {
  const base = dataPostsCardName.value || "帖子列表";
  const v =
    dataPostsVersion.value !== null && dataPostsVersion.value !== undefined
      ? `（version ${dataPostsVersion.value}）`
      : "";
  return `${base} ${v}`.trim();
});

const filteredDataPostsRows = computed(() => {
  const rows = Array.isArray(dataPostsRows.value) ? dataPostsRows.value : [];
  const starFilter = dataPostsStarFilter.value;
  const kw = (dataPostsKeyword.value || "").trim().toLowerCase();
  return rows.filter((row) => {
    const star = getSignalStar(row);
    if (starFilter !== "all") {
      const f = Number(starFilter);
      if (f === 0) {
        if (star !== 0) return false;
      } else if (star < f) {
        return false;
      }
    }
    if (!kw) return true;
    const haystack = [
      row?.title,
      row?.raw,
      getSignalContent(row),
      row?.author,
      row?.category,
      row?.href,
    ]
      .map((x) => (x == null ? "" : String(x).toLowerCase()))
      .join("\n");
    return haystack.includes(kw);
  });
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
const videoMenuVisible = ref(false);
const videoMenuX = ref(0);
const videoMenuY = ref(0);
const videoMenuUrl = ref("");

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

function normalizeSignalStar(v) {
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(5, n));
}

function getSignalStar(row) {
  return normalizeSignalStar(row?.signal_star ?? row?.star);
}

function getSignalContent(row) {
  const v = row?.signal_content ?? row?.content;
  if (v == null) return "";
  return String(v);
}

function getUsefulValue(row) {
  const v = row?.is_useful ?? row?.isUseful ?? row?.isUseFul;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (!s) return null;
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return null;
}

function signalStarsText(star) {
  const n = normalizeSignalStar(star);
  if (n <= 0) return "☆☆☆☆☆";
  return `${"★".repeat(n)}${"☆".repeat(5 - n)}`;
}

function getImageUrls(row) {
  const list = row?.image_urls;
  if (!Array.isArray(list)) return [];
  return list
    .map((x) => (x == null ? "" : String(x).trim()))
    .filter((x) => x.startsWith("http://") || x.startsWith("https://"));
}

function getVideoUrl(row) {
  const v = row?.video_url ?? row?.videoUrl ?? row?.video;
  if (v == null) return "";
  const s = String(v).trim();
  if (!s) return "";
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  return "";
}

function closeVideoContextMenu() {
  videoMenuVisible.value = false;
  videoMenuUrl.value = "";
}

function openVideoContextMenu(evt, row) {
  const url = getVideoUrl(row);
  if (!url) return;
  videoMenuUrl.value = url;
  videoMenuX.value = evt.clientX;
  videoMenuY.value = evt.clientY;
  videoMenuVisible.value = true;
}

function openVideoInNewTab() {
  const url = videoMenuUrl.value;
  closeVideoContextMenu();
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

function openVideoTranscript() {
  const url = videoMenuUrl.value;
  closeVideoContextMenu();
  if (!url) return;
  const transcriptUrl = `https://www.txyz.ai/?url=${encodeURIComponent(url)}`;
  window.open(transcriptUrl, "_blank", "noopener,noreferrer");
}

function signalTagType(star) {
  const n = normalizeSignalStar(star);
  if (n >= 4) return "danger";
  if (n >= 2) return "warning";
  if (n >= 1) return "success";
  return "info";
}

function signalTagText(star) {
  const n = normalizeSignalStar(star);
  if (n >= 4) return "强信号";
  if (n >= 2) return "中信号";
  if (n >= 1) return "弱信号";
  return "无信号";
}

function isUsefulTagType(v) {
  if (v === true) return "success";
  if (v === false) return "info";
  return "warning";
}

function isUsefulTagText(v) {
  if (v === true) return "有用";
  if (v === false) return "一般";
  return "待判断";
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
      dataPostsGeneratedAt.value = "";
      dataPostsPlatformLabels.value = null;
      return;
    }
    dataPostsRows.value = data.items || [];
    dataPostsTotal.value = data.total ?? 0;
    dataPostsVersion.value = data.version ?? null;
    dataPostsGeneratedAt.value = data.generated_at || "";
    dataPostsPlatformLabels.value = data.platform_labels ?? null;
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

watch(dataPostsVisible, (v) => {
  if (!v) closeVideoContextMenu();
});

onMounted(() => {
  refreshAll();
  pollTimer = setInterval(() => loadCards(), 300000);
  window.addEventListener("click", closeVideoContextMenu);
  window.addEventListener("scroll", closeVideoContextMenu, true);
  window.addEventListener("resize", closeVideoContextMenu);
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
  if (eventSource.value) {
    eventSource.value.close();
    eventSource.value = null;
  }
  window.removeEventListener("click", closeVideoContextMenu);
  window.removeEventListener("scroll", closeVideoContextMenu, true);
  window.removeEventListener("resize", closeVideoContextMenu);
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
.data-posts-meta {
  margin-bottom: 10px;
  color: #606266;
  font-size: 13px;
  line-height: 1.5;
}
.data-posts-pager {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}
.data-posts-filters {
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.data-posts-filter-count {
  color: #909399;
  font-size: 12px;
}
.data-posts-cards {
  max-height: 72vh;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding-right: 4px;
}
.data-post-card {
  border-radius: 10px;
}
.data-post-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.data-post-title {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  font-weight: 600;
  color: #303133;
  line-height: 1.45;
}
.data-post-summary {
  color: #606266;
  font-size: 13px;
  line-height: 1.7;
  margin-bottom: 8px;
  white-space: pre-wrap;
  word-break: break-word;
}
.data-post-signal {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.data-post-signal-label {
  color: #909399;
}
.data-post-signal-stars {
  color: #e6a23c;
  letter-spacing: 1px;
  font-weight: 600;
}
.data-post-signal-score {
  color: #606266;
  font-size: 12px;
}
.data-post-signal-content {
  color: #303133;
  margin-bottom: 6px;
}
.data-post-raw {
  color: #606266;
}
.data-post-images {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.data-post-image-item {
  position: relative;
}
.data-post-thumb {
  width: 88px;
  height: 88px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid #ebeef5;
  cursor: zoom-in;
  background: #f5f7fa;
}
.data-post-image-popover {
  display: none;
  position: absolute;
  left: 0;
  top: 94px;
  z-index: 10;
  padding: 6px;
  border-radius: 10px;
  background: #fff;
  border: 1px solid #dcdfe6;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.15);
}
.data-post-image-item:hover .data-post-image-popover {
  display: block;
}
.data-post-large {
  display: block;
  width: min(420px, 65vw);
  max-height: 420px;
  object-fit: contain;
  border-radius: 8px;
  background: #f5f7fa;
}
.data-post-video {
  margin-top: 10px;
  padding: 8px;
  border: 1px dashed #dcdfe6;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: context-menu;
  background: #fafafa;
}
.data-post-video-thumb {
  width: 88px;
  height: 60px;
  border-radius: 8px;
  background: linear-gradient(135deg, #409eff 0%, #66b1ff 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
}
.data-post-video-icon {
  font-size: 22px;
  font-weight: 700;
}
.data-post-video-meta {
  min-width: 0;
  flex: 1;
}
.data-post-video-title {
  color: #303133;
  font-weight: 600;
  margin-bottom: 2px;
}
.data-post-video-url {
  color: #909399;
  font-size: 12px;
  word-break: break-all;
}
.video-context-menu {
  position: fixed;
  z-index: 3000;
  min-width: 150px;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  padding: 6px;
}
.video-menu-item {
  width: 100%;
  border: 0;
  background: transparent;
  text-align: left;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  color: #303133;
}
.video-menu-item:hover {
  background: #f5f7fa;
}
.data-post-foot {
  color: #909399;
  font-size: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
@media (max-width: 960px) {
  .data-posts-cards {
    grid-template-columns: 1fr;
  }
  .data-posts-filters {
    align-items: stretch;
  }
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
