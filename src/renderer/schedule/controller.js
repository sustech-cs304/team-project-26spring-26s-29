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
  scheduleCreateButton,
  scheduleFeedback,
  scheduleList,
}) {
  const scheduleState = {
    items: [],
    currentMonth: new Date(),
    selectedDate: null,
    editingId: null,
    isBusy: false,
  };

  function parseScheduleId(rawId) {
    const parsed = Number.parseInt(String(rawId), 10);
    return Number.isInteger(parsed) ? parsed : null;
  }

  function normalizeScheduleItem(raw) {
    const parsedId = parseScheduleId(raw?.id);
    if (parsedId === null) {
      throw new Error("Invalid schedule id returned from backend.");
    }

    return {
      id: parsedId,
      title: String(raw?.title ?? ""),
      detail: String(raw?.detail ?? ""),
      start_at: raw?.startAt ?? raw?.start_at,
      end_at: raw?.endAt ?? raw?.end_at,
      all_day: Boolean(raw?.allDay ?? raw?.all_day),
      is_done: Boolean(raw?.isDone ?? raw?.is_done ?? false),
      completed_at: raw?.completedAt ?? raw?.completed_at ?? null,
      recurrence: raw?.recurrence ?? null,
      location: raw?.location ?? null,
      created_at: String(raw?.createdAt ?? raw?.created_at ?? ""),
      updated_at: String(raw?.updatedAt ?? raw?.updated_at ?? ""),
    };
  }

  function monthRangeFor(date) {
    const y = date.getFullYear();
    const m = date.getMonth();
    const start = new Date(Date.UTC(y, m, 1, 0, 0, 0));
    const end = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0));
    return { start: start.toISOString(), end: end.toISOString() };
  }

  async function loadSchedulesForMonth(date) {
    scheduleState.isBusy = true;
    renderScheduleFeedback("Loading events...", "pending");
    try {
      const range = monthRangeFor(date);
      const payload = await window.scheduleAPI.listRange(range.start, range.end);
      scheduleState.items = Array.isArray(payload) ? payload.map(normalizeScheduleItem) : [];
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
      btn.setAttribute("aria-label", cellDate.toLocaleDateString());

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
      scheduleCurrentMonth.textContent = scheduleState.currentMonth.toLocaleString(undefined, { month: "long", year: "numeric" });
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
            <button class="button" data-schedule-action="save-edit" data-schedule-id="${ev.id}" type="button">Save</button>
            <button class="button button--secondary" data-schedule-action="cancel-edit" data-schedule-id="${ev.id}" type="button">Cancel</button>
          </div>
        </div>
      `;
        return item;
      }

      const checked = ev.is_done ? 'checked' : '';
      const doneClass = ev.is_done ? 'is-done' : '';

      item.innerHTML = `
      <div class="todo-item__main">
        <label class="todo-check ${doneClass}" aria-label="Mark done">
          <input data-schedule-action="toggle" data-schedule-id="${ev.id}" type="checkbox" ${checked} />
          <span class="todo-check__text">Done</span>
        </label>
        <div class="todo-item__content">
          <p class="todo-item__title">${escapeHtml(ev.title)}</p>
          <p class="todo-item__detail">${escapeHtml(ev.detail || "No detail")}</p>
          <p class="todo-item__meta">${escapeHtml(formatDateTime(ev.start_at))} — ${escapeHtml(formatDateTime(ev.end_at))}</p>
        </div>
      </div>
      <div class="todo-item__actions todo-item__actions--stacked">
        <button class="button button--secondary" data-schedule-action="edit" data-schedule-id="${ev.id}" type="button">Edit</button>
        <button class="button button--secondary" data-schedule-action="delete" data-schedule-id="${ev.id}" type="button">Delete</button>
      </div>
    `;

      return item;
    });

    scheduleList.replaceChildren(...nodes);
  }

  async function handleScheduleCreate(event) {
    event.preventDefault();
    if (scheduleState.isBusy) return;

    const title = scheduleTitleInput.value.trim();
    if (!title) {
      renderScheduleFeedback("Title is required.", "error");
      return;
    }

    const start = fromDateTimeLocalValue(scheduleStartInput.value);
    const end = fromDateTimeLocalValue(scheduleEndInput.value);

    try {
      await window.scheduleAPI.create({
        title,
        detail: scheduleDetailInput.value.trim(),
        startAt: start,
        endAt: end,
        allDay: false,
      });
      scheduleCreateForm.reset();
      await loadSchedulesForMonth(scheduleState.currentMonth);
      renderScheduleFeedback("Event added.", "success");
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
        renderScheduleFeedback("Invalid schedule id.", "error");
        return;
      }

      try {
        await window.scheduleAPI.remove(id);
        await loadSchedulesForMonth(scheduleState.currentMonth);
        renderScheduleFeedback("Event deleted.", "success");
      } catch (error) {
        renderScheduleFeedback(error?.message || String(error), "error");
      }
      return;
    }

    if (scheduleState.isBusy) return;

    if (action === "edit") {
      if (id === null) {
        renderScheduleFeedback("Invalid schedule id.", "error");
        return;
      }
      scheduleState.editingId = id;
      renderScheduleFeedback("Editing event...", "pending");
      renderScheduleDay(scheduleState.selectedDate || scheduleState.currentMonth);
      return;
    }

    if (action === "cancel-edit") {
      scheduleState.editingId = null;
      renderScheduleFeedback("Edit cancelled.", "");
      renderScheduleDay(scheduleState.selectedDate || scheduleState.currentMonth);
      return;
    }

    if (action === "save-edit") {
      if (id === null) {
        renderScheduleFeedback("Invalid schedule id.", "error");
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
        renderScheduleFeedback("Title is required.", "error");
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
        renderScheduleFeedback("Event updated.", "success");
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
      renderScheduleFeedback("Invalid schedule id.", "error");
      return;
    }

    const checked = Boolean(toggle.checked);

    try {
      await window.scheduleAPI.update(id, { isDone: checked });
      await loadSchedulesForMonth(scheduleState.currentMonth);
      renderScheduleFeedback(checked ? "Event marked done." : "Event marked active.", "success");
    } catch (error) {
      renderScheduleFeedback(error?.message || String(error), "error");
    }
  }

  function init() {
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
    scheduleList?.addEventListener("click", handleScheduleListClick);
    scheduleList?.addEventListener("change", handleScheduleListChange);
  }

  async function loadOnStartup() {
    await loadSchedulesForMonth(scheduleState.currentMonth).catch(() => {});
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

  return {
    init,
    loadOnStartup,
    refreshOnForeground,
  };
}

export { createScheduleController };
