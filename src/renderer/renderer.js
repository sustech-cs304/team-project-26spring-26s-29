import { createBlackboardController } from "./blackboard/controller.js";
import { createChatController } from "./chat/controller.js";
import { createConfigController } from "./config/controller.js";
import { elements } from "./shared/dom.js";
import { applyDocumentTranslations, createI18n } from "./shared/i18n.mjs";
import { createTodoController } from "./todo/controller.js";
import { createScheduleController } from "./schedule/controller.js";

const FOREGROUND_REFRESH_COOLDOWN_MS = 300;
const i18n = createI18n("zh-CN");

function createPageManager({ navButtons, pages, onPageChange }) {
  let activePage = null;

  function setActivePage(pageName) {
    activePage = pageName;

    navButtons.forEach((button) => {
      const isActive = button.dataset.pageTarget === pageName;
      button.classList.toggle("is-active", isActive);
      if (isActive) {
        button.setAttribute("aria-current", "page");
        return;
      }

      button.removeAttribute("aria-current");
    });

    pages.forEach((page) => {
      const isActive = page.dataset.page === pageName;
      page.classList.toggle("is-active", isActive);
      page.hidden = !isActive;
    });

    if (typeof onPageChange === "function") {
      onPageChange(pageName);
    }
  }

  return {
    bind() {
      navButtons.forEach((button) => {
        button.addEventListener("click", () => {
          setActivePage(button.dataset.pageTarget);
        });
      });
    },
    getActivePage() {
      return activePage;
    },
    setActivePage,
  };
}

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
  i18n,
});

const configController = createConfigController({
  configForm: elements.configForm,
  configFields: elements.configFields,
  configFeedback: elements.configFeedback,
  discard: elements.discard,
  saveConfigButton: elements.saveConfigButton,
  i18n,
  onSaved: async (saved) => {
    setAppLanguage(saved?.appLanguage);
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
  i18n,
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
  scheduleToggleCreateButton: elements.scheduleToggleCreateButton,
  scheduleFeedback: elements.scheduleFeedback,
  scheduleList: elements.scheduleList,
  i18n,
});

const blackboardController = createBlackboardController({
  applyAllButton: elements.blackboardApplyAll,
  clearButton: elements.blackboardClear,
  dismissAllButton: elements.blackboardDismissAll,
  empty: elements.blackboardEmpty,
  loginButton: elements.blackboardLogin,
  loginFeedback: elements.blackboardLoginFeedback,
  loginForm: elements.blackboardLoginForm,
  meta: elements.blackboardMeta,
  openPageButton: elements.blackboardOpenPage,
  passwordInput: elements.blackboardPassword,
  rememberPasswordInput: elements.blackboardRememberPassword,
  statusText: elements.blackboardStatusText,
  suggestionList: elements.blackboardSuggestionList,
  summary: elements.blackboardSummary,
  usernameInput: elements.blackboardUsername,
  syncButton: elements.blackboardSync,
  syncFeedback: elements.blackboardSyncFeedback,
  i18n,
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
  if (activePage === "blackboard") {
    await blackboardController.refreshOnForeground();
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

function setAppLanguage(language) {
  i18n.setLocale(language);
  applyDocumentTranslations(i18n);
  chatController.refreshTranslations();
  configController.refreshTranslations();
  todoController.refreshTranslations();
  scheduleController.refreshTranslations();
  blackboardController.refreshTranslations();
}

const pageManager = createPageManager({
  navButtons: elements.navButtons,
  pages: elements.pages,
  onPageChange: (pageName) => {
    if (pageName === "blackboard") {
      void blackboardController.refreshOnForeground();
      return;
    }

    queueForegroundRefresh();
  },
});

chatController.init();
configController.init();
todoController.init();
scheduleController.init();
blackboardController.init();
pageManager.bind();

window.addEventListener("focus", handleWindowFocus);
document.addEventListener("visibilitychange", handleVisibilityChange);

(async function initialize() {
  const config = await configController.loadConfig();
  setAppLanguage(config?.appLanguage);
  await chatController.refreshStatus();
  await todoController.loadOnStartup();
  await scheduleController.loadOnStartup();
  await blackboardController.loadOnStartup();
  pageManager.setActivePage("chat");
  chatController.scrollToBottom(true);
})();

setInterval(() => {
  void chatController.refreshStatus();
}, 2000);
