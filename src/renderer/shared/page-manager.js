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

  function getActivePage() {
    return activePage;
  }

  function bind() {
    navButtons.forEach((button) => {
      button.addEventListener("click", () => {
        setActivePage(button.dataset.pageTarget);
      });
    });
  }

  return {
    bind,
    getActivePage,
    setActivePage,
  };
}

export { createPageManager };
