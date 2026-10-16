/**
 * vg-task-manager: Fomantic-UI helpers (toasts, modals and dialogs)
 *
 * Dialogs return Promises and replace the browser's alert/confirm/prompt,
 * so they match the rest of the interface.
 */
(function() {
  window.VG = window.VG || {};
  const $ = window.jQuery;

  const escapeHtml = (str) => window.VG.Constants.escapeHtml(str);

  const TOAST_CLASSES = { success: 'success', error: 'error', warning: 'warning', info: 'info' };

  function toast(message, type = 'info', duration = 3500) {
    $.toast({
      message,
      class: TOAST_CLASSES[type] || 'info',
      showIcon: true,
      position: 'bottom right',
      displayTime: duration,
      showProgress: 'bottom',
      closeIcon: duration > 5000
    });
  }

  /* -------------------------------------------------------------
   * MODALS
   * ------------------------------------------------------------- */

  /** Initializes a static modal from the page with the app's defaults */
  function initModal(el, options = {}) {
    $(el).modal({
      allowMultiple: true,
      autofocus: false,
      duration: 250,
      ...options
    });
  }

  function showModal(el) {
    $(el).modal('show');
  }

  function hideModal(el) {
    $(el).modal('hide');
  }

  function isModalVisible(el) {
    return !!el && el.classList.contains('visible') && el.classList.contains('active');
  }

  function isAnyModalVisible() {
    return !!document.querySelector('.ui.modal.visible.active');
  }

  /* -------------------------------------------------------------
   * DIALOGS
   * ------------------------------------------------------------- */

  /**
   * Builds a throwaway modal and resolves with the value of the button used.
   * @param {{ title: string, content: string, buttons: Array<{text: string, value: any, cls: string}>, onShow?: Function, readValue?: Function }} spec
   */
  function dialog(spec) {
    return new Promise((resolve) => {
      let result = spec.dismissValue;
      const el = document.createElement('div');
      el.className = `ui ${spec.size || 'tiny'} inverted modal vg-dialog`;
      el.innerHTML = `
        <div class="header">${escapeHtml(spec.title)}</div>
        <div class="content">${spec.content}</div>
        <div class="actions">
          ${spec.buttons.map((b, i) => `<button type="button" class="ui ${b.cls} button" data-index="${i}">${escapeHtml(b.text)}</button>`).join('')}
        </div>
      `;
      document.body.appendChild(el);

      const finish = (button) => {
        result = button.value === 'read' && spec.readValue ? spec.readValue(el) : button.value;
        $(el).modal('hide');
      };

      el.querySelectorAll('[data-index]').forEach(btn => {
        btn.addEventListener('click', () => finish(spec.buttons[Number(btn.dataset.index)]));
      });
      const form = el.querySelector('form');
      if (form) {
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          finish(spec.buttons.find(b => b.value === 'read') || spec.buttons[spec.buttons.length - 1]);
        });
      }

      $(el).modal({
        allowMultiple: true,
        autofocus: false,
        closable: true,
        duration: 200,
        onVisible: () => {
          const focusTarget = el.querySelector('input, textarea') || el.querySelector('.actions .button:last-child');
          if (focusTarget) focusTarget.focus();
          if (spec.onShow) spec.onShow(el);
        },
        onHidden: () => {
          $(el).remove();
          resolve(result);
        }
      }).modal('show');
    });
  }

  function confirmDialog(message, { title = 'Are you sure?', okText = 'OK', danger = false } = {}) {
    return dialog({
      title,
      content: `<p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>`,
      dismissValue: false,
      buttons: [
        { text: 'Cancel', value: false, cls: 'basic inverted' },
        { text: okText, value: true, cls: danger ? 'red' : 'primary' }
      ]
    });
  }

  function alertDialog(message, { title = 'Notice' } = {}) {
    return dialog({
      title,
      content: `<p class="vg-dialog-message">${escapeHtml(message)}</p>`,
      dismissValue: true,
      buttons: [{ text: 'OK', value: true, cls: 'primary' }]
    });
  }

  /**
   * Small form dialog. Resolves with { name: value } or null when cancelled.
   * @param {string} title
   * @param {Array<{name: string, label: string, value?: string, placeholder?: string, multiline?: boolean}>} fields
   */
  function formDialog(title, fields, { okText = 'Save' } = {}) {
    const content = `
      <form class="ui inverted form">
        ${fields.map(f => `
          <div class="field">
            <label>${escapeHtml(f.label)}</label>
            ${f.multiline
              ? `<textarea name="${escapeHtml(f.name)}" rows="3" placeholder="${escapeHtml(f.placeholder || '')}">${escapeHtml(f.value || '')}</textarea>`
              : `<input type="text" name="${escapeHtml(f.name)}" value="${escapeHtml(f.value || '')}" placeholder="${escapeHtml(f.placeholder || '')}" autocomplete="off">`}
          </div>`).join('')}
      </form>
    `;
    return dialog({
      title,
      content,
      dismissValue: null,
      buttons: [
        { text: 'Cancel', value: null, cls: 'basic inverted' },
        { text: okText, value: 'read', cls: 'primary' }
      ],
      readValue: (el) => {
        const values = {};
        fields.forEach(f => { values[f.name] = el.querySelector(`[name="${CSS.escape(f.name)}"]`).value; });
        return values;
      }
    });
  }

  window.VG.UI = {
    toast,
    dialog,
    initModal,
    showModal,
    hideModal,
    isModalVisible,
    isAnyModalVisible,
    confirm: confirmDialog,
    alert: alertDialog,
    form: formDialog
  };
})();
