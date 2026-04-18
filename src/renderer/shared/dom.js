const $ = (id) => document.getElementById(id);

const elements = {
  configFeedback: $("config-feedback"),
  configFields: $("config-fields"),
  configForm: $("config-form"),
  discard: $("discard"),
  messages: $("messages"),
  navButtons: Array.from(document.querySelectorAll("[data-page-target]")),
  pages: Array.from(document.querySelectorAll("[data-page]")),
  prompt: $("prompt"),
  saveConfigButton: $("save-config"),
  scrollToBottomButton: $("scroll-to-bottom"),
  send: $("send"),
  status: $("status"),
  todoClearAll: $("todo-clear-all"),
  todoClearCompleted: $("todo-clear-completed"),
  todoCreateForm: $("todo-create-form"),
  todoDetailInput: $("todo-detail-input"),
  todoDueInput: $("todo-due-input"),
  todoEmpty: $("todo-empty"),
  todoFeedback: $("todo-feedback"),
  todoFilterButtons: Array.from(document.querySelectorAll("[data-todo-filter]")),
  todoList: $("todo-list"),
  todoSearchInput: $("todo-search-input"),
  todoSortSelect: $("todo-sort-select"),
  todoTitleInput: $("todo-title-input"),
  todoUndoBar: $("todo-undo-bar"),
  todoUndoButton: $("todo-undo-button"),
  todoUndoText: $("todo-undo-text"),
};

export { $, elements };
