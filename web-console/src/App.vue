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
              <el-tag :type="statusType(item)">{{ statusText(item) }}</el-tag>
            </div>
            <div class="meta">上次运行: {{ item.last_run_time || "-" }}</div>
            <div v-if="item.schedule_enabled && item.schedule?.seconds" class="meta">
              循环间隔: {{ formatScriptInterval(item.schedule.seconds) }}
            </div>
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
              <el-button
                size="small"
                type="primary"
                :disabled="item.status === 'running'"
                @click="runFetch(item)"
              >
                执行一次
              </el-button>
              <el-button
                v-if="!item.schedule_enabled"
                size="small"
                type="success"
                :disabled="!canLoopScript(item)"
                @click="startLoopTask(item)"
              >
                循环执行
              </el-button>
              <el-button
                v-else
                size="small"
                type="warning"
                @click="stopLoopTask(item)"
              >
                关闭循环
              </el-button>
              <el-button
                size="small"
                type="danger"
                :disabled="item.status !== 'running'"
                @click="pauseTask(item)"
              >
                暂停
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
              <div class="publish-attach-section">
                <div class="publish-attach-head">
                  <span class="publish-attach-title">附图</span>
                  <span class="publish-attach-hint">
                    最多 {{ publishAttachMax }} 张，单张 ≤5MB；可选填币安 imageToken（接入上传 API 后随帖发布）
                  </span>
                </div>
                <div class="publish-attach-toolbar">
                  <el-upload
                    action="#"
                    list-type="picture-card"
                    :auto-upload="false"
                    :show-file-list="false"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    multiple
                    :disabled="publishAttachments.length >= publishAttachMax"
                    :on-change="onPublishImageSelected"
                  >
                    <span class="publish-upload-plus">+</span>
                  </el-upload>
                  <el-input
                    v-model="publishImageTokensText"
                    class="publish-image-tokens"
                    clearable
                    placeholder="imageToken，多个用英文逗号分隔（可选）"
                  />
                </div>
                <div v-if="publishAttachments.length" class="publish-attach-grid">
                  <div
                    v-for="img in publishAttachments"
                    :key="img.id"
                    class="publish-attach-item"
                  >
                    <img
                      :src="img.previewUrl"
                      :alt="img.name"
                      class="publish-attach-thumb"
                      @click="openImagePreview(img.previewUrl, img.name)"
                    />
                    <button
                      type="button"
                      class="publish-attach-remove"
                      title="移除"
                      @click="removePublishAttachment(img.id)"
                    >
                      ×
                    </button>
                    <span class="publish-attach-name">{{ img.name }}</span>
                  </div>
                </div>
              </div>
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
              <div v-if="publishAttachments.length" class="publish-preview-images">
                <img
                  v-for="img in publishAttachments"
                  :key="`preview-${img.id}`"
                  :src="img.previewUrl"
                  :alt="img.name"
                  class="publish-preview-thumb"
                  @click="openImagePreview(img.previewUrl, img.name)"
                />
              </div>
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
                <div v-if="h.attachments?.length" class="publish-history-thumbs" @click.stop>
                  <img
                    v-for="a in h.attachments"
                    :key="`${h.id}-${a.id}`"
                    :src="publishMediaUrl(a.url)"
                    :alt="a.id"
                    class="publish-history-thumb"
                  />
                </div>
                <div v-if="h.error" class="publish-history-error">{{ h.error }}</div>
              </el-card>
            </div>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="任务" name="tasks">
        <div class="ts-cal">
          <header class="ts-cal-header">
            <div class="ts-cal-nav">
              <button type="button" class="ts-icon-btn" title="上一段" @click="taskNav(-1)">‹</button>
              <button type="button" class="ts-today-btn" @click="taskNavToday">今天</button>
              <button type="button" class="ts-icon-btn" title="下一段" @click="taskNav(1)">›</button>
            </div>
            <h2 class="ts-cal-title">{{ taskRangeLabel }}</h2>
            <div class="ts-view-switch">
              <button
                v-for="v in taskViewOptions"
                :key="v.id"
                type="button"
                class="ts-view-btn"
                :class="{ active: taskView === v.id }"
                @click="selectTaskView(v.id)"
              >
                {{ v.label }}
              </button>
            </div>
            <div class="ts-cal-actions">
              <span class="ts-local-hint">本地缓存</span>
              <el-button size="small" :loading="taskLoading" text @click="loadTasks">刷新</el-button>
              <el-button type="primary" class="ts-add-btn" @click="openTaskDialog()">+ 添加任务</el-button>
            </div>
          </header>

          <div v-loading="taskLoading" class="ts-cal-body">
            <!-- 日：单列聚焦 -->
            <div v-if="taskView === 'day'" class="ts-day">
              <div class="ts-day-hero" :class="{ 'is-today': taskDayHeader.isToday }">
                <div class="ts-day-hero-weekday">{{ taskDayHeader.weekday }}</div>
                <div class="ts-day-hero-date">
                  <span class="ts-day-hero-num">{{ taskDayHeader.day }}</span>
                  <span class="ts-day-hero-meta">{{ taskDayHeader.year }}年{{ taskDayHeader.month }}月</span>
                </div>
                <div class="ts-day-hero-stat">
                  {{ taskDayPendingCount }} 待办 · {{ taskItems.length }} 项
                </div>
              </div>
              <button type="button" class="ts-inline-add" @click="openTaskDialog(null, taskAnchor)">
                + 在此日添加任务
              </button>
              <div v-if="!taskItems.length" class="ts-empty">这一天还没有任务，把思考好的内容粘贴进来吧</div>
              <article
                v-for="t in taskItems"
                :key="t.id"
                class="ts-task-card"
                :class="{ done: t.status === 'done', recurring: t.recurrence || t.series_id || t._virtual }"
                draggable="true"
                @dragstart="onTaskDragStart(t, $event)"
                @dragend="onTaskDragEnd"
              >
                <label class="ts-task-check" @click.stop>
                  <input
                    type="checkbox"
                    :checked="t.status === 'done'"
                    @change="toggleTaskDone(t)"
                  />
                </label>
                <div class="ts-task-main" @click="openTaskDialog(t)">
                  <div class="ts-task-top">
                    <span class="ts-task-time">
                      {{ formatTaskTime(t.due_at) }}
                      <span v-if="taskRecurrenceLabel(t)" class="ts-recur-tag">{{ taskRecurrenceLabel(t) }}</span>
                    </span>
                    <div class="ts-task-ops">
                      <button type="button" class="ts-link" @click.stop="promptCopyTaskToDate(t)">复制</button>
                      <button type="button" class="ts-link" @click.stop="openTaskDialog(t)">编辑</button>
                      <button type="button" class="ts-link danger" @click.stop="deleteTaskItem(t)">删除</button>
                    </div>
                  </div>
                  <h3 class="ts-task-title">{{ t.title }}</h3>
                  <pre class="ts-task-body">{{ t.content }}</pre>
                </div>
              </article>
            </div>

            <!-- 周：Timestripe 式七列 Horizons -->
            <div v-else-if="taskView === 'week'" class="ts-week-wrap">
              <p class="ts-drag-hint">拖动任务到其他列可改期；按住 ⌘/Ctrl 拖动为复制</p>
              <div class="ts-week">
              <div
                v-for="col in taskWeekColumns"
                :key="col.date"
                class="ts-week-col"
                :class="{ today: col.isToday }"
              >
                <button type="button" class="ts-week-head" @click="drillTaskDay(col.date)">
                  <span class="ts-week-wd">{{ col.weekday }}</span>
                  <span class="ts-week-num" :class="{ ring: col.isToday }">{{ col.dayNum }}</span>
                </button>
                <div
                  class="ts-week-stack"
                  @dragover="onTaskDragOver"
                  @drop="onTaskDropToDate(col.date, $event)"
                >
                  <div
                    v-for="t in tasksOnDate(col.date)"
                    :key="t.id"
                    class="ts-week-pill"
                    :class="{ done: t.status === 'done', recurring: t.recurrence || t.series_id || t._virtual }"
                    draggable="true"
                    @dragstart.stop="onTaskDragStart(t, $event)"
                    @dragend="onTaskDragEnd"
                    @click="openTaskDialog(t)"
                  >
                    <input
                      type="checkbox"
                      class="ts-pill-check"
                      :checked="t.status === 'done'"
                      @click.stop
                      @change="toggleTaskDone(t)"
                    />
                    <div class="ts-pill-text">
                      <span class="ts-pill-time">
                        {{ formatTaskTime(t.due_at) }}
                        <span v-if="taskRecurrenceLabel(t)" class="ts-recur-dot" :title="taskRecurrenceLabel(t)">↻</span>
                      </span>
                      <span class="ts-pill-title">{{ t.title }}</span>
                    </div>
                    <button
                      type="button"
                      class="ts-pill-copy"
                      title="复制到其他日期"
                      @click.stop="promptCopyTaskToDate(t)"
                    >
                      ⧉
                    </button>
                    <button
                      type="button"
                      class="ts-pill-del"
                      title="删除"
                      @click.stop="deleteTaskItem(t)"
                    >
                      ×
                    </button>
                  </div>
                  <button type="button" class="ts-week-add" @click="openTaskDialog(null, col.date)">
                    + 添加
                  </button>
                </div>
              </div>
              </div>
            </div>

            <!-- 月：直升机视角网格 -->
            <div v-else-if="taskView === 'month'" class="ts-month">
              <div class="ts-month-weekdays">
                <span v-for="w in taskWeekdayLabels" :key="w">{{ w }}</span>
              </div>
              <div class="ts-month-grid">
                <div
                  v-for="cell in taskMonthCells"
                  :key="cell.key"
                  class="ts-month-cell"
                  :class="{ muted: !cell.inMonth, today: cell.isToday, 'has-tasks': cell.taskCount > 0 }"
                  @click="cell.inMonth && drillTaskDay(cell.date)"
                >
                  <div class="ts-month-cell-head">
                    <span class="ts-month-day" :class="{ ring: cell.isToday }">{{ cell.day }}</span>
                    <span v-if="cell.taskCount" class="ts-month-badge">{{ cell.taskCount }}</span>
                  </div>
                  <div class="ts-month-bars">
                    <div
                      v-for="t in tasksOnDate(cell.date).slice(0, 4)"
                      :key="t.id"
                      class="ts-month-bar"
                      :class="{ done: t.status === 'done' }"
                      @click.stop="openTaskDialog(t)"
                    >
                      {{ t.title }}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 年：12 月鸟瞰 + 迷你日历 -->
            <div v-else class="ts-year">
              <div
                v-for="m in taskYearMonths"
                :key="m.key"
                class="ts-year-card"
                @click="drillTaskMonth(m.month)"
              >
                <div class="ts-year-card-head">
                  <span class="ts-year-name">{{ m.label }}</span>
                  <span class="ts-year-meta">{{ m.count }} 项 · {{ m.pending }} 待办</span>
                </div>
                <div class="ts-year-mini">
                  <span
                    v-for="(c, idx) in getMiniMonthCells(m.month)"
                    :key="`${m.key}-${idx}`"
                    class="ts-year-dot"
                    :class="{
                      dim: !c.inMonth,
                      today: c.isToday,
                      busy: c.hasTask,
                      done: c.allDone,
                    }"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <el-dialog
      v-model="taskDialogVisible"
      :title="taskEditingId ? '编辑任务' : '添加任务'"
      width="640px"
      destroy-on-close
      @closed="resetTaskForm"
    >
      <el-form label-width="88px">
        <el-alert
          v-if="taskEditingSeriesHint"
          type="info"
          :closable="false"
          show-icon
          class="ts-series-hint"
          title="周期任务：保存将同步到所有重复日期；删除将移除整个系列。"
        />
        <el-form-item v-if="!taskFormBatchCreate || taskEditingId" label="标题">
          <el-input v-model="taskFormTitle" placeholder="可选；留空则取内容首行" maxlength="120" />
        </el-form-item>
        <el-form-item label="任务内容" required>
          <el-input
            v-model="taskFormContent"
            type="textarea"
            :rows="12"
            :placeholder="
              taskFormBatchCreate
                ? '批量模式：每行一条任务，空行自动忽略'
                : '直接粘贴你反复思考后的任务说明（支持多行）'
            "
            maxlength="50000"
            show-word-limit
          />
        </el-form-item>
        <el-form-item v-if="!taskEditingId" label="">
          <el-checkbox v-model="taskFormBatchCreate">批量创建（每行一条任务）</el-checkbox>
        </el-form-item>
        <el-form-item v-if="!taskFormBatchCreate" label="重复">
          <el-select v-model="taskFormRecurrence" style="width: 100%">
            <el-option
              v-for="o in TASK_RECURRENCE_OPTIONS"
              :key="o.value"
              :label="o.label"
              :value="o.value"
            />
          </el-select>
          <el-checkbox-group
            v-if="taskFormRecurrence === 'weekly'"
            v-model="taskFormWeekdays"
            class="ts-weekday-group"
          >
            <el-checkbox v-for="w in TASK_WEEKDAY_OPTIONS" :key="w.value" :label="w.value">
              {{ w.label }}
            </el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item label="截止时间" required>
          <el-date-picker
            v-model="taskFormDue"
            type="datetime"
            placeholder="选择日期时间"
            format="YYYY-MM-DD HH:mm"
            value-format="YYYY-MM-DD HH:mm:ss"
            :default-value="taskDuePickerDefault"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="提醒时间">
          <el-checkbox v-model="taskRemindSame" label="与截止时间相同" />
          <el-date-picker
            v-if="!taskRemindSame"
            v-model="taskFormRemind"
            type="datetime"
            placeholder="提前提醒"
            format="YYYY-MM-DD HH:mm"
            value-format="YYYY-MM-DD HH:mm:ss"
            style="width: 100%; margin-top: 8px"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="ts-task-dialog-footer">
          <el-button v-if="taskEditingId" type="danger" plain @click="deleteTaskFromDialog">删除</el-button>
          <div class="ts-task-dialog-footer-spacer" />
          <el-button @click="taskDialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="taskSaving" @click="saveTask">
            {{ taskFormBatchCreate && !taskEditingId ? "批量保存" : "保存" }}
          </el-button>
        </div>
      </template>
    </el-dialog>

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
const publishAttachMax = 9;
const publishAttachments = ref([]);
const publishImageTokensText = ref("");

function formatTaskDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const taskView = ref("week");
const taskAnchor = ref(formatTaskDate(new Date()));
const taskTodayLabel = ref(formatTaskDate(new Date()));
/** 全部任务（localStorage 为唯一数据源，暂不依赖后端） */
const taskStoreAll = ref([]);
const taskLoading = ref(false);
const taskDialogVisible = ref(false);
const taskEditingId = ref("");
const taskEditingSnapshot = ref(null);
const taskFormTitle = ref("");
const taskFormContent = ref("");
const taskFormDue = ref("");
const taskFormRemind = ref("");
const taskFormBatchCreate = ref(false);
const taskFormRecurrence = ref("none");
const taskFormWeekdays = ref([1, 2, 3, 4, 5]);
const taskRemindSame = ref(true);
const taskSaving = ref(false);
const taskDuePickerDefault = ref(new Date());
const taskDragPayload = ref(null);
const TASK_RECURRENCE_OPTIONS = [
  { value: "none", label: "不重复" },
  { value: "daily", label: "每天" },
  { value: "weekdays", label: "工作日（周一至周五）" },
  { value: "weekly", label: "每周（自选星期）" },
];
const TASK_WEEKDAY_OPTIONS = [
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
  { value: 7, label: "周日" },
];
const taskWeekdayLabels = ["一", "二", "三", "四", "五", "六", "日"];
const taskWeekdayLong = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const taskViewOptions = [
  { id: "day", label: "日" },
  { id: "week", label: "周" },
  { id: "month", label: "月" },
  { id: "year", label: "年" },
];
let taskReminderPollTimer = null;
const TASK_STORE_KEY = "deal_manage_tasks";
const TASK_NOTIFIED_KEY = "deal_manage_task_notified_ids";

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

function publishMediaUrl(path) {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return path.startsWith("/") ? path : `/${path}`;
}

function clearPublishAttachments() {
  for (const item of publishAttachments.value) {
    if (item.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(item.previewUrl);
  }
  publishAttachments.value = [];
}

function publishImagesPayload() {
  return publishAttachments.value
    .map((x) => x.base64)
    .filter((s) => typeof s === "string" && s.trim());
}

function formatTaskDateTime(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const sec = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:${min}:${sec}`;
}

function taskDueDateKey(taskOrIso) {
  const raw =
    typeof taskOrIso === "string"
      ? taskOrIso
      : taskOrIso?.due_at || taskOrIso?.remind_at || "";
  const s = String(raw).trim().replace("T", " ");
  return s.length >= 10 ? s.slice(0, 10) : "";
}

function normalizeDueAtForApi(val) {
  if (!val) return "";
  if (val instanceof Date) return formatTaskDateTime(val);
  let s = String(val).trim().replace("T", " ");
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s} 09:00:00`;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) return `${s}:00`;
  return s.slice(0, 19);
}

function defaultTaskDueDatetime(presetDate) {
  const now = new Date();
  let d;
  if (presetDate && /^\d{4}-\d{2}-\d{2}$/.test(presetDate)) {
    const [y, mo, da] = presetDate.split("-").map(Number);
    d = new Date(y, mo - 1, da, now.getHours(), now.getMinutes(), 0);
  } else {
    d = new Date(now);
    d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  }
  return formatTaskDateTime(d);
}

function parseLocalDateTime(str) {
  const s = normalizeDueAtForApi(str);
  if (!s) return new Date();
  const [datePart, timePart = "09:00:00"] = s.split(" ");
  const [y, mo, da] = datePart.split("-").map(Number);
  const [hh, mm, ss = 0] = timePart.split(":").map(Number);
  return new Date(y, mo - 1, da, hh, mm, ss);
}

function syncTaskTodayLabel() {
  taskTodayLabel.value = formatTaskDate(new Date());
}

function parseTaskAnchor() {
  const s = taskAnchor.value || formatTaskDate(new Date());
  const [y, mo, da] = s.split("-").map(Number);
  return new Date(y, mo - 1, da);
}

function formatTaskTime(iso) {
  if (!iso) return "";
  const p = String(iso).replace("T", " ");
  return p.length >= 16 ? p.slice(11, 16) : p.slice(11) || p;
}

const taskViewUnit = computed(() => {
  const m = { day: "日", week: "周", month: "月", year: "年" };
  return m[taskView.value] || "";
});

const taskRangeLabel = computed(() => {
  const d = parseTaskAnchor();
  const today = formatTaskDate(new Date());
  if (taskView.value === "day") {
    const wd = taskWeekdayLong[d.getDay()];
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 · ${wd}`;
  }
  if (taskView.value === "week") {
    const start = mondayOf(d);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const sameYear = start.getFullYear() === end.getFullYear();
    if (sameYear) {
      return `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日 — ${end.getMonth() + 1}月${end.getDate()}日`;
    }
    return `${formatTaskDate(start)} — ${formatTaskDate(end)}`;
  }
  if (taskView.value === "month") {
    return `${d.getFullYear()}年 ${d.getMonth() + 1}月`;
  }
  return `${d.getFullYear()} 年`;
});

function mondayOf(d) {
  const x = new Date(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}

function computeTaskRange(anchorStr, view) {
  const base = (anchorStr || formatTaskDate(new Date())).slice(0, 10);
  const [y, mo, da] = base.split("-").map(Number);
  const d = new Date(y, mo - 1, da);
  if (view === "day") {
    const s = formatTaskDate(d);
    return { from: s, to: s };
  }
  if (view === "week") {
    const start = mondayOf(d);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { from: formatTaskDate(start), to: formatTaskDate(end) };
  }
  if (view === "month") {
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return { from: formatTaskDate(start), to: formatTaskDate(end) };
  }
  return { from: `${d.getFullYear()}-01-01`, to: `${d.getFullYear()}-12-31` };
}

function taskIsoWeekday(dateStr) {
  const [y, mo, da] = String(dateStr).slice(0, 10).split("-").map(Number);
  const d = new Date(y, mo - 1, da);
  const js = d.getDay();
  return js === 0 ? 7 : js;
}

function taskTimePart(iso) {
  const s = normalizeDueAtForApi(iso);
  if (!s || s.length < 11) return "09:00:00";
  const part = s.slice(11);
  return part.length === 5 ? `${part}:00` : part.slice(0, 8);
}

function taskCombineDateTime(dateStr, isoTimeSource) {
  return `${dateStr} ${taskTimePart(isoTimeSource)}`;
}

function isRecurrenceMaster(t) {
  const r = t?.recurrence;
  if (!r || !r.freq || r.freq === "none") return false;
  if (t.is_series_master) return true;
  const sid = t.series_id || t.id;
  return !t.series_id || t.series_id === t.id;
}

function repairTaskRecord(raw) {
  const t = normalizeTaskRecord(raw);
  if (!isRecurrenceMaster(t)) return t;
  const id = t.id;
  if (!id) return t;
  return {
    ...t,
    is_series_master: true,
    series_id: t.series_id || id,
    recurrence_skip_dates: Array.isArray(t.recurrence_skip_dates) ? t.recurrence_skip_dates : [],
  };
}

function normalizeTaskRecord(raw) {
  const t = raw && typeof raw === "object" ? raw : {};
  const recurrence = t.recurrence && typeof t.recurrence === "object" ? t.recurrence : null;
  const freq = recurrence?.freq && recurrence.freq !== "none" ? recurrence.freq : "none";
  const hasRecurrence = freq !== "none";
  const merged = {
    recurrence: null,
    is_series_master: false,
    series_id: null,
    recurrence_skip_dates: [],
    ...t,
  };
  const seriesId = merged.series_id || (hasRecurrence ? merged.id : null);
  const isMaster =
    !!merged.is_series_master ||
    (hasRecurrence && seriesId && (!merged.series_id || merged.series_id === merged.id));
  return {
    ...merged,
    recurrence: hasRecurrence
      ? {
          freq,
          byweekday: Array.isArray(recurrence?.byweekday)
            ? recurrence.byweekday.filter((n) => n >= 1 && n <= 7)
            : [],
        }
      : null,
    is_series_master: isMaster,
    series_id: hasRecurrence ? seriesId : merged.series_id || null,
    recurrence_skip_dates: Array.isArray(merged.recurrence_skip_dates)
      ? merged.recurrence_skip_dates
      : [],
  };
}

function buildRecurrencePayload(freq, weekdays, anchorDate) {
  if (!freq || freq === "none") return null;
  if (freq === "daily" || freq === "weekdays") {
    return { freq, byweekday: [] };
  }
  const days =
    weekdays?.length > 0 ? [...weekdays].sort((a, b) => a - b) : [taskIsoWeekday(anchorDate)];
  return { freq: "weekly", byweekday: days };
}

function dateMatchesRecurrence(dateStr, recurrence, anchorDateStr) {
  if (!recurrence || recurrence.freq === "none") return false;
  if (anchorDateStr && dateStr < anchorDateStr) return false;
  const wd = taskIsoWeekday(dateStr);
  if (recurrence.freq === "daily") return true;
  if (recurrence.freq === "weekdays") return wd >= 1 && wd <= 5;
  if (recurrence.freq === "weekly") {
    const days =
      recurrence.byweekday?.length > 0
        ? recurrence.byweekday
        : [taskIsoWeekday(anchorDateStr || dateStr)];
    return days.includes(wd);
  }
  return false;
}

function taskSeriesMasters(tasks) {
  return tasks.filter(isRecurrenceMaster);
}

function hasSeriesInstanceOnDate(tasks, seriesId, dateStr) {
  return tasks.some(
    (t) =>
      !t.is_series_master &&
      (t.series_id === seriesId || t.id === seriesId) &&
      taskDueDateKey(t) === dateStr
  );
}

function enumerateDates(from, to) {
  const out = [];
  const [y0, m0, d0] = from.split("-").map(Number);
  const [y1, m1, d1] = to.split("-").map(Number);
  const cur = new Date(y0, m0 - 1, d0);
  const end = new Date(y1, m1 - 1, d1);
  while (cur <= end) {
    out.push(formatTaskDate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function expandTasksInRange(tasks, from, to) {
  const normalized = tasks.map(repairTaskRecord);
  const stored = normalized.filter((t) => !isRecurrenceMaster(t));
  const result = [];
  for (const t of stored) {
    const k = taskDueDateKey(t);
    if (k && k >= from && k <= to) {
      result.push({ ...t, _virtual: false });
    }
  }
  for (const master of taskSeriesMasters(normalized)) {
    const seriesId = master.series_id || master.id;
    const anchor = taskDueDateKey(master);
    const skips = new Set(master.recurrence_skip_dates || []);
    for (const date of enumerateDates(from, to)) {
      if (!dateMatchesRecurrence(date, master.recurrence, anchor)) continue;
      if (skips.has(date)) continue;
      if (hasSeriesInstanceOnDate(normalized, seriesId, date)) continue;
      const dueAt = taskCombineDateTime(date, master.due_at);
      result.push({
        ...master,
        id: `virt:${seriesId}:${date}`,
        due_at: dueAt,
        remind_at: taskCombineDateTime(date, master.remind_at || master.due_at),
        status: "pending",
        reminded: false,
        reminded_at: null,
        _virtual: true,
        series_id: seriesId,
        is_series_master: false,
      });
    }
  }
  return result.sort((a, b) => String(a.due_at || "").localeCompare(String(b.due_at || "")));
}

function taskRecurrenceLabel(task) {
  const r = task?.recurrence || resolveSeriesMaster(task)?.recurrence;
  if (!r || r.freq === "none") {
    if (task?.series_id || task?._virtual) return "周期";
    return "";
  }
  if (r.freq === "daily") return "每天";
  if (r.freq === "weekdays") return "工作日";
  if (r.freq === "weekly") {
    const map = { 1: "一", 2: "二", 3: "三", 4: "四", 5: "五", 6: "六", 7: "日" };
    const days = (r.byweekday?.length ? r.byweekday : [1]).map((d) => map[d] || d).join("、");
    return `每周${days}`;
  }
  return "周期";
}

function isVirtualTask(task) {
  return !!task?._virtual || String(task?.id || "").startsWith("virt:");
}

function seriesIdOf(task) {
  if (!task) return null;
  if (isVirtualTask(task)) {
    const v = parseVirtualTaskId(task.id);
    return v?.seriesId || task.series_id || null;
  }
  if (isRecurrenceMaster(task)) return task.id;
  return task.series_id || null;
}

function isSeriesTask(task) {
  const sid = seriesIdOf(task);
  if (!sid) return false;
  return !!resolveSeriesMaster({ series_id: sid, id: sid }) || isRecurrenceMaster(task);
}

function deleteSeriesById(seriesId) {
  if (!seriesId) return;
  patchTaskStore((list) => list.filter((t) => t.id !== seriesId && t.series_id !== seriesId));
}

function applySeriesUpdate(
  seriesId,
  { content, title, dueAt, remindAt, recurrence }
) {
  patchTaskStore((list) => {
    const master = list.find((t) => t.id === seriesId && isRecurrenceMaster(t));
    if (!master) return list;
    const updated = repairTaskRecord(
      buildTaskRecord({
        content,
        title,
        dueAt,
        remindAt,
        existing: master,
        recurrence,
      })
    );
    updated.recurrence_skip_dates = [];
    return list
      .filter((t) => !(t.series_id === seriesId && t.id !== seriesId))
      .map((t) => (t.id === seriesId ? updated : t));
  });
}

function demoteSeriesToSingleTask(seriesId, { content, title, dueAt, remindAt }) {
  patchTaskStore((list) => {
    const master = list.find((t) => t.id === seriesId);
    if (!master) return list.filter((t) => t.series_id !== seriesId);
    const single = buildTaskRecord({
      content,
      title,
      dueAt,
      remindAt,
      existing: master,
      recurrence: null,
    });
    single.is_series_master = false;
    single.series_id = null;
    single.recurrence = null;
    single.recurrence_skip_dates = [];
    return list
      .filter((t) => !(t.series_id === seriesId && t.id !== seriesId))
      .map((t) => (t.id === seriesId ? single : t));
  });
}

function resolveSeriesMaster(task) {
  const sid = seriesIdOf(task) || task?.series_id || task?.id;
  if (!sid) return null;
  return taskStoreAll.value.find(
    (t) => isRecurrenceMaster(t) && (t.id === sid || t.series_id === sid)
  );
}

function addRecurrenceSkipDate(master, dateStr) {
  if (!master || !dateStr) return master;
  const skips = new Set(master.recurrence_skip_dates || []);
  skips.add(dateStr);
  return { ...master, recurrence_skip_dates: [...skips], updated_at: formatTaskDateTime(new Date()) };
}

function patchTaskStore(updater) {
  const copy = [...taskStoreAll.value];
  const next = updater(copy);
  taskStoreAll.value = next;
  persistTaskStore();
}

function updateTaskById(taskId, patch) {
  patchTaskStore((list) =>
    list.map((t) => (t.id === taskId ? { ...t, ...patch, updated_at: formatTaskDateTime(new Date()) } : t))
  );
}

function materializeTaskOccurrence(task, targetDate, overrides = {}) {
  const seriesId = task.series_id || resolveSeriesMaster(task)?.id;
  const dueAt = taskCombineDateTime(targetDate, overrides.due_at || task.due_at);
  const remindAt = taskCombineDateTime(
    targetDate,
    overrides.remind_at || task.remind_at || task.due_at
  );
  const created = buildTaskRecord({
    content: overrides.content ?? task.content,
    title: overrides.title ?? task.title,
    dueAt,
    remindAt,
  });
  created.series_id = seriesId || null;
  created.is_series_master = false;
  if (overrides.status) created.status = overrides.status;
  taskStoreAll.value = [...taskStoreAll.value, created];
  persistTaskStore();
  return created;
}

function moveTaskToDate(task, targetDate) {
  const srcDate = taskDueDateKey(task);
  if (!targetDate || srcDate === targetDate) return;
  if (isVirtualTask(task)) {
    const master = resolveSeriesMaster(task);
    if (master) {
      patchTaskStore((list) =>
        list.map((t) => (t.id === master.id ? addRecurrenceSkipDate(t, srcDate) : t))
      );
    }
    materializeTaskOccurrence(task, targetDate);
    ElMessage.success("已移到所选日期");
    return;
  }
  const dueAt = taskCombineDateTime(targetDate, task.due_at);
  const remindAt = taskCombineDateTime(targetDate, task.remind_at || task.due_at);
  updateTaskById(task.id, { due_at: dueAt, remind_at: remindAt, reminded: false, reminded_at: null });
  ElMessage.success("已移到所选日期");
}

function copyTaskToDate(task, targetDate) {
  if (!targetDate) return;
  materializeTaskOccurrence(task, targetDate);
  ElMessage.success("已复制到所选日期");
}

async function promptCopyTaskToDate(task) {
  const src = taskDueDateKey(task) || formatTaskDate(new Date());
  try {
    const { value } = await ElMessageBox.prompt("复制到日期（YYYY-MM-DD）", "复制任务", {
      confirmButtonText: "复制",
      cancelButtonText: "取消",
      inputValue: src,
      inputPattern: /^\d{4}-\d{2}-\d{2}$/,
      inputErrorMessage: "请输入 YYYY-MM-DD",
    });
    copyTaskToDate(task, value.trim());
    focusTaskOnCalendar(`${value.trim()} ${taskTimePart(task.due_at)}`);
  } catch {
    /* cancelled */
  }
}

function onTaskDragStart(task, e) {
  const copy = !!(e.altKey || e.metaKey || e.ctrlKey);
  taskDragPayload.value = { task, copy };
  e.dataTransfer.effectAllowed = copy ? "copy" : "move";
  e.dataTransfer.setData("text/plain", task.id);
}

function onTaskDragEnd() {
  taskDragPayload.value = null;
}

function onTaskDragOver(e) {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = taskDragPayload.value?.copy ? "copy" : "move";
}

function onTaskDropToDate(targetDate, e) {
  e.preventDefault();
  const payload = taskDragPayload.value;
  taskDragPayload.value = null;
  if (!payload?.task || !targetDate) return;
  if (payload.copy) copyTaskToDate(payload.task, targetDate);
  else moveTaskToDate(payload.task, targetDate);
  focusTaskOnCalendar(`${targetDate} ${taskTimePart(payload.task.due_at)}`);
}

function filterTasksForView(tasks, anchor, view) {
  const { from, to } = computeTaskRange(anchor, view);
  return expandTasksInRange(tasks, from, to);
}

const taskEditingSeriesHint = computed(() => {
  const t = taskEditingSnapshot.value;
  if (!t || !taskEditingId.value) return false;
  return isSeriesTask(t);
});

const taskItems = computed(() =>
  filterTasksForView(taskStoreAll.value, taskAnchor.value, taskView.value)
);

function loadTaskStoreFromCache() {
  try {
    const raw = localStorage.getItem(TASK_STORE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    const repaired = Array.isArray(list) ? list.map(repairTaskRecord) : [];
    taskStoreAll.value = repaired;
    const changed = JSON.stringify(list) !== JSON.stringify(repaired);
    if (changed) persistTaskStore();
  } catch {
    taskStoreAll.value = [];
  }
}

function persistTaskStore() {
  try {
    localStorage.setItem(TASK_STORE_KEY, JSON.stringify(taskStoreAll.value));
  } catch (e) {
    ElMessage.error(`本地保存失败: ${e.message || e}`);
  }
}

function newTaskId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function buildTaskRecord({ content, title, dueAt, remindAt, existing, recurrence }) {
  const now = formatTaskDateTime(new Date());
  const body = content.trim();
  const due = normalizeDueAtForApi(dueAt);
  const remind = normalizeDueAtForApi(remindAt || dueAt);
  const autoTitle = body.split("\n")[0].trim().slice(0, 120) || "未命名任务";
  const rec =
    recurrence && recurrence.freq && recurrence.freq !== "none"
      ? {
          freq: recurrence.freq,
          byweekday: Array.isArray(recurrence.byweekday) ? recurrence.byweekday : [],
        }
      : null;
  if (existing) {
    const next = {
      ...existing,
      title: (title || "").trim() || autoTitle,
      content: body,
      due_at: due,
      remind_at: remind,
      reminded: false,
      reminded_at: null,
      updated_at: now,
      recurrence: rec,
      is_series_master: !!rec,
      series_id: rec ? existing.series_id || existing.id : null,
    };
    if (!rec) {
      next.is_series_master = false;
      next.series_id = existing.series_id || null;
    }
    return next;
  }
  const id = newTaskId();
  return {
    id,
    title: (title || "").trim() || autoTitle,
    content: body,
    due_at: due,
    remind_at: remind,
    status: "pending",
    reminded: false,
    reminded_at: null,
    created_at: now,
    updated_at: now,
    recurrence: rec,
    is_series_master: !!rec,
    series_id: rec ? id : null,
    recurrence_skip_dates: [],
  };
}

const taskDayHeader = computed(() => {
  const d = parseTaskAnchor();
  const today = formatTaskDate(new Date());
  const anchor = formatTaskDate(d);
  return {
    weekday: taskWeekdayLong[d.getDay()],
    day: d.getDate(),
    month: d.getMonth() + 1,
    year: d.getFullYear(),
    isToday: anchor === today,
  };
});

const taskDayPendingCount = computed(() => {
  return taskItems.value.filter((t) => t.status !== "done").length;
});

function selectTaskView(view) {
  if (taskView.value === view) return;
  taskView.value = view;
  syncTaskTodayLabel();
}

const taskWeekColumns = computed(() => {
  const start = mondayOf(parseTaskAnchor());
  const today = formatTaskDate(new Date());
  const cols = [];
  for (let i = 0; i < 7; i++) {
    const x = new Date(start);
    x.setDate(start.getDate() + i);
    const date = formatTaskDate(x);
    cols.push({
      date,
      label: `${x.getMonth() + 1}/${x.getDate()}`,
      weekday: taskWeekdayLabels[i],
      dayNum: x.getDate(),
      isToday: date === today,
    });
  }
  return cols;
});

const taskMonthCells = computed(() => {
  const d = parseTaskAnchor();
  const y = d.getFullYear();
  const m = d.getMonth();
  const first = new Date(y, m, 1);
  const startPad = (first.getDay() + 6) % 7;
  const gridStart = new Date(y, m, 1 - startPad);
  const today = formatTaskDate(new Date());
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const x = new Date(gridStart);
    x.setDate(gridStart.getDate() + i);
    const date = formatTaskDate(x);
    const dayTasks = taskItems.value.filter((t) => taskDueDateKey(t) === date);
    cells.push({
      key: `${date}-${i}`,
      date,
      day: x.getDate(),
      inMonth: x.getMonth() === m,
      isToday: date === today,
      taskCount: dayTasks.length,
    });
  }
  return cells;
});

const taskYearMonths = computed(() => {
  const y = parseTaskAnchor().getFullYear();
  const yearTasks = filterTasksForView(taskStoreAll.value, `${y}-06-15`, "year");
  const months = [];
  for (let m = 0; m < 12; m++) {
    const prefix = `${y}-${String(m + 1).padStart(2, "0")}`;
    const inMonth = yearTasks.filter((t) => taskDueDateKey(t).startsWith(prefix));
    months.push({
      key: prefix,
      month: m + 1,
      label: `${m + 1}月`,
      count: inMonth.length,
      pending: inMonth.filter((t) => t.status !== "done").length,
    });
  }
  return months;
});

function tasksOnDate(dateStr) {
  return taskItems.value.filter((t) => taskDueDateKey(t) === dateStr);
}

function getMiniMonthCells(month) {
  const y = parseTaskAnchor().getFullYear();
  const first = new Date(y, month - 1, 1);
  const startPad = (first.getDay() + 6) % 7;
  const gridStart = new Date(y, month - 1, 1 - startPad);
  const today = formatTaskDate(new Date());
  const yearTasks = filterTasksForView(taskStoreAll.value, `${y}-06-15`, "year");
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const x = new Date(gridStart);
    x.setDate(gridStart.getDate() + i);
    const date = formatTaskDate(x);
    const inMonth = x.getMonth() === month - 1;
    const dayTasks = inMonth
      ? yearTasks.filter((t) => taskDueDateKey(t) === date)
      : [];
    cells.push({
      inMonth,
      isToday: date === today,
      hasTask: dayTasks.length > 0,
      allDone: dayTasks.length > 0 && dayTasks.every((t) => t.status === "done"),
    });
  }
  return cells;
}

function loadTaskNotifiedIds() {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(TASK_NOTIFIED_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function saveTaskNotifiedIds(set) {
  sessionStorage.setItem(TASK_NOTIFIED_KEY, JSON.stringify([...set]));
}

function notifyTaskReminder(task) {
  const ids = loadTaskNotifiedIds();
  if (ids.has(task.id)) return;
  ids.add(task.id);
  saveTaskNotifiedIds(ids);
  ElNotification({
    title: "任务提醒",
    message: `${task.title}\n截止：${task.due_at || ""}`,
    type: "warning",
    duration: 0,
    onClick: () => openTaskDialog(task),
  });
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    try {
      new Notification("任务提醒", { body: task.title });
    } catch {
      /* ignore */
    }
  }
}

async function pollTaskReminders() {
  const now = new Date();
  let changed = false;
  const next = taskStoreAll.value.map((t) => {
    if (t.status !== "pending" || t.reminded) return t;
    const remind = parseLocalDateTime(t.remind_at || t.due_at);
    if (remind > now) return t;
    changed = true;
    notifyTaskReminder(t);
    return {
      ...t,
      reminded: true,
      reminded_at: formatTaskDateTime(now),
      updated_at: formatTaskDateTime(now),
    };
  });
  if (changed) {
    taskStoreAll.value = next;
    persistTaskStore();
  }
}

function loadTasks() {
  taskLoading.value = true;
  syncTaskTodayLabel();
  loadTaskStoreFromCache();
  taskLoading.value = false;
}

function focusTaskOnCalendar(dueAt) {
  const dateKey = taskDueDateKey(dueAt);
  if (!dateKey) return;
  taskAnchor.value = dateKey;
}

function taskNav(delta) {
  const d = parseTaskAnchor();
  if (taskView.value === "day") d.setDate(d.getDate() + delta);
  else if (taskView.value === "week") d.setDate(d.getDate() + delta * 7);
  else if (taskView.value === "month") d.setMonth(d.getMonth() + delta);
  else d.setFullYear(d.getFullYear() + delta);
  taskAnchor.value = formatTaskDate(d);
}

function taskNavToday() {
  taskAnchor.value = formatTaskDate(new Date());
}

function drillTaskDay(dateStr) {
  taskAnchor.value = dateStr;
  taskView.value = "day";
}

function drillTaskMonth(month) {
  const d = parseTaskAnchor();
  taskAnchor.value = formatTaskDate(new Date(d.getFullYear(), month - 1, 1));
  taskView.value = "month";
}

function resetTaskForm() {
  taskEditingId.value = "";
  taskEditingSnapshot.value = null;
  taskFormTitle.value = "";
  taskFormContent.value = "";
  taskFormDue.value = "";
  taskFormRemind.value = "";
  taskFormBatchCreate.value = false;
  taskFormRecurrence.value = "none";
  taskFormWeekdays.value = [1, 2, 3, 4, 5];
  taskRemindSame.value = true;
}

function parseVirtualTaskId(id) {
  const m = /^virt:([^:]+):(\d{4}-\d{2}-\d{2})$/.exec(String(id || ""));
  if (!m) return null;
  return { seriesId: m[1], date: m[2] };
}

function openTaskDialog(task, presetDate) {
  resetTaskForm();
  taskEditingSnapshot.value = task || null;
  if (task) {
    taskEditingId.value = task.id;
    taskFormTitle.value = task.title || "";
    taskFormContent.value = task.content || "";
    taskFormDue.value = normalizeDueAtForApi(task.due_at || "");
    taskFormRemind.value = normalizeDueAtForApi(task.remind_at || "");
    taskRemindSame.value = !task.remind_at || task.remind_at === task.due_at;
    taskDuePickerDefault.value = parseLocalDateTime(taskFormDue.value);
    const master = task.is_series_master ? task : resolveSeriesMaster(task);
    const rec = master?.recurrence || task.recurrence;
    if (rec?.freq && rec.freq !== "none") {
      taskFormRecurrence.value = rec.freq === "weekly" ? "weekly" : rec.freq;
      taskFormWeekdays.value =
        rec.byweekday?.length > 0
          ? [...rec.byweekday]
          : [taskIsoWeekday(taskDueDateKey(task.due_at))];
    }
  } else {
    const base = presetDate || taskAnchor.value || formatTaskDate(new Date());
    taskFormDue.value = defaultTaskDueDatetime(base);
    taskDuePickerDefault.value = parseLocalDateTime(taskFormDue.value);
    taskFormWeekdays.value = [taskIsoWeekday(base)];
  }
  taskDialogVisible.value = true;
}

async function saveTask() {
  const content = taskFormContent.value.trim();
  if (!content) {
    ElMessage.warning("请粘贴或填写任务内容");
    return;
  }
  const dueAt = normalizeDueAtForApi(taskFormDue.value);
  if (!dueAt) {
    ElMessage.warning("请选择截止时间");
    return;
  }
  const remindAt = taskRemindSame.value
    ? dueAt
    : normalizeDueAtForApi(taskFormRemind.value) || dueAt;
  const anchorDate = taskDueDateKey(dueAt);
  const recurrence = buildRecurrencePayload(
    taskFormRecurrence.value,
    taskFormWeekdays.value,
    anchorDate
  );

  taskSaving.value = true;
  try {
    let saved;
    const virt = parseVirtualTaskId(taskEditingId.value);
    const editingTask =
      taskEditingSnapshot.value ||
      (taskEditingId.value
        ? taskStoreAll.value.find((t) => t.id === taskEditingId.value)
        : null);
    const editingSeriesId = virt?.seriesId || seriesIdOf(editingTask);
    const seriesMaster = editingSeriesId
      ? resolveSeriesMaster({ series_id: editingSeriesId, id: editingSeriesId })
      : null;

    if (seriesMaster && (virt || taskEditingId.value)) {
      if (!recurrence) {
        demoteSeriesToSingleTask(editingSeriesId, {
          content,
          title: taskFormTitle.value,
          dueAt,
          remindAt,
        });
        focusTaskOnCalendar(dueAt);
        taskDialogVisible.value = false;
        ElMessage.success("已改为单次任务");
        return;
      }
      applySeriesUpdate(editingSeriesId, {
        content,
        title: taskFormTitle.value,
        dueAt,
        remindAt,
        recurrence,
      });
      focusTaskOnCalendar(dueAt);
      taskDialogVisible.value = false;
      ElMessage.success("已同步到整个周期任务");
      return;
    }

    if (taskEditingId.value) {
      const idx = taskStoreAll.value.findIndex((t) => t.id === taskEditingId.value);
      if (idx < 0) throw new Error("任务不存在");
      const existing = taskStoreAll.value[idx];
      const applyRecurrence = existing.is_series_master || (!existing.series_id && recurrence);
      saved = buildTaskRecord({
        content,
        title: taskFormTitle.value,
        dueAt,
        remindAt,
        existing,
        recurrence: applyRecurrence ? recurrence : null,
      });
      if (existing.is_series_master && !recurrence) {
        saved.is_series_master = false;
        saved.series_id = null;
        saved.recurrence_skip_dates = [];
      }
      const copy = [...taskStoreAll.value];
      copy[idx] = saved;
      taskStoreAll.value = copy;
      persistTaskStore();
      focusTaskOnCalendar(saved.due_at);
      taskDialogVisible.value = false;
      ElMessage.success("已保存到本地");
      return;
    }

    if (taskFormBatchCreate.value) {
      const lines = splitBatchTaskLines(content);
      if (!lines.length) {
        ElMessage.warning("请至少填写一行任务内容");
        return;
      }
      const created = lines.map((line) =>
        buildTaskRecord({
          content: line,
          title: "",
          dueAt,
          remindAt,
          recurrence,
        })
      );
      taskStoreAll.value = [
        ...taskStoreAll.value.map(repairTaskRecord),
        ...created.map(repairTaskRecord),
      ];
      persistTaskStore();
      focusTaskOnCalendar(created[0].due_at);
      taskDialogVisible.value = false;
      ElMessage.success(`已批量创建 ${created.length} 条任务`);
      return;
    }

    saved = buildTaskRecord({
      content,
      title: taskFormTitle.value,
      dueAt,
      remindAt,
      recurrence,
    });
    taskStoreAll.value = [...taskStoreAll.value.map(repairTaskRecord), repairTaskRecord(saved)];
    persistTaskStore();
    focusTaskOnCalendar(saved.due_at);
    taskDialogVisible.value = false;
    ElMessage.success(recurrence ? "已创建周期任务" : "已保存到本地");
  } catch (e) {
    ElMessage.error(`保存失败: ${e.message || e}`);
  } finally {
    taskSaving.value = false;
  }
}

function splitBatchTaskLines(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

async function toggleTaskDone(task) {
  if (isVirtualTask(task)) {
    const date = taskDueDateKey(task);
    if (task.status === "done") return;
    materializeTaskOccurrence(task, date, { status: "done" });
    return;
  }
  const idx = taskStoreAll.value.findIndex((t) => t.id === task.id);
  if (idx < 0) return;
  const next = task.status === "done" ? "pending" : "done";
  const copy = [...taskStoreAll.value];
  copy[idx] = {
    ...copy[idx],
    status: next,
    updated_at: formatTaskDateTime(new Date()),
  };
  taskStoreAll.value = copy;
  persistTaskStore();
}

async function deleteTaskFromDialog() {
  let task = taskEditingSnapshot.value;
  if (!task && taskEditingId.value) {
    const virt = parseVirtualTaskId(taskEditingId.value);
    if (virt) {
      task = {
        id: taskEditingId.value,
        _virtual: true,
        series_id: virt.seriesId,
        title: taskFormTitle.value || "任务",
        due_at: taskFormDue.value,
      };
    } else {
      task = taskStoreAll.value.find((t) => t.id === taskEditingId.value) || null;
    }
  }
  if (!task) return;
  await deleteTaskItem(task);
  taskDialogVisible.value = false;
}

async function deleteTaskItem(task) {
  const seriesId = seriesIdOf(task);
  const inSeries = isSeriesTask(task);
  const msg = inSeries
    ? `删除整个周期任务「${task.title}」？所有重复日期上的安排将一并删除。`
    : `删除任务「${task.title}」？`;
  try {
    await ElMessageBox.confirm(msg, "确认", { type: "warning" });
  } catch {
    return;
  }
  if (inSeries && seriesId) {
    deleteSeriesById(seriesId);
  } else {
    taskStoreAll.value = taskStoreAll.value.filter((t) => t.id !== task.id);
    persistTaskStore();
  }
  ElMessage.success(inSeries ? "已删除整个周期任务" : "已删除");
}

function startTaskReminderPoll() {
  if (taskReminderPollTimer) return;
  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
  pollTaskReminders();
  taskReminderPollTimer = setInterval(pollTaskReminders, 30000);
}

function stopTaskReminderPoll() {
  if (taskReminderPollTimer) {
    clearInterval(taskReminderPollTimer);
    taskReminderPollTimer = null;
  }
}

function publishImageTokensPayload() {
  return publishImageTokensText.value
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function onPublishImageSelected(uploadFile) {
  if (!uploadFile || uploadFile.status !== "ready") return;
  const raw = uploadFile.raw;
  if (!raw) return;
  if (!String(raw.type || "").startsWith("image/")) {
    ElMessage.warning("仅支持图片文件");
    return;
  }
  if (publishAttachments.value.length >= publishAttachMax) {
    ElMessage.warning(`最多 ${publishAttachMax} 张附图`);
    return;
  }
  if (raw.size > 5 * 1024 * 1024) {
    ElMessage.warning("单张图片不能超过 5MB");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = String(reader.result || "");
    publishAttachments.value.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: raw.name || "image",
      previewUrl: URL.createObjectURL(raw),
      base64: dataUrl,
      mime: raw.type,
      size: raw.size,
    });
  };
  reader.onerror = () => ElMessage.error("读取图片失败");
  reader.readAsDataURL(raw);
}

function removePublishAttachment(id) {
  const idx = publishAttachments.value.findIndex((x) => x.id === id);
  if (idx < 0) return;
  const item = publishAttachments.value[idx];
  if (item.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(item.previewUrl);
  publishAttachments.value.splice(idx, 1);
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
    const images = publishImagesPayload();
    const imageTokens = publishImageTokensPayload();
    const body = {
      platform: publishPlatform.value,
      content: original || finalText,
      final_content: finalText,
      is_sign: publishIsSign.value,
      use_ai: publishUseAi.value,
    };
    if (images.length) body.images = images;
    if (imageTokens.length) body.image_tokens = imageTokens;
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
    const warn = (data.warnings || item.warnings || []).join(" ");
    if (warn) ElMessage.warning(warn);
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
  clearPublishAttachments();
  if (Array.isArray(h.attachments)) {
    for (const a of h.attachments) {
      publishAttachments.value.push({
        id: a.id || a.url,
        name: a.id || "image",
        previewUrl: publishMediaUrl(a.url),
        base64: "",
        mime: a.mime || "",
        size: a.size_bytes || 0,
        fromHistory: true,
      });
    }
  }
  publishImageTokensText.value = Array.isArray(h.image_tokens)
    ? h.image_tokens.join(", ")
    : "";
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

function formatScriptInterval(seconds) {
  const s = Number(seconds) || 0;
  if (s <= 0) return "-";
  if (s < 60) return `${s} 秒`;
  if (s < 3600) return `${Math.round(s / 60)} 分钟`;
  if (s < 86400) return `${(s / 3600).toFixed(1)} 小时`;
  return `${(s / 86400).toFixed(1)} 天`;
}

function canLoopScript(item) {
  const sch = item?.schedule || {};
  return sch.mode === "interval" && Number(sch.seconds) > 0;
}

function statusText(item) {
  if (item?.status === "running") return "运行中";
  if (item?.status === "error") return "异常";
  if (item?.schedule_enabled) return "循环中";
  return "待机";
}

function statusType(item) {
  if (item?.status === "running") return "warning";
  if (item?.status === "error") return "danger";
  if (item?.schedule_enabled) return "success";
  return "info";
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

async function startLoopTask(item) {
  if (!canLoopScript(item)) {
    ElMessage.warning("该脚本未配置有效的 interval 调度，无法循环执行");
    return;
  }
  const res = await fetch(`/api/scripts/${item.id}/enable`, { method: "POST" });
  if (!res.ok) {
    let data = null;
    try {
      data = await res.json();
    } catch {
      // ignore
    }
    ElMessage.error(data?.detail || "开启循环失败");
  } else {
    ElMessage.success(`已开启循环（间隔 ${formatScriptInterval(item.schedule?.seconds)}）`);
  }
  openDrawer(item);
  await loadCards();
}

async function stopLoopTask(item) {
  const res = await fetch(`/api/scripts/${item.id}/stop`, { method: "POST" });
  if (!res.ok) {
    let data = null;
    try {
      data = await res.json();
    } catch {
      // ignore
    }
    ElMessage.error(data?.detail || "关闭循环失败");
  } else {
    ElMessage.success("已关闭循环执行");
  }
  openDrawer(item);
  await loadCards();
}

async function pauseTask(item) {
  const res = await fetch(`/api/scripts/${item.id}/pause`, { method: "POST" });
  if (!res.ok) {
    let data = null;
    try {
      data = await res.json();
    } catch {
      // ignore
    }
    ElMessage.error(data?.detail || "暂停失败");
  } else {
    ElMessage.success("已暂停本次运行");
  }
  openDrawer(item);
  await loadCards();
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
  if (tab === "tasks") {
    syncTaskTodayLabel();
    if (!taskAnchor.value) taskAnchor.value = formatTaskDate(new Date());
    loadTasks();
    startTaskReminderPoll();
  } else {
    stopTaskReminderPoll();
  }
});

watch(publishPlatform, () => {
  if (mainTab.value === "publish") loadPublishHistory();
});

onMounted(() => {
  syncTaskTodayLabel();
  taskAnchor.value = formatTaskDate(new Date());
  loadTaskStoreFromCache();
  refreshAll();
  pollTimer = setInterval(() => loadCards(), 300000);
  startTaskReminderPoll();
  window.addEventListener("click", closeVideoContextMenu);
  window.addEventListener("scroll", closeVideoContextMenu, true);
  window.addEventListener("resize", closeVideoContextMenu);
});

onUnmounted(() => {
  detachImagePreviewPanListeners();
  clearPublishAttachments();
  stopTaskReminderPoll();
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

/* Timestripe-inspired calendar (Horizons) */
.ts-cal {
  --ts-bg: #f3f0eb;
  --ts-surface: #ffffff;
  --ts-accent: #e8643c;
  --ts-accent-soft: rgba(232, 100, 60, 0.12);
  --ts-text: #2c2a26;
  --ts-muted: #8a857c;
  --ts-line: rgba(44, 42, 38, 0.08);
  --ts-shadow: 0 1px 3px rgba(44, 42, 38, 0.06);
  margin: -4px -8px 0;
  padding: 0 4px 16px;
  border-radius: 12px;
  background: var(--ts-bg);
}
html.dark .ts-cal {
  --ts-bg: #1a1917;
  --ts-surface: #242220;
  --ts-accent: #f07a55;
  --ts-accent-soft: rgba(240, 122, 85, 0.15);
  --ts-text: #ece8e1;
  --ts-muted: #9a948a;
  --ts-line: rgba(255, 255, 255, 0.08);
  --ts-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
}
.ts-cal-header {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: 16px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--ts-line);
  background: var(--ts-surface);
  border-radius: 12px 12px 0 0;
  position: sticky;
  top: 0;
  z-index: 2;
}
@media (max-width: 900px) {
  .ts-cal-header {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto auto;
  }
  .ts-cal-title {
    grid-column: 1 / -1;
    text-align: center;
  }
}
.ts-cal-nav {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ts-icon-btn {
  width: 32px;
  height: 32px;
  border: 1px solid var(--ts-line);
  border-radius: 8px;
  background: var(--ts-surface);
  color: var(--ts-text);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}
.ts-icon-btn:hover {
  border-color: var(--ts-accent);
  color: var(--ts-accent);
}
.ts-today-btn {
  border: none;
  background: transparent;
  color: var(--ts-accent);
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  padding: 6px 10px;
  border-radius: 6px;
}
.ts-today-btn:hover {
  background: var(--ts-accent-soft);
}
.ts-cal-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: var(--ts-text);
  text-align: center;
  letter-spacing: 0.02em;
}
.ts-view-switch {
  display: inline-flex;
  padding: 3px;
  border-radius: 10px;
  background: var(--ts-bg);
  border: 1px solid var(--ts-line);
}
.ts-view-btn {
  border: none;
  background: transparent;
  color: var(--ts-muted);
  font-size: 13px;
  font-weight: 600;
  padding: 6px 14px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
}
.ts-view-btn.active {
  background: var(--ts-surface);
  color: var(--ts-text);
  box-shadow: var(--ts-shadow);
}
.ts-view-btn:hover:not(.active) {
  color: var(--ts-text);
}
.ts-cal-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ts-local-hint {
  font-size: 11px;
  color: var(--ts-muted);
  padding: 2px 8px;
  border-radius: 6px;
  background: var(--ts-bg);
  border: 1px solid var(--ts-line);
}
.ts-add-btn {
  border-radius: 10px !important;
  font-weight: 600;
}
.ts-cal-body {
  min-height: calc(100vh - 220px);
  padding: 12px;
}

/* Day horizon */
.ts-day {
  max-width: 720px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ts-day-hero {
  background: var(--ts-surface);
  border-radius: 16px;
  padding: 24px 28px;
  box-shadow: var(--ts-shadow);
  border: 1px solid var(--ts-line);
}
.ts-day-hero.is-today {
  border-color: var(--ts-accent);
  box-shadow: 0 0 0 1px var(--ts-accent-soft);
}
.ts-day-hero-weekday {
  font-size: 14px;
  color: var(--ts-muted);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.ts-day-hero-date {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-top: 4px;
}
.ts-day-hero-num {
  font-size: 56px;
  font-weight: 700;
  line-height: 1;
  color: var(--ts-text);
}
.ts-day-hero.is-today .ts-day-hero-num {
  color: var(--ts-accent);
}
.ts-day-hero-meta {
  font-size: 16px;
  color: var(--ts-muted);
}
.ts-day-hero-stat {
  margin-top: 12px;
  font-size: 13px;
  color: var(--ts-muted);
}
.ts-inline-add {
  border: 1px dashed var(--ts-line);
  background: var(--ts-surface);
  color: var(--ts-muted);
  border-radius: 12px;
  padding: 12px 16px;
  text-align: left;
  cursor: pointer;
  font-size: 14px;
}
.ts-inline-add:hover {
  border-color: var(--ts-accent);
  color: var(--ts-accent);
}
.ts-empty {
  text-align: center;
  color: var(--ts-muted);
  padding: 48px 16px;
  font-size: 14px;
}
.ts-task-card {
  display: flex;
  gap: 12px;
  background: var(--ts-surface);
  border: 1px solid var(--ts-line);
  border-radius: 14px;
  padding: 14px 16px;
  box-shadow: var(--ts-shadow);
  transition: transform 0.12s, box-shadow 0.12s;
}
.ts-task-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(44, 42, 38, 0.08);
}
.ts-task-card.done {
  opacity: 0.65;
}
.ts-task-check input {
  width: 18px;
  height: 18px;
  margin-top: 4px;
  accent-color: var(--ts-accent);
  cursor: pointer;
}
.ts-task-main {
  flex: 1;
  min-width: 0;
  cursor: pointer;
}
.ts-task-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.ts-task-time {
  font-size: 12px;
  color: var(--ts-muted);
  font-weight: 600;
}
.ts-task-ops {
  display: flex;
  gap: 10px;
}
.ts-link {
  border: none;
  background: none;
  color: var(--ts-muted);
  font-size: 12px;
  cursor: pointer;
  padding: 0;
}
.ts-link:hover {
  color: var(--ts-accent);
}
.ts-link.danger:hover {
  color: #d14343;
}
.ts-task-title {
  margin: 6px 0 8px;
  font-size: 16px;
  font-weight: 600;
  color: var(--ts-text);
}
.ts-task-card.done .ts-task-title {
  text-decoration: line-through;
}
.ts-task-body {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13px;
  line-height: 1.6;
  color: var(--ts-muted);
  font-family: inherit;
  max-height: 280px;
  overflow-y: auto;
}

/* Week horizons — signature Timestripe columns */
.ts-week-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ts-drag-hint {
  margin: 0;
  font-size: 12px;
  color: var(--ts-muted);
}
.ts-week {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 10px;
  min-height: calc(100vh - 260px);
  align-items: stretch;
}
@media (max-width: 1100px) {
  .ts-week {
    grid-template-columns: repeat(2, 1fr);
    min-height: auto;
  }
}
@media (max-width: 600px) {
  .ts-week {
    grid-template-columns: 1fr;
  }
}
.ts-week-col {
  display: flex;
  flex-direction: column;
  background: var(--ts-surface);
  border-radius: 14px;
  border: 1px solid var(--ts-line);
  min-height: 320px;
  overflow: hidden;
}
.ts-week-col.today {
  border-color: var(--ts-accent);
  box-shadow: 0 0 0 1px var(--ts-accent-soft);
}
.ts-week-head {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 14px 8px 10px;
  border: none;
  border-bottom: 1px solid var(--ts-line);
  background: transparent;
  cursor: pointer;
  width: 100%;
}
.ts-week-head:hover {
  background: var(--ts-accent-soft);
}
.ts-week-wd {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--ts-muted);
}
.ts-week-col.today .ts-week-wd {
  color: var(--ts-accent);
}
.ts-week-num {
  font-size: 28px;
  font-weight: 700;
  line-height: 1;
  color: var(--ts-text);
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}
.ts-week-num.ring {
  background: var(--ts-accent);
  color: #fff;
}
.ts-week-stack {
  flex: 1;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  min-height: 100px;
}
.ts-week-pill {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--ts-accent-soft);
  border-left: 3px solid var(--ts-accent);
  cursor: grab;
  transition: background 0.12s;
}
.ts-week-pill:active {
  cursor: grabbing;
}
.ts-week-pill.recurring {
  border-left-color: #3d8bfd;
}
.ts-pill-copy {
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--ts-muted);
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
  cursor: pointer;
  opacity: 0.6;
}
.ts-pill-copy:hover {
  opacity: 1;
  color: var(--ts-accent);
}
.ts-pill-del {
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--ts-muted);
  font-size: 16px;
  line-height: 1;
  padding: 0 2px;
  cursor: pointer;
  opacity: 0.55;
}
.ts-pill-del:hover {
  opacity: 1;
  color: #d14343;
}
.ts-recur-dot {
  margin-left: 4px;
  font-size: 10px;
  color: #3d8bfd;
}
.ts-recur-tag {
  margin-left: 6px;
  font-size: 10px;
  color: #3d8bfd;
  font-weight: 600;
}
.ts-series-hint {
  margin-bottom: 12px;
}
.ts-task-dialog-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.ts-task-dialog-footer-spacer {
  flex: 1;
}
.ts-weekday-group {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin-top: 10px;
}
.ts-task-card.recurring {
  border-left: 3px solid #3d8bfd;
}
.ts-week-pill:hover {
  background: rgba(232, 100, 60, 0.18);
}
.ts-week-pill.done {
  background: var(--ts-bg);
  border-left-color: var(--ts-muted);
  opacity: 0.7;
}
.ts-pill-check {
  margin-top: 2px;
  accent-color: var(--ts-accent);
  cursor: pointer;
}
.ts-pill-text {
  min-width: 0;
  flex: 1;
}
.ts-pill-time {
  display: block;
  font-size: 10px;
  color: var(--ts-muted);
  font-weight: 600;
}
.ts-pill-title {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--ts-text);
  line-height: 1.35;
  word-break: break-word;
}
.ts-week-pill.done .ts-pill-title {
  text-decoration: line-through;
}
.ts-week-add {
  margin-top: auto;
  border: none;
  background: transparent;
  color: var(--ts-muted);
  font-size: 12px;
  padding: 8px;
  text-align: center;
  cursor: pointer;
  border-radius: 8px;
}
.ts-week-add:hover {
  background: var(--ts-bg);
  color: var(--ts-accent);
}

/* Month helicopter view */
.ts-month {
  background: var(--ts-surface);
  border-radius: 14px;
  border: 1px solid var(--ts-line);
  padding: 12px;
  box-shadow: var(--ts-shadow);
}
.ts-month-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  text-align: center;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--ts-muted);
  padding-bottom: 8px;
}
.ts-month-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 6px;
}
.ts-month-cell {
  min-height: 100px;
  border-radius: 10px;
  padding: 6px;
  background: var(--ts-bg);
  border: 1px solid transparent;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  transition: border-color 0.12s, background 0.12s;
}
.ts-month-cell:hover {
  border-color: var(--ts-line);
  background: var(--ts-surface);
}
.ts-month-cell.muted {
  opacity: 0.35;
}
.ts-month-cell.today {
  border-color: var(--ts-accent);
  background: var(--ts-accent-soft);
}
.ts-month-cell.has-tasks {
  background: var(--ts-surface);
}
.ts-month-cell-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.ts-month-day {
  font-size: 13px;
  font-weight: 700;
  color: var(--ts-text);
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}
.ts-month-day.ring {
  background: var(--ts-accent);
  color: #fff;
}
.ts-month-badge {
  font-size: 10px;
  font-weight: 700;
  color: var(--ts-accent);
  background: var(--ts-accent-soft);
  padding: 2px 6px;
  border-radius: 8px;
}
.ts-month-bars {
  margin-top: 4px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  overflow: hidden;
}
.ts-month-bar {
  font-size: 10px;
  line-height: 1.3;
  padding: 3px 6px;
  border-radius: 4px;
  background: var(--ts-accent-soft);
  color: var(--ts-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border-left: 2px solid var(--ts-accent);
}
.ts-month-bar.done {
  opacity: 0.55;
  text-decoration: line-through;
  border-left-color: var(--ts-muted);
}

/* Year overview */
.ts-year {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
@media (max-width: 1100px) {
  .ts-year {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 600px) {
  .ts-year {
    grid-template-columns: 1fr;
  }
}
.ts-year-card {
  background: var(--ts-surface);
  border: 1px solid var(--ts-line);
  border-radius: 14px;
  padding: 14px 16px;
  cursor: pointer;
  transition: border-color 0.15s, transform 0.12s;
  box-shadow: var(--ts-shadow);
}
.ts-year-card:hover {
  border-color: var(--ts-accent);
  transform: translateY(-2px);
}
.ts-year-card-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 10px;
}
.ts-year-name {
  font-size: 18px;
  font-weight: 700;
  color: var(--ts-text);
}
.ts-year-meta {
  font-size: 11px;
  color: var(--ts-muted);
}
.ts-year-mini {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 3px;
}
.ts-year-dot {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 2px;
  background: var(--ts-bg);
}
.ts-year-dot.dim {
  opacity: 0.25;
}
.ts-year-dot.busy {
  background: var(--ts-accent-soft);
}
.ts-year-dot.busy.done {
  background: var(--ts-line);
}
.ts-year-dot.today {
  box-shadow: inset 0 0 0 1px var(--ts-accent);
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
.publish-attach-section {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--el-border-color-lighter);
}
.publish-attach-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 10px;
}
.publish-attach-title {
  font-weight: 600;
  font-size: 13px;
}
.publish-attach-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.publish-attach-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 10px;
}
.publish-image-tokens {
  flex: 1;
  min-width: 220px;
  max-width: 420px;
}
.publish-upload-plus {
  font-size: 22px;
  line-height: 1;
  color: var(--el-text-color-secondary);
}
.publish-attach-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.publish-attach-item {
  position: relative;
  width: 96px;
}
.publish-attach-thumb {
  width: 96px;
  height: 96px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid var(--el-border-color);
  cursor: zoom-in;
  display: block;
  background: var(--el-fill-color-dark);
}
.publish-attach-remove {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  cursor: pointer;
  font-size: 16px;
  line-height: 20px;
}
.publish-attach-name {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.publish-preview-images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
.publish-preview-thumb {
  width: 72px;
  height: 72px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--el-border-color);
  cursor: zoom-in;
}
.publish-history-thumbs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}
.publish-history-thumb {
  width: 48px;
  height: 48px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid var(--el-border-color);
}
</style>
