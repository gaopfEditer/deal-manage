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

      <el-tab-pane label="发布" name="publish">
        <div class="publish-layout">
          <div class="publish-main">
            <div class="publish-toolbar">
              <el-select v-model="publishPlatform" placeholder="发布平台" style="width: 200px">
                <el-option
                  v-for="p in publishPlatforms"
                  :key="p.id"
                  :label="p.name"
                  :value="p.id"
                  :disabled="!p.enabled && p.method === 'api'"
                />
              </el-select>
              <el-tag v-if="publishPlatformMeta" :type="publishPlatformTagType" size="small">
                {{ publishPlatformMeta.method === "cdp" ? "CDP（待接入）" : "OpenAPI" }}
              </el-tag>
              <span v-if="publishPlatformMeta?.api_key_masked" class="publish-key-hint">
                Key: {{ publishPlatformMeta.api_key_masked }}
              </span>
              <el-button type="primary" :loading="publishPolishLoading" @click="publishPolish">
                AI 润色预览
              </el-button>
              <el-button
                type="success"
                :loading="publishSubmitLoading"
                :disabled="!canPublishNow"
                @click="publishSubmit"
              >
                发布
              </el-button>
              <el-button @click="loadPublishHistory">刷新历史</el-button>
            </div>

            <el-card shadow="never" class="publish-prompt-card">
              <template #header>Prompt 模块（风格外壳 + 策略内核）</template>
              <div class="publish-prompt-row">
                <span class="publish-prompt-label">组合方式</span>
                <el-radio-group v-model="publishComposeMode" size="small">
                  <el-radio-button value="manual">手动选择</el-radio-button>
                  <el-radio-button value="auto">自动路由组合</el-radio-button>
                </el-radio-group>
              </div>
              <div v-if="publishComposeMode === 'manual'" class="publish-prompt-row publish-prompt-pickers">
                <el-select
                  v-model="publishStyleId"
                  clearable
                  filterable
                  placeholder="叙事风格（可选）"
                  style="width: 240px"
                >
                  <el-option
                    v-for="s in publishPromptStyles"
                    :key="s.id"
                    :label="s.name"
                    :value="s.id"
                  >
                    <div class="publish-prompt-option">
                      <span>{{ s.name }}</span>
                      <span class="publish-prompt-option-desc">{{ s.description }}</span>
                    </div>
                  </el-option>
                </el-select>
                <el-select
                  v-model="publishStrategyId"
                  clearable
                  filterable
                  placeholder="交易策略（可选）"
                  style="width: 240px"
                >
                  <el-option
                    v-for="s in publishPromptStrategies"
                    :key="s.id"
                    :label="s.name"
                    :value="s.id"
                  >
                    <div class="publish-prompt-option">
                      <span>{{ s.name }}</span>
                      <span class="publish-prompt-option-desc">{{ s.description }}</span>
                    </div>
                  </el-option>
                </el-select>
              </div>
              <div v-else class="publish-prompt-auto-hint">
                {{ publishRouterHint }}
              </div>
              <div v-if="publishLastSelectionText" class="publish-prompt-selection">
                {{ publishLastSelectionText }}
              </div>
            </el-card>

            <el-card shadow="never" class="publish-editor-card">
              <template #header>原文</template>
              <el-input
                v-model="publishDraftOriginal"
                type="textarea"
                :rows="6"
                placeholder="输入待发布正文…"
                maxlength="8000"
                show-word-limit
              />
            </el-card>

            <el-card shadow="never" class="publish-editor-card">
              <template #header>
                <span>润色 / 发布预览</span>
                <el-checkbox v-model="publishUseAi" style="margin-left: 12px" label="发布时再 AI 润色" />
              </template>
              <div class="publish-preview-meta">
                <el-checkbox v-model="publishIsSign" label="文末署名 (isSign)" />
                <span class="publish-star-label">质量星级</span>
                <el-rate v-model="publishStar" :max="5" />
                <span class="publish-star-num">{{ publishStar }}/5</span>
              </div>
              <el-input
                v-model="publishDraftFinal"
                type="textarea"
                :rows="10"
                placeholder="点击「AI 润色预览」生成，也可直接编辑后发布"
                maxlength="8000"
                show-word-limit
              />
              <div v-if="publishPolishModel" class="publish-model-hint">
                润色模型: {{ publishPolishModel }}
              </div>
            </el-card>

            <el-card v-if="publishPreviewCardVisible" shadow="never" class="publish-preview-card">
              <template #header>发布前预览</template>
              <div class="publish-preview-body">{{ publishPreviewText }}</div>
            </el-card>
          </div>

          <div class="publish-side">
            <div class="publish-side-title">发布历史</div>
            <div v-loading="publishHistoryLoading" class="publish-history-list">
              <el-empty v-if="!publishHistory.length" description="暂无发布记录" />
              <el-card
                v-for="h in publishHistory"
                :key="h.id"
                class="publish-history-item"
                shadow="hover"
                @click="applyPublishHistory(h)"
              >
                <div class="publish-history-head">
                  <el-tag :type="publishHistoryStatusType(h.status)" size="small">
                    {{ publishHistoryStatusText(h.status) }}
                  </el-tag>
                  <span class="publish-history-time">{{ h.created_at }}</span>
                </div>
                <div class="publish-history-platform">{{ h.platform_name || h.platform }}</div>
                <div class="publish-history-snippet">
                  {{ truncateText(h.published_content || h.original_content, 120) }}
                </div>
                <el-link
                  v-if="h.post_url"
                  type="primary"
                  :href="h.post_url"
                  target="_blank"
                  rel="noopener"
                  @click.stop
                >
                  查看帖子
                </el-link>
                <div v-if="h.error" class="publish-history-error">{{ h.error }}</div>
              </el-card>
            </div>
          </div>
        </div>
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
          <el-select
            v-if="isBinancePostsDataView && dataPostsGroupKeys.length"
            v-model="currentDataPostsBinanceAuthor"
            clearable
            filterable
            placeholder="按文件 posts 顶层键筛选"
            style="width: 220px"
          >
            <el-option label="全部键" value="" />
            <el-option v-for="k in dataPostsGroupKeys" :key="k" :label="k" :value="k" />
          </el-select>
          <el-select v-model="currentDataPostsStarFilter" placeholder="按星级筛选" style="width: 180px">
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
            :key="getPostRowKey(row, idx)"
            class="data-post-card"
            shadow="hover"
          >
            <div class="data-post-card-head">
              <div class="data-post-title-wrap">
                <el-tooltip
                  :disabled="!getPostSummary(row)"
                  :content="getPostSummary(row)"
                  placement="top"
                  :show-after="350"
                  popper-class="data-post-summary-tooltip"
                >
                  <div class="data-post-title">
                    {{ row.title || "（无标题）" }}
                  </div>
                </el-tooltip>
              </div>
              <el-link
                v-if="getPostOpenUrl(row)"
                type="primary"
                @click.prevent="openPostInNewTab(row)"
              >
                打开
              </el-link>
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
              <div v-if="getSignalContent(row)" class="data-post-signal-content-wrap">
                <el-tooltip
                  :content="getSignalContent(row)"
                  placement="top"
                  :show-after="300"
                  popper-class="data-post-signal-tooltip"
                >
                  <div class="data-post-signal-content">
                    {{ getSignalContent(row) }}
                  </div>
                </el-tooltip>
              </div>
              <div v-if="getImageUrls(row).length" class="data-post-images">
                <div
                  v-for="(imgUrl, imgIdx) in getImageUrls(row)"
                  :key="`${getPostRowKey(row, idx)}-img-${imgIdx}`"
                  class="data-post-image-item"
                >
                  <button
                    type="button"
                    class="data-post-thumb-btn"
                    :title="row.title || '点击查看大图'"
                    @click="openImagePreview(imgUrl, row.title || 'post image')"
                  >
                    <img
                      class="data-post-thumb"
                      :src="imgUrl"
                      :alt="row.title || 'post image'"
                      loading="lazy"
                      decoding="async"
                      referrerpolicy="no-referrer"
                    />
                  </button>
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
      <div class="markdown-hint">
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

    <el-dialog
      v-model="imagePreviewVisible"
      title="查看大图"
      width="min(96vw, 1120px)"
      class="image-preview-dialog"
      append-to-body
      destroy-on-close
      @closed="onImagePreviewClosed"
    >
      <div class="image-preview-toolbar">
        <el-button-group>
          <el-button size="small" @click="imagePreviewZoomOut">缩小</el-button>
          <el-button size="small" @click="imagePreviewZoomIn">放大</el-button>
          <el-button size="small" @click="imagePreviewZoomReset">复位</el-button>
        </el-button-group>
        <span class="image-preview-zoom-pct">{{ Math.round(imagePreviewScale * 100) }}%</span>
        <span class="image-preview-hint">滚轮缩放 · 拖拽平移 · 双击复位</span>
      </div>
      <div class="image-preview-stage" @wheel.prevent="onImagePreviewWheel">
        <div
          class="image-preview-pan-layer"
          :class="{ 'is-panning': imagePreviewPanning }"
          :style="imagePreviewLayerStyle"
          @mousedown="onImagePreviewMouseDown"
        >
          <img
            class="image-preview-fullimg"
            :src="imagePreviewUrl"
            :alt="imagePreviewAlt"
            draggable="false"
            referrerpolicy="no-referrer"
            @dblclick.prevent="imagePreviewZoomReset"
          />
        </div>
      </div>
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
/** 与 config data_views[].id 一致：币安状态文件为 posts 嵌套 dict 结构 */
const BINANCE_POSTS_VIEW_ID = "binance-posts-state";
const dataPostsStarFilterByView = ref({});
const dataPostsBinanceAuthorByView = ref({});
const dataPostsGroupKeys = ref([]);
const dataPostsKeyword = ref("");

const imagePreviewVisible = ref(false);
const imagePreviewUrl = ref("");
const imagePreviewAlt = ref("");
const imagePreviewScale = ref(1);
const imagePreviewTx = ref(0);
const imagePreviewTy = ref(0);
const imagePreviewPanning = ref(false);
const imagePreviewPanStart = ref({ x: 0, y: 0, tx: 0, ty: 0 });

const imagePreviewLayerStyle = computed(() => ({
  transform: `translate(${imagePreviewTx.value}px, ${imagePreviewTy.value}px) scale(${imagePreviewScale.value})`,
  transformOrigin: "center center",
}));

function openImagePreview(url, alt) {
  imagePreviewUrl.value = url;
  imagePreviewAlt.value = alt || "image";
  imagePreviewScale.value = 1;
  imagePreviewTx.value = 0;
  imagePreviewTy.value = 0;
  imagePreviewVisible.value = true;
}

function imagePreviewZoomIn() {
  imagePreviewScale.value = Math.min(6, Math.round(imagePreviewScale.value * 1.15 * 1000) / 1000);
}

function imagePreviewZoomOut() {
  imagePreviewScale.value = Math.max(0.15, Math.round((imagePreviewScale.value / 1.15) * 1000) / 1000);
}

function imagePreviewZoomReset() {
  imagePreviewScale.value = 1;
  imagePreviewTx.value = 0;
  imagePreviewTy.value = 0;
}

function onImagePreviewWheel(e) {
  const factor = e.deltaY > 0 ? 1 / 1.12 : 1.12;
  let next = imagePreviewScale.value * factor;
  next = Math.max(0.15, Math.min(6, Math.round(next * 1000) / 1000));
  imagePreviewScale.value = next;
}

function detachImagePreviewPanListeners() {
  imagePreviewPanning.value = false;
  window.removeEventListener("mousemove", onImagePreviewMouseMove);
  window.removeEventListener("mouseup", onImagePreviewMouseUp);
}

function onImagePreviewMouseDown(e) {
  if (e.button !== 0) return;
  e.preventDefault();
  imagePreviewPanning.value = true;
  imagePreviewPanStart.value = {
    x: e.clientX,
    y: e.clientY,
    tx: imagePreviewTx.value,
    ty: imagePreviewTy.value,
  };
  window.addEventListener("mousemove", onImagePreviewMouseMove);
  window.addEventListener("mouseup", onImagePreviewMouseUp);
}

function onImagePreviewMouseMove(e) {
  if (!imagePreviewPanning.value) return;
  const s = imagePreviewPanStart.value;
  imagePreviewTx.value = s.tx + (e.clientX - s.x);
  imagePreviewTy.value = s.ty + (e.clientY - s.y);
}

function onImagePreviewMouseUp() {
  detachImagePreviewPanListeners();
}

function onImagePreviewClosed() {
  detachImagePreviewPanListeners();
  imagePreviewZoomReset();
  imagePreviewUrl.value = "";
  imagePreviewAlt.value = "";
}

const publishPlatforms = ref([]);
const publishPlatform = ref("binance_square");
const publishDraftOriginal = ref("");
const publishDraftFinal = ref("");
const publishIsSign = ref(false);
const publishStar = ref(0);
const publishUseAi = ref(false);
const publishPolished = ref(null);
const publishPolishModel = ref("");
const publishPolishLoading = ref(false);
const publishSubmitLoading = ref(false);
const publishHistory = ref([]);
const publishHistoryLoading = ref(false);
const publishShowPreviewCard = ref(false);
const publishComposeMode = ref("manual");
const publishStyleId = ref("");
const publishStrategyId = ref("");
const publishPromptStyles = ref([]);
const publishPromptStrategies = ref([]);
const publishRouterMeta = ref(null);
const publishLastSelection = ref(null);

const publishRouterHint = computed(() => {
  const r = publishRouterMeta.value;
  if (r?.description) return r.description;
  return "AI 将分析原文，自动匹配叙事风格与交易策略内核并融合输出。";
});

const publishLastSelectionText = computed(() => {
  const sel = publishLastSelection.value;
  if (!sel) return "";
  if (sel.compose_mode === "auto") {
    const m = sel.ai_meta || {};
    const style = publishPromptName(m.style, "styles") || m.style || "—";
    const strategy = publishPromptName(m.strategy, "strategies") || m.strategy || "—";
    return `上次自动组合：风格「${style}」+ 策略「${strategy}」`;
  }
  const parts = [];
  if (sel.style) parts.push(`风格「${publishPromptName(sel.style, "styles")}」`);
  if (sel.strategy) parts.push(`策略「${publishPromptName(sel.strategy, "strategies")}」`);
  return parts.length ? `上次选用：${parts.join(" + ")}` : "";
});

function publishPromptName(id, kind) {
  if (!id) return "";
  const list = kind === "styles" ? publishPromptStyles.value : publishPromptStrategies.value;
  const found = list.find((x) => x.id === id);
  return found?.name || id;
}

const publishPlatformMeta = computed(() =>
  publishPlatforms.value.find((p) => p.id === publishPlatform.value)
);

const publishPlatformTagType = computed(() => {
  const m = publishPlatformMeta.value;
  if (!m) return "info";
  if (m.method === "cdp") return "warning";
  return m.enabled ? "success" : "danger";
});

const publishPreviewText = computed(() => (publishDraftFinal.value || publishDraftOriginal.value || "").trim());

const publishPreviewCardVisible = computed(
  () => publishShowPreviewCard.value && !!publishPreviewText.value
);

const canPublishNow = computed(() => {
  const text = publishPreviewText.value;
  if (!text) return false;
  const p = publishPlatformMeta.value;
  if (!p) return false;
  if (p.method === "cdp") return false;
  return !!p.enabled;
});

async function loadPublishPrompts() {
  try {
    const res = await fetch("/api/publish/prompts");
    const data = await res.json();
    publishPromptStyles.value = data.styles || [];
    publishPromptStrategies.value = data.strategies || [];
    publishRouterMeta.value = data.router || null;
  } catch {
    publishPromptStyles.value = [];
    publishPromptStrategies.value = [];
    publishRouterMeta.value = null;
  }
}

async function loadPublishPlatforms() {
  try {
    const res = await fetch("/api/publish/platforms");
    const data = await res.json();
    publishPlatforms.value = data.items || [];
    if (!publishPlatforms.value.some((p) => p.id === publishPlatform.value)) {
      const first = publishPlatforms.value.find((p) => p.enabled) || publishPlatforms.value[0];
      if (first) publishPlatform.value = first.id;
    }
  } catch {
    publishPlatforms.value = [];
  }
}

async function loadPublishHistory() {
  publishHistoryLoading.value = true;
  try {
    const q = new URLSearchParams({ limit: "50", offset: "0" });
    if (publishPlatform.value) q.set("platform", publishPlatform.value);
    const res = await fetch(`/api/publish/history?${q}`);
    const data = await res.json();
    publishHistory.value = data.items || [];
  } catch {
    publishHistory.value = [];
  } finally {
    publishHistoryLoading.value = false;
  }
}

function applyPolishResult(polished, model, promptSelection) {
  if (!polished || typeof polished !== "object") return;
  publishPolished.value = polished;
  publishDraftFinal.value = String(polished.content || "").trim();
  publishIsSign.value = !!polished.isSign;
  const s = Number(polished.star);
  publishStar.value = Number.isFinite(s) ? Math.max(0, Math.min(5, s)) : 0;
  if (model) publishPolishModel.value = model;
  publishShowPreviewCard.value = true;
  if (promptSelection) {
    publishLastSelection.value = {
      compose_mode: promptSelection.compose_mode,
      style: promptSelection.style,
      strategy: promptSelection.strategy,
      ai_meta: polished.meta || null,
    };
    if (promptSelection.compose_mode === "auto" && polished.meta) {
      if (polished.meta.style) publishStyleId.value = polished.meta.style;
      if (polished.meta.strategy) publishStrategyId.value = polished.meta.strategy;
    }
  }
}

async function publishPolish() {
  const raw = publishDraftOriginal.value.trim();
  if (!raw) {
    ElMessage.warning("请先输入原文");
    return;
  }
  publishPolishLoading.value = true;
  try {
    const res = await fetch("/api/publish/polish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: raw,
        is_sign: publishIsSign.value,
        compose_mode: publishComposeMode.value,
        style_id: publishComposeMode.value === "manual" ? publishStyleId.value || null : null,
        strategy_id:
          publishComposeMode.value === "manual" ? publishStrategyId.value || null : null,
      }),
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      // ignore
    }
    if (!res.ok) {
      ElMessage.error(data?.detail || res.statusText || "润色失败");
      return;
    }
    applyPolishResult(data.polished, data.model, data.prompt_selection);
    ElMessage.success("AI 润色完成，可在下方编辑后发布");
  } finally {
    publishPolishLoading.value = false;
  }
}

async function publishSubmit() {
  const original = publishDraftOriginal.value.trim();
  const finalText = publishDraftFinal.value.trim() || original;
  if (!finalText) {
    ElMessage.warning("发布内容不能为空");
    return;
  }
  try {
    await ElMessageBox.confirm(
      `确认发布到「${publishPlatformMeta.value?.name || publishPlatform.value}」？\n\n${truncateText(finalText, 200)}`,
      "确认发布",
      { confirmButtonText: "发布", cancelButtonText: "取消", type: "warning" }
    );
  } catch {
    return;
  }

  publishSubmitLoading.value = true;
  try {
    const body = {
      platform: publishPlatform.value,
      content: original || finalText,
      final_content: finalText,
      is_sign: publishIsSign.value,
      use_ai: publishUseAi.value,
    };
    if (publishPolished.value && !publishUseAi.value) {
      body.polished = {
        ...publishPolished.value,
        content: finalText,
        isSign: publishIsSign.value,
        star: publishStar.value,
      };
      body.use_ai = false;
    }
    const res = await fetch("/api/publish/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      // ignore
    }
    if (!res.ok) {
      ElMessage.error(data?.detail || res.statusText || "发布失败");
      await loadPublishHistory();
      return;
    }
    const item = data.item || {};
    ElMessage.success(item.post_url ? `发布成功：${item.post_url}` : "发布成功");
    publishShowPreviewCard.value = true;
    await loadPublishHistory();
  } finally {
    publishSubmitLoading.value = false;
  }
}

function applyPublishHistory(h) {
  if (!h) return;
  publishDraftOriginal.value = h.original_content || "";
  publishDraftFinal.value = h.published_content || h.original_content || "";
  if (h.polished && typeof h.polished === "object") {
    applyPolishResult(h.polished, "");
  }
  publishShowPreviewCard.value = true;
}

function publishHistoryStatusType(status) {
  if (status === "published") return "success";
  if (status === "failed") return "danger";
  return "info";
}

function publishHistoryStatusText(status) {
  if (status === "published") return "已发布";
  if (status === "failed") return "失败";
  if (status === "pending") return "处理中";
  return status || "-";
}

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

const isBinancePostsDataView = computed(
  () => dataPostsViewId.value === BINANCE_POSTS_VIEW_ID
);

const currentDataPostsStarFilter = computed({
  get() {
    const id = dataPostsViewId.value;
    if (!id) return "all";
    return dataPostsStarFilterByView.value[id] ?? "all";
  },
  set(v) {
    const id = dataPostsViewId.value;
    if (!id) return;
    dataPostsStarFilterByView.value = { ...dataPostsStarFilterByView.value, [id]: v };
  },
});

const currentDataPostsBinanceAuthor = computed({
  get() {
    const id = dataPostsViewId.value;
    if (!id) return "";
    return dataPostsBinanceAuthorByView.value[id] ?? "";
  },
  set(v) {
    const id = dataPostsViewId.value;
    if (!id) return;
    dataPostsBinanceAuthorByView.value = {
      ...dataPostsBinanceAuthorByView.value,
      [id]: v == null || v === "" ? "" : String(v),
    };
  },
});

/** 打开帖子的 URL：优先嵌套 posts 的外层 URL 键，其次帖子自身 href */
function resolvePostOpenUrl(row) {
  if (!row) return "";
  const isHttpUrl = (s) => s.startsWith("http://") || s.startsWith("https://");
  const candidates = [row._url_key, row.href];
  for (const v of candidates) {
    if (v == null) continue;
    const t = String(v).trim();
    if (isHttpUrl(t)) return t;
  }
  for (const k of ["HREF", "URL", "LINK"]) {
    const v = row[k];
    if (v == null) continue;
    const t = String(v).trim();
    if (isHttpUrl(t)) return t;
  }
  return "";
}

function normalizePostRow(raw) {
  const row = raw && typeof raw === "object" ? { ...raw } : {};
  row._open_url = resolvePostOpenUrl(row);
  return row;
}

function getPostOpenUrl(row) {
  if (!row) return "";
  const cached = row._open_url == null ? "" : String(row._open_url).trim();
  if (cached) return cached;
  return resolvePostOpenUrl(row);
}

function getPostRowKey(row, idx) {
  const id = row?.id == null ? "" : String(row.id).trim();
  const href = getPostOpenUrl(row);
  const title = row?.title == null ? "" : String(row.title).trim();
  const author = row?._author_slug == null ? "" : String(row._author_slug).trim();
  return `${id}|${href}|${title}|${author}|${idx}`;
}

function openPostInNewTab(row) {
  const url = getPostOpenUrl(row);
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

const filteredDataPostsRows = computed(() => {
  const rows = Array.isArray(dataPostsRows.value) ? dataPostsRows.value : [];
  const viewId = dataPostsViewId.value;
  const starFilter = dataPostsStarFilterByView.value[viewId] ?? "all";
  const binanceAuthor =
    viewId === BINANCE_POSTS_VIEW_ID
      ? String(dataPostsBinanceAuthorByView.value[viewId] ?? "").trim()
      : "";
  const kw = (dataPostsKeyword.value || "").trim().toLowerCase();
  return rows.filter((row) => {
    if (binanceAuthor) {
      const slug = String(row?._author_slug ?? "").trim();
      if (slug !== binanceAuthor) return false;
    }
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
      row?.summary,
      row?.excerpt,
      row?.description,
      getSignalContent(row),
      row?.author,
      row?.category,
      getPostOpenUrl(row),
      row?._author_slug,
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
  loadPublishPlatforms();
  loadPublishPrompts();
  loadPublishHistory();
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

/** 标题旁悬浮提示用：正文/摘要（原 data-post-raw 展示字段） */
function getPostSummary(row) {
  if (!row) return "";
  const v =
    row.summary ??
    row.excerpt ??
    row.description ??
    row.snippet ??
    row.raw;
  if (v == null) return "";
  const s = String(v).trim();
  return s;
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
      dataPostsGroupKeys.value = [];
      return;
    }
    const rawItems = Array.isArray(data.items) ? data.items : [];
    dataPostsRows.value = rawItems.map((item) => normalizePostRow(item));
    dataPostsTotal.value = data.total ?? 0;
    dataPostsVersion.value = data.version ?? null;
    dataPostsGeneratedAt.value = data.generated_at || "";
    dataPostsPlatformLabels.value = data.platform_labels ?? null;
    const keys = data.posts_group_keys;
    dataPostsGroupKeys.value = Array.isArray(keys) ? keys.map((k) => String(k)) : [];
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
  const done = await waitScriptDone(item.id, 1800);
  if (!done) {
    ElMessage.warning("任务执行等待超时，未触发 Telegram 通知");
    return;
  }
  try {
    const res = await fetch(`/api/scripts/${item.id}/notify-telegram`, { method: "POST" });
    let data = null;
    try {
      data = await res.json();
    } catch {
      // ignore
    }
    if (!res.ok) {
      ElMessage.error(`Telegram 通知触发失败：${data?.detail || res.statusText || "request failed"}`);
      return;
    }
    ElMessage.success("任务完成，已触发 Telegram 通知流程");
  } catch {
    ElMessage.error("Telegram 通知触发失败");
  }
}

async function waitScriptDone(scriptId, timeoutSeconds = 1800) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch("/api/scripts");
      const data = await res.json();
      const items = data?.items || [];
      const target = items.find((x) => x?.id === scriptId);
      if (!target) return false;
      if (target.status !== "running") return true;
    } catch {
      // ignore and retry
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return false;
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

watch(mainTab, (tab) => {
  if (tab === "publish") {
    loadPublishPlatforms();
    loadPublishPrompts();
    loadPublishHistory();
  }
});

watch(publishPlatform, () => {
  if (mainTab.value === "publish") loadPublishHistory();
});

onMounted(() => {
  refreshAll();
  pollTimer = setInterval(() => loadCards(), 300000);
  window.addEventListener("click", closeVideoContextMenu);
  window.addEventListener("scroll", closeVideoContextMenu, true);
  window.addEventListener("resize", closeVideoContextMenu);
});

onUnmounted(() => {
  detachImagePreviewPanListeners();
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
  min-height: 100vh;
  box-sizing: border-box;
  background: var(--el-bg-color-page);
  color: var(--el-text-color-primary);
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
  color: var(--el-color-danger);
}
.data-posts-meta {
  margin-bottom: 10px;
  color: var(--el-text-color-regular);
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
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.data-posts-cards {
  max-height: 72vh;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
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
.data-post-title-wrap {
  flex: 1;
  min-width: 0;
}
.data-post-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  word-break: break-word;
  cursor: default;
}
.data-post-summary {
  color: var(--el-text-color-regular);
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
  color: var(--el-text-color-secondary);
}
.data-post-signal-stars {
  color: var(--el-color-warning);
  letter-spacing: 1px;
  font-weight: 600;
}
.data-post-signal-score {
  color: var(--el-text-color-regular);
  font-size: 12px;
}
.data-post-signal-content-wrap {
  width: 100%;
  min-width: 0;
}
.data-post-signal-content {
  color: var(--el-text-color-primary);
  margin-bottom: 6px;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  word-break: break-word;
  white-space: normal;
  cursor: default;
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
.data-post-thumb-btn {
  position: relative;
  display: block;
  padding: 0;
  margin: 0;
  border: 0;
  border-radius: 8px;
  cursor: zoom-in;
  background: transparent;
  line-height: 0;
}
.data-post-thumb-btn:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
.data-post-thumb {
  width: 88px;
  height: 88px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid var(--el-border-color);
  display: block;
  background: var(--el-fill-color-dark);
  vertical-align: top;
}
.data-post-thumb-hint {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 4px 6px;
  font-size: 11px;
  color: #fff;
  text-align: center;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.65));
  border-radius: 0 0 7px 7px;
  pointer-events: none;
}
.image-preview-dialog :deep(.el-dialog__body) {
  padding-top: 6px;
}
.image-preview-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
  margin-bottom: 10px;
}
.image-preview-zoom-pct {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  min-width: 3.5em;
}
.image-preview-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  flex: 1;
  min-width: 200px;
}
.image-preview-stage {
  height: min(72vh, 760px);
  overflow: hidden;
  background: var(--el-fill-color-dark);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;
}
.image-preview-pan-layer {
  cursor: grab;
  will-change: transform;
}
.image-preview-pan-layer.is-panning {
  cursor: grabbing;
}
.image-preview-fullimg {
  max-width: min(90vw, 1040px);
  max-height: min(68vh, 720px);
  width: auto;
  height: auto;
  object-fit: contain;
  display: block;
  border-radius: 4px;
  box-shadow: var(--el-box-shadow-light);
}
.data-post-video {
  margin-top: 10px;
  padding: 8px;
  border: 1px dashed var(--el-border-color);
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: context-menu;
  background: var(--el-fill-color-light);
}
.data-post-video-thumb {
  width: 88px;
  height: 60px;
  border-radius: 8px;
  background: linear-gradient(135deg, var(--el-color-primary) 0%, var(--el-color-primary-light-3) 100%);
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
  color: var(--el-text-color-primary);
  font-weight: 600;
  margin-bottom: 2px;
}
.data-post-video-url {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  word-break: break-all;
}
.video-context-menu {
  position: fixed;
  z-index: 3000;
  min-width: 150px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  background: var(--el-bg-color-overlay);
  box-shadow: var(--el-box-shadow-dark);
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
  color: var(--el-text-color-primary);
}
.video-menu-item:hover {
  background: var(--el-fill-color-light);
}
.data-post-foot {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
@media (max-width: 1200px) {
  .data-posts-cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
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
  color: var(--el-text-color-primary);
}
.meta {
  color: var(--el-text-color-regular);
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
html.dark {
  color-scheme: dark;
}

body {
  margin: 0;
  background: var(--el-bg-color-page);
  color: var(--el-text-color-primary);
  font-family:
    Inter,
    "PingFang SC",
    "Microsoft YaHei",
    sans-serif;
}

.markdown-hint {
  margin-bottom: 10px;
  color: var(--el-text-color-regular);
  font-size: 13px;
}

/* 帖子弹窗 teleport 到 body，需非 scoped；整体缩小 20% 以同屏展示更多 */
.data-posts-dialog .data-posts-scale {
  zoom: 0.8;
}

.data-post-summary-tooltip {
  max-width: min(520px, 78vw) !important;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
}

.data-post-signal-tooltip {
  max-width: min(560px, 82vw) !important;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
}

.publish-layout {
  display: grid;
  grid-template-columns: 1fr min(360px, 32vw);
  gap: 16px;
  align-items: start;
}
@media (max-width: 960px) {
  .publish-layout {
    grid-template-columns: 1fr;
  }
}
.publish-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.publish-prompt-card {
  margin-bottom: 12px;
}
.publish-prompt-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}
.publish-prompt-row:last-child {
  margin-bottom: 0;
}
.publish-prompt-label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  min-width: 4.5em;
}
.publish-prompt-pickers {
  padding-left: 0;
}
.publish-prompt-option {
  display: flex;
  flex-direction: column;
  line-height: 1.35;
  padding: 2px 0;
}
.publish-prompt-option-desc {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}
.publish-prompt-auto-hint {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}
.publish-prompt-selection {
  margin-top: 8px;
  font-size: 12px;
  color: var(--el-color-primary);
}
.publish-key-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.publish-editor-card {
  margin-bottom: 12px;
}
.publish-preview-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}
.publish-star-label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.publish-star-num {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.publish-model-hint {
  margin-top: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.publish-preview-card {
  margin-top: 4px;
}
.publish-preview-body {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.6;
  color: var(--el-text-color-primary);
  max-height: 280px;
  overflow: auto;
}
.publish-side-title {
  font-weight: 600;
  margin-bottom: 10px;
}
.publish-history-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: calc(100vh - 220px);
  overflow: auto;
}
.publish-history-item {
  cursor: pointer;
}
.publish-history-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.publish-history-time {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.publish-history-platform {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 4px;
}
.publish-history-snippet {
  font-size: 13px;
  color: var(--el-text-color-primary);
  margin-bottom: 6px;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  overflow: hidden;
}
.publish-history-error {
  font-size: 12px;
  color: var(--el-color-danger);
  margin-top: 4px;
}
</style>
