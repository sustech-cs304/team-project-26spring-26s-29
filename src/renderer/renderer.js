import { createChatController } from "./chat/controller.js";
import { createConfigController } from "./config/controller.js";
import { elements } from "./shared/dom.js";
import { createPageManager } from "./shared/page-manager.js";
import { createTodoController } from "./todo/controller.js";
import { createScheduleController } from "./schedule/controller.js";

const FOREGROUND_REFRESH_COOLDOWN_MS = 300;

const chatController = createChatController({
  attachmentButton: elements.attachmentButton,
  attachments: elements.attachments,
  alwaysApproveToolsButton: elements.alwaysApproveToolsButton,
  interruptRunButton: elements.interruptRunButton,
  prompt: elements.prompt,
  send: elements.send,
  status: elements.status,
  messages: elements.messages,
  previewModal: elements.previewModal,
  previewModalBody: elements.previewModalBody,
  previewModalClose: elements.previewModalClose,
  previewModalCopy: elements.previewModalCopy,
  previewModalLabel: elements.previewModalLabel,
  previewModalMeta: elements.previewModalMeta,
  previewModalSave: elements.previewModalSave,
  previewModalTitle: elements.previewModalTitle,
  scrollToBottomButton: elements.scrollToBottomButton,
});

const configController = createConfigController({
  configForm: elements.configForm,
  configFields: elements.configFields,
  configFeedback: elements.configFeedback,
  discard: elements.discard,
  saveConfigButton: elements.saveConfigButton,
  onSaved: async () => {
    await chatController.refreshStatus();
  },
});

const todoController = createTodoController({
  todoCreateForm: elements.todoCreateForm,
  todoTitleInput: elements.todoTitleInput,
  todoDetailInput: elements.todoDetailInput,
  todoDueInput: elements.todoDueInput,
  todoList: elements.todoList,
  todoEmpty: elements.todoEmpty,
  todoFeedback: elements.todoFeedback,
  todoClearCompleted: elements.todoClearCompleted,
  todoClearAll: elements.todoClearAll,
  todoSearchInput: elements.todoSearchInput,
  todoSortSelect: elements.todoSortSelect,
  todoUndoBar: elements.todoUndoBar,
  todoUndoText: elements.todoUndoText,
  todoUndoButton: elements.todoUndoButton,
  todoFilterButtons: elements.todoFilterButtons,
});

const scheduleController = createScheduleController({
  scheduleCalendar: elements.scheduleCalendar,
  scheduleCurrentMonth: elements.scheduleCurrentMonth,
  schedulePrev: elements.schedulePrev,
  scheduleNext: elements.scheduleNext,
  scheduleCreateForm: elements.scheduleCreateForm,
  scheduleTitleInput: elements.scheduleTitleInput,
  scheduleStartInput: elements.scheduleStartInput,
  scheduleEndInput: elements.scheduleEndInput,
  scheduleDetailInput: elements.scheduleDetailInput,
  scheduleCreateButton: elements.scheduleCreateButton,
  scheduleFeedback: elements.scheduleFeedback,
  scheduleList: elements.scheduleList,
});

let foregroundRefreshInFlight = null;
let lastForegroundRefreshAt = 0;

async function refreshActivePageOnForeground() {
  if (document.hidden) {
    return;
  }

  await chatController.refreshStatus();

  const activePage = pageManager.getActivePage();
  if (activePage === "todo") {
    await todoController.refreshOnForeground();
    return;
  }

  if (activePage === "config") {
    await configController.refreshOnForeground();
  }
  if (activePage === "schedule") {
    await scheduleController.refreshOnForeground();
  }
}

function queueForegroundRefresh() {
  if (document.hidden) {
    return;
  }

  const now = Date.now();
  if (foregroundRefreshInFlight || now - lastForegroundRefreshAt < FOREGROUND_REFRESH_COOLDOWN_MS) {
    return;
  }

  foregroundRefreshInFlight = (async () => {
    try {
      await refreshActivePageOnForeground();
    } finally {
      lastForegroundRefreshAt = Date.now();
      foregroundRefreshInFlight = null;
    }
  })();
}

function handleWindowFocus() {
  queueForegroundRefresh();
}

function handleVisibilityChange() {
  if (document.hidden) {
    return;
  }

  queueForegroundRefresh();
}

const pageManager = createPageManager({
  navButtons: elements.navButtons,
  pages: elements.pages,
  onPageChange: () => {
    queueForegroundRefresh();
  },
});

chatController.init();
configController.init();
todoController.init();
scheduleController.init();
pageManager.bind();

window.addEventListener("focus", handleWindowFocus);
document.addEventListener("visibilitychange", handleVisibilityChange);

(async function initialize() {
  await configController.loadConfig();
  await chatController.refreshStatus();
  await todoController.loadOnStartup();
  await scheduleController.loadOnStartup();
  pageManager.setActivePage("chat");
  chatController.scrollToBottom(true);
})();

setInterval(() => {
  void chatController.refreshStatus();
}, 2000);
