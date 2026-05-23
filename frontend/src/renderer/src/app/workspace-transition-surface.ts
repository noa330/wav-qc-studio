export function createWorkspaceTransitionSurfaceHtml(cardElement: HTMLElement): string {
  const shell = cardElement.cloneNode(true);
  if (!(shell instanceof HTMLElement)) {
    return "";
  }

  copyCurrentFormValues(cardElement, shell);
  shell.classList.add("workspace-transition-shell");
  shell.classList.remove("workspace-panel-card", "will-change-transform");
  sanitizeWorkspaceTransitionShell(shell);

  return shell.outerHTML;
}

function copyCurrentFormValues(originalRoot: HTMLElement, shellRoot: HTMLElement): void {
  const originalFields = Array.from(originalRoot.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input,textarea,select"));
  const shellFields = Array.from(shellRoot.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input,textarea,select"));

  shellFields.forEach((field, index) => {
    const original = originalFields[index];
    if (!original) {
      return;
    }

    if (field instanceof HTMLInputElement && original instanceof HTMLInputElement) {
      field.value = original.value;
      field.setAttribute("value", original.value);
      if (original.checked) {
        field.setAttribute("checked", "");
      } else {
        field.removeAttribute("checked");
      }
      return;
    }

    if (field instanceof HTMLTextAreaElement && original instanceof HTMLTextAreaElement) {
      field.value = original.value;
      field.textContent = original.value;
      return;
    }

    if (field instanceof HTMLSelectElement && original instanceof HTMLSelectElement) {
      field.value = original.value;
      Array.from(field.options).forEach((option) => {
        option.selected = option.value === original.value;
      });
    }
  });
}

function sanitizeWorkspaceTransitionShell(shell: HTMLElement): void {
  shell.querySelectorAll("script,style,[data-column-resize-handle],[data-row-resize-handle]").forEach((element) => element.remove());
  [shell, ...Array.from(shell.querySelectorAll<HTMLElement>("*"))].forEach((element) => {
    element.removeAttribute("id");
    element.removeAttribute("data-workspace-card-layout-id");
    element.removeAttribute("data-collapse-mode");
    element.removeAttribute("data-app-tour-target");
    element.removeAttribute("data-app-tour-panel-id");
    element.removeAttribute("data-app-tour-panel-kind");
    element.removeAttribute("data-app-tour-panel-region");
    element.removeAttribute("data-app-tour-panel-tools");
    element.removeAttribute("contenteditable");
    element.removeAttribute("tabindex");
    element.removeAttribute("autofocus");
  });
}
