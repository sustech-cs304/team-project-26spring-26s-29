import {
  formatDateTime,
  fromDateTimeLocalValue,
  toDateTimeLocalValue,
} from "../shared/datetime.js";
import { escapeHtml } from "../shared/html.js";

function createScheduleController({
  scheduleCalendar,
  scheduleCurrentMonth,
  schedulePrev,
  scheduleNext,
  scheduleCreateForm,
  scheduleTitleInput,
  scheduleStartInput,
  scheduleEndInput,
  scheduleDetailInput,
  scheduleToggleCreateButton,
  scheduleFeedback,
  scheduleList,
  i18n,
}) {
  const scheduleState = {
    items: [],
    currentMonth: new Date(),
    selectedDate: null,
    editingId: null,
    isBusy: false,
    isCreatePanelOpen: false,
  };

  function t(key, params) {
    return i18n.t(key, params);
  }

  function syncCreatePanelVisibility() {
    if (!scheduleCreateForm) {
      return;
    }

    scheduleCreateForm.hidden = !scheduleState.isCreatePanelOpen;
    if (!scheduleToggleCreateButton) {
      return;
    }

    scheduleToggleCreateButton.hidden = false;
    scheduleToggleCreateButton.textContent = scheduleState.isCreatePanelOpen
      ? t("schedule.hideAdd")
      : t("schedule.add");
    scheduleToggleCreateButton.setAttribute(
      "aria-expanded",
      String(scheduleState.isCreatePanelOpen)
    );
  }

  function parseScheduleId(rawId) {
    const parsed = Number.parseInt(String(rawId), 10);
    return Number.isInteger(parsed) ? parsed : null;
  }

  async function loadSchedulesForMonth(date) {
    scheduleState.isBusy = true;
    renderScheduleFeedback(t("schedule.feedback.loading"), "pending");
    try {
      const rangeStart = new Date(Date.UTC(date.getFullYear(), date.getMonth(), 1, 0, 0, 0));
      const rangeEnd = new Date(Date.UTC(date.getFullYear(), date.getMonth() + 1, 1, 0, 0, 0));
      const payload = await window.scheduleAPI.listRange(rangeStart.toISOString(), rangeEnd.toISOString());
      scheduleState.items = Array.isArray(payload)
        ? payload.map((raw) => {
          const parsedId = parseScheduleId(raw?.id);
          if (parsedId === null) {
            throw new Error(t("schedule.error.invalidReturnedId"));
          }

          return {
            id: parsedId,
            title: String(raw?.title ?? ""),
            detail: String(raw?.detail ?? ""),
            start_at: raw?.startAt,
            end_at: raw?.endAt,
            all_day: Boolean(raw?.allDay),
            is_done: Boolean(raw?.isDone ?? false),
            completed_at: raw?.completedAt ?? null,
            recurrence: raw?.recurrence ?? null,
            location: raw?.location ?? null,
            created_at: String(raw?.createdAt ?? ""),
            updated_at: String(raw?.updatedAt ?? ""),
          };
        })
        : [];
      scheduleState.currentMonth = new Date(date.getFullYear(), date.getMonth(), 1);
      renderScheduleCalendar();
      if (scheduleState.selectedDate) {
        renderScheduleDay(scheduleState.selectedDate);
      }
      renderScheduleFeedback("", "");
    } catch (error) {
      renderScheduleFeedback(error?.message || String(error), "error");
    } finally {
      scheduleState.isBusy = false;
    }
  }

  function renderScheduleFeedback(message = "", state = "") {
    if (!scheduleFeedback) return;
    scheduleFeedback.textContent = message;
    if (state) {
      scheduleFeedback.dataset.state = state;
      return;
    }
    delete scheduleFeedback.dataset.state;
  }

  function eventsForDay(date) {
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    return scheduleState.items.filter((ev) => {
      const s = new Date(ev.start_at);
      const e = new Date(ev.end_at);
      return e > dayStart && s < dayEnd;
    });
  }

  function renderScheduleCalendar() {
    if (!scheduleCalendar) return;
    const year = scheduleState.currentMonth.getFullYear();
    const month = scheduleState.currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const startIndex = firstDay.getDay();
    const totalCells = 42;

    const cells = [];
    for (let i = 0; i < totalCells; i += 1) {
      const dayNumber = i - startIndex + 1;
      const cellDate = new Date(year, month, dayNumber);
      const inMonth = dayNumber > 0 && cellDate.getMonth() === month;
      const events = inMonth ? eventsForDay(cellDate) : [];

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "calendar-day-btn";
      btn.dataset.day = `${cellDate.getFullYear()}-${String(cellDate.getMonth() + 1).padStart(2, "0")}-${String(cellDate.getDate()).padStart(2, "0")}`;
      btn.setAttribute("aria-label", cellDate.toLocaleDateString(i18n.locale));

      if (!inMonth) {
        btn.disabled = true;
        btn.classList.add("is-disabled");
      } else {
        btn.textContent = String(cellDate.getDate());
      }

      if (events.length) {
        const badge = document.createElement("span");
        badge.className = "calendar-badge";
        badge.textContent = String(events.length);
        btn.appendChild(badge);
      }

      if (scheduleState.selectedDate) {
        const sel = scheduleState.selectedDate;
        if (
          sel.getFullYear() === cellDate.getFullYear() &&
          sel.getMonth() === cellDate.getMonth() &&
          sel.getDate() === cellDate.getDate()
        ) {
          btn.classList.add("is-selected");
        }
      }

      btn.addEventListener("click", () => {
        scheduleState.selectedDate = new Date(cellDate.getFullYear(), cellDate.getMonth(), cellDate.getDate());
        renderScheduleCalendar();
        renderScheduleDay(scheduleState.selectedDate);
      });

      cells.push(btn);
    }

    scheduleCalendar.replaceChildren(...cells);
    if (scheduleCurrentMonth) {
      scheduleCurrentMonth.textContent = scheduleState.currentMonth.toLocaleString(i18n.locale, { month: "long", year: "numeric" });
    }
  }

  function renderScheduleDay(date) {
    if (!scheduleList) return;
    const day = date || scheduleState.selectedDate || scheduleState.currentMonth;
    const items = eventsForDay(new Date(day.getFullYear(), day.getMonth(), day.getDate()));

    const nodes = items.map((ev) => {
      const item = document.createElement("li");
      item.className = "todo-item";

      if (scheduleState.editingId === ev.id) {
        item.innerHTML = `
        <div class="todo-edit-grid">
          <input class="todo-input" data-schedule-edit="title" type="text" value="${escapeHtml(ev.title)}" />
          <input class="todo-input" data-schedule-edit="startAt" type="datetime-local" value="${toDateTimeLocalValue(ev.start_at)}" />
          <input class="todo-input" data-schedule-edit="endAt" type="datetime-local" value="${toDateTimeLocalValue(ev.end_at)}" />
          <textarea class="todo-input todo-input--textarea" data-schedule-edit="detail" rows="2">${escapeHtml(ev.detail || "")}</textarea>
          <div class="todo-item__actions">
            <button class="button" data-schedule-action="save-edit" data-schedule-id="${ev.id}" type="button">${escapeHtml(t("schedule.save"))}</button>
            <button class="button button--secondary" data-schedule-action="cancel-edit" data-schedule-id="${ev.id}" type="button">${escapeHtml(t("schedule.cancel"))}</button>
          </div>
        </div>
      `;
        return item;
      }

      const checked = ev.is_done ? 'checked' : '';
      const doneClass = ev.is_done ? 'is-done' : '';

      item.innerHTML = `
      <div class="todo-item__main">
        <label class="todo-check ${doneClass}" aria-label="${escapeHtml(t("schedule.markDone"))}">
          <input data-schedule-action="toggle" data-schedule-id="${ev.id}" type="checkbox" ${checked} />
          <span class="todo-check__text">${escapeHtml(t("schedule.done"))}</span>
        </label>
        <div class="todo-item__content">
          <p class="todo-item__title">${escapeHtml(ev.title)}</p>
          <p class="todo-item__detail">${escapeHtml(ev.detail || t("schedule.noDetail"))}</p>
          <p class="todo-item__meta">${escapeHtml(formatDateTime(ev.start_at, i18n.locale))} — ${escapeHtml(formatDateTime(ev.end_at, i18n.locale))}</p>
        </div>
      </div>
      <div class="todo-item__actions todo-item__actions--stacked">
        <button class="button button--secondary" data-schedule-action="edit" data-schedule-id="${ev.id}" type="button">${escapeHtml(t("schedule.edit"))}</button>
        <button class="button button--secondary" data-schedule-action="delete" data-schedule-id="${ev.id}" type="button">${escapeHtml(t("schedule.delete"))}</button>
      </div>
    `;

      return item;
    });

    scheduleList.replaceChildren(...nodes);
  }

  async function handleScheduleCreate(event) {
    event.preventDefault();
    if (scheduleState.isBusy) return;

    const start = fromDateTimeLocalValue(scheduleStartInput.value);
    const end = fromDateTimeLocalValue(scheduleEndInput.value);

    try {
      await window.scheduleAPI.create({
        title: scheduleTitleInput.value.trim(),
        detail: scheduleDetailInput.value.trim(),
        startAt: start,
        endAt: end,
        allDay: false,
      });
      scheduleCreateForm.reset();
      await loadSchedulesForMonth(scheduleState.currentMonth);
      renderScheduleFeedback(t("schedule.feedback.added"), "success");
    } catch (error) {
      renderScheduleFeedback(error?.message || String(error), "error");
    }
  }

  async function handleScheduleListClick(event) {
    const actionTarget = event.target.closest("[data-schedule-action]");
    if (!actionTarget) return;

    const action = actionTarget.dataset.scheduleAction;
    const id = parseScheduleId(actionTarget.dataset.scheduleId);
    if (action === "delete") {
      if (id === null) {
        renderScheduleFeedback(t("schedule.error.invalidId"), "error");
        return;
      }

      try {
        await window.scheduleAPI.remove(id);
        await loadSchedulesForMonth(scheduleState.currentMonth);
        renderScheduleFeedback(t("schedule.feedback.deleted"), "success");
      } catch (error) {
        renderScheduleFeedback(error?.message || String(error), "error");
      }
      return;
    }

    if (scheduleState.isBusy) return;

    if (action === "edit") {
      if (id === null) {
        renderScheduleFeedback(t("schedule.error.invalidId"), "error");
        return;
      }
      scheduleState.editingId = id;
      renderScheduleFeedback(t("schedule.feedback.editing"), "pending");
      renderScheduleDay(scheduleState.selectedDate || scheduleState.currentMonth);
      return;
    }

    if (action === "cancel-edit") {
      scheduleState.editingId = null;
      renderScheduleFeedback(t("schedule.feedback.editCancelled"), "");
      renderScheduleDay(scheduleState.selectedDate || scheduleState.currentMonth);
      return;
    }

    if (action === "save-edit") {
      if (id === null) {
        renderScheduleFeedback(t("schedule.error.invalidId"), "error");
        return;
      }

      const item = actionTarget.closest(".todo-item");
      if (!item) return;

      const titleInput = item.querySelector('[data-schedule-edit="title"]');
      const detailInput = item.querySelector('[data-schedule-edit="detail"]');
      const startInput = item.querySelector('[data-schedule-edit="startAt"]');
      const endInput = item.querySelector('[data-schedule-edit="endAt"]');

      const nextTitle = titleInput?.value.trim() || "";
      if (!nextTitle) {
        renderScheduleFeedback(t("schedule.feedback.titleRequired"), "error");
        return;
      }

      const nextDetail = detailInput?.value.trim() || "";
      const nextStart = fromDateTimeLocalValue(startInput?.value || "");
      const nextEnd = fromDateTimeLocalValue(endInput?.value || "");

      try {
        await window.scheduleAPI.update(id, {
          title: nextTitle,
          detail: nextDetail,
          startAt: nextStart,
          endAt: nextEnd,
        });
        scheduleState.editingId = null;
        await loadSchedulesForMonth(scheduleState.currentMonth);
        renderScheduleFeedback(t("schedule.feedback.updated"), "success");
      } catch (error) {
        renderScheduleFeedback(error?.message || String(error), "error");
      }
      return;
    }
  }

  async function handleScheduleListChange(event) {
    const toggle = event.target.closest('[data-schedule-action="toggle"]');
    if (!toggle || scheduleState.isBusy) return;

    const id = parseScheduleId(toggle.dataset.scheduleId);
    if (id === null) {
      renderScheduleFeedback(t("schedule.error.invalidId"), "error");
      return;
    }

    const checked = Boolean(toggle.checked);

    try {
      await window.scheduleAPI.update(id, { isDone: checked });
      await loadSchedulesForMonth(scheduleState.currentMonth);
      renderScheduleFeedback(checked ? t("schedule.feedback.markedDone") : t("schedule.feedback.markedActive"), "success");
    } catch (error) {
      renderScheduleFeedback(error?.message || String(error), "error");
    }
  }

  function init() {
    syncCreatePanelVisibility();

    schedulePrev?.addEventListener("click", async () => {
      if (scheduleState.isBusy) return;
      const nextMonth = new Date(scheduleState.currentMonth.getFullYear(), scheduleState.currentMonth.getMonth() - 1, 1);
      await loadSchedulesForMonth(nextMonth);
    });

    scheduleNext?.addEventListener("click", async () => {
      if (scheduleState.isBusy) return;
      const nextMonth = new Date(scheduleState.currentMonth.getFullYear(), scheduleState.currentMonth.getMonth() + 1, 1);
      await loadSchedulesForMonth(nextMonth);
    });

    scheduleCreateForm?.addEventListener("submit", handleScheduleCreate);
    scheduleToggleCreateButton?.addEventListener("click", () => {
      scheduleState.isCreatePanelOpen = !scheduleState.isCreatePanelOpen;
      syncCreatePanelVisibility();
    });
    scheduleList?.addEventListener("click", handleScheduleListClick);
    scheduleList?.addEventListener("change", handleScheduleListChange);
  }

  async function loadOnStartup() {
    await loadSchedulesForMonth(scheduleState.currentMonth).catch(() => { });
  }

  async function refreshOnForeground() {
    if (document.hidden) return;
    scheduleState.isBusy = true;
    try {
      await loadSchedulesForMonth(scheduleState.currentMonth);
    } finally {
      scheduleState.isBusy = false;
    }
  }

  function refreshTranslations() {
    syncCreatePanelVisibility();
    renderScheduleCalendar();
    renderScheduleDay(scheduleState.selectedDate || scheduleState.currentMonth);
  }

  return {
    init,
    loadOnStartup,
    refreshOnForeground,
    refreshTranslations,
  };
}

export { createScheduleController };
