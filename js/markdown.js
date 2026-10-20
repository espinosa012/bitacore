/**
 * vg-task-manager: Markdown editor (EasyMDE) and helpers
 *
 * Wraps the vendored EasyMDE editor (vendor/easymde, MIT) with the app's look:
 * SVG toolbar icons (no Font Awesome download), sanitized previews (DOMPurify)
 * and plain-text excerpts for cards.
 */
(function() {
  window.VG = window.VG || {};

  const svg = (path) => `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="${path}"/></svg>`;

  const ICONS = {
    bold: svg('M15.6 10.79c.97-.67 1.65-1.77 1.65-2.79 0-2.26-1.75-4-4-4H7v14h7.04c2.09 0 3.71-1.7 3.71-3.79 0-1.52-.86-2.82-2.15-3.42zM10 6.5h3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-3v-3zm3.5 9H10v-3h3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z'),
    italic: svg('M10 4v3h2.21l-3.42 8H6v3h8v-3h-2.21l3.42-8H18V4z'),
    strikethrough: svg('M10 19h4v-3h-4v3zM5 4v3h5v3h4V7h5V4H5zM3 14h18v-2H3v2z'),
    heading: svg('M5 4v3h5.5v12h3V7H19V4z'),
    quote: svg('M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z'),
    unorderedList: svg('M4 10.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5 1.5-.67 1.5-1.5-.67-1.5-1.5-1.5zm0-6c-.83 0-1.5.67-1.5 1.5S3.17 7.5 4 7.5 5.5 6.83 5.5 6 4.83 4.5 4 4.5zm0 12c-.83 0-1.5.68-1.5 1.5s.68 1.5 1.5 1.5 1.5-.68 1.5-1.5-.67-1.5-1.5-1.5zM7 19h14v-2H7v2zm0-6h14v-2H7v2zm0-8v2h14V5H7z'),
    orderedList: svg('M2 17h2v.5H3v1h1v.5H2v1h3v-4H2v1zm1-9h1V4H2v1h1v3zm-1 3h1.8L2 13.1v.9h3v-1H3.2L5 10.9V10H2v1zm5-6v2h14V5H7zm0 14h14v-2H7v2zm0-6h14v-2H7v2z'),
    checklist: svg('M22 7h-9v2h9V7zm0 8h-9v2h9v-2zM5.54 11L2 7.46l1.41-1.41 2.12 2.12 4.24-4.24 1.41 1.41L5.54 11zm0 8L2 15.46l1.41-1.41 2.12 2.12 4.24-4.24 1.41 1.41L5.54 19z'),
    code: svg('M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z'),
    link: svg('M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z'),
    table: svg('M3 3v18h18V3H3zm8 16H5v-6h6v6zm0-8H5V5h6v6zm8 8h-6v-6h6v6zm0-8h-6V5h6v6z'),
    rule: svg('M4 11h16v2H4z'),
    preview: svg('M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z'),
    sideBySide: svg('M3 5v14h18V5H3zm8 12H5V7h6v10zm8 0h-6V7h6v10z'),
    fullscreen: svg('M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z'),
    undo: svg('M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z'),
    redo: svg('M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z')
  };

  function insertChecklist(editor) {
    const cm = editor.codemirror;
    const from = cm.getCursor('from');
    const to = cm.getCursor('to');
    for (let line = from.line; line <= to.line; line++) {
      const text = cm.getLine(line);
      if (!/^\s*[-*] \[[ xX]\] /.test(text)) {
        cm.replaceRange('- [ ] ', { line, ch: 0 });
      }
    }
    cm.focus();
  }

  function buildToolbar(opts) {
    const options = typeof opts === 'boolean' ? { full: opts } : (opts || {});
    const E = window.EasyMDE;
    const item = (name, action, title, icon, extra = {}) => ({ name, action, title, icon, className: `vg-md-${name}`, ...extra });

    if (options.compact) {
      return [
        item('bold', E.toggleBold, 'Bold (Ctrl/Cmd+B)', ICONS.bold),
        item('italic', E.toggleItalic, 'Italic (Ctrl/Cmd+I)', ICONS.italic),
        '|',
        item('quote', E.toggleBlockquote, 'Quote', ICONS.quote),
        item('unordered-list', E.toggleUnorderedList, 'Bulleted list', ICONS.unorderedList),
        '|',
        item('code', E.toggleCodeBlock, 'Code', ICONS.code),
        item('link', E.drawLink, 'Link (Ctrl/Cmd+K)', ICONS.link),
        '|',
        item('preview', E.togglePreview, 'Toggle preview (Ctrl/Cmd+P)', ICONS.preview, { noDisable: true })
      ];
    }

    const tools = [
      item('bold', E.toggleBold, 'Bold (Ctrl/Cmd+B)', ICONS.bold),
      item('italic', E.toggleItalic, 'Italic (Ctrl/Cmd+I)', ICONS.italic),
      item('strikethrough', E.toggleStrikethrough, 'Strikethrough', ICONS.strikethrough),
      item('heading', E.toggleHeadingSmaller, 'Heading (Ctrl/Cmd+H)', ICONS.heading),
      '|',
      item('quote', E.toggleBlockquote, 'Quote', ICONS.quote),
      item('unordered-list', E.toggleUnorderedList, 'Bulleted list', ICONS.unorderedList),
      item('ordered-list', E.toggleOrderedList, 'Numbered list', ICONS.orderedList),
      item('checklist', insertChecklist, 'Checklist', ICONS.checklist),
      '|',
      item('code', E.toggleCodeBlock, 'Code', ICONS.code),
      item('link', E.drawLink, 'Link (Ctrl/Cmd+K)', ICONS.link),
      item('table', E.drawTable, 'Table', ICONS.table),
      item('horizontal-rule', E.drawHorizontalRule, 'Horizontal rule', ICONS.rule),
      '|',
      item('preview', E.togglePreview, 'Toggle preview (Ctrl/Cmd+P)', ICONS.preview, { noDisable: true })
    ];
    if (options.full) {
      // Side-by-side and fullscreen use position: fixed, which breaks inside
      // transformed modals, so they are only offered on the task page.
      tools.push(
        item('side-by-side', E.toggleSideBySide, 'Side by side (F9)', ICONS.sideBySide, { noDisable: true, noMobile: true }),
        item('fullscreen', E.toggleFullScreen, 'Fullscreen (F11)', ICONS.fullscreen, { noDisable: true, noMobile: true }),
        '|',
        item('undo', E.undo, 'Undo', ICONS.undo, { noDisable: true }),
        item('redo', E.redo, 'Redo', ICONS.redo, { noDisable: true })
      );
    }
    return tools;
  }

  let purifyConfigured = false;
  function sanitize(html) {
    if (!window.DOMPurify) {
      // Never render unsanitized HTML: fall back to escaped source
      return `<pre>${window.VG.Constants.escapeHtml(html)}</pre>`;
    }
    if (!purifyConfigured) {
      purifyConfigured = true;
      // Links in previews open outside the app
      window.DOMPurify.addHook('afterSanitizeAttributes', (node) => {
        if (node.tagName === 'A' && node.getAttribute('href')) {
          node.setAttribute('target', '_blank');
          node.setAttribute('rel', 'noopener noreferrer');
        }
      });
    }
    return window.DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  }

  let rendererInstance = null;
  function getRenderer() {
    if (rendererInstance) return rendererInstance;
    if (window.EasyMDE) {
      rendererInstance = {
        options: {
          renderingConfig: {
            singleLineBreaks: true,
            codeSyntaxHighlighting: false,
            sanitizerFunction: sanitize
          }
        }
      };
    }
    return rendererInstance;
  }

  /**
   * Renders a markdown string to sanitized HTML.
   * @param {string} md
   * @returns {string} sanitized HTML
   */
  function render(md) {
    if (!md || !String(md).trim()) return '';
    const text = String(md);
    if (window.EasyMDE && window.EasyMDE.prototype && window.EasyMDE.prototype.markdown) {
      try {
        const rawHtml = window.EasyMDE.prototype.markdown.call(getRenderer(), text);
        if (rawHtml) {
          if (typeof DOMParser !== 'undefined') {
            const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
            const bodyContent = doc.body ? doc.body.innerHTML : rawHtml;
            return sanitize(bodyContent);
          }
          return sanitize(rawHtml);
        }
      } catch (err) {
        console.warn('Error parsing markdown:', err);
      }
    }
    return sanitize(`<p>${window.VG.Constants ? window.VG.Constants.escapeHtml(text) : text}</p>`);
  }

  /**
   * Turns a <textarea> into a markdown editor.
   * @param {HTMLTextAreaElement} textarea
   * @param {{ full?: boolean, compact?: boolean, minHeight?: string, placeholder?: string, onSubmit?: (editor: any) => void }} options
   */
  function createEditor(textarea, options = {}) {
    if (!textarea) return null;
    if (!window.EasyMDE) {
      console.warn('EasyMDE is not loaded: falling back to a plain textarea.');
      return null;
    }

    const defaultMinHeight = options.compact ? '85px' : '140px';
    const editor = new window.EasyMDE({
      element: textarea,
      autoDownloadFontAwesome: false,
      spellChecker: false,
      nativeSpellcheck: true,
      status: false,
      forceSync: true,
      minHeight: options.minHeight || defaultMinHeight,
      placeholder: options.placeholder || textarea.getAttribute('placeholder') || '',
      toolbar: buildToolbar(options),
      toolbarTips: true,
      sideBySideFullscreen: false,
      indentWithTabs: false,
      tabSize: 2,
      renderingConfig: {
        singleLineBreaks: true,
        codeSyntaxHighlighting: false,
        sanitizerFunction: sanitize
      },
      shortcuts: {
        // Ctrl/Cmd+Enter belongs to "save", never to an editor action
        toggleSideBySide: options.full ? 'F9' : null,
        toggleFullScreen: options.full ? 'F11' : null
      }
    });

    if (options.compact && editor.element && editor.element.nextSibling) {
      const container = editor.element.nextSibling;
      if (container && container.classList) {
        container.classList.add('vg-editor-compact');
      }
    }

    if (options.onSubmit && editor.codemirror) {
      editor.codemirror.setOption('extraKeys', Object.assign({}, editor.codemirror.getOption('extraKeys'), {
        'Ctrl-Enter': () => options.onSubmit(editor),
        'Cmd-Enter': () => options.onSubmit(editor)
      }));
    }

    return editor;
  }

  /** Sets an editor's (or fallback textarea's) value and re-measures it once visible */
  function setValue(editor, textarea, value) {
    if (editor) {
      if (editor.isPreviewActive()) window.EasyMDE.togglePreview(editor);
      editor.value(value || '');
      setTimeout(() => editor.codemirror.refresh(), 60);
      editor.codemirror.clearHistory();
    } else if (textarea) {
      textarea.value = value || '';
    }
  }

  function getValue(editor, textarea) {
    if (editor) return editor.value();
    return textarea ? textarea.value : '';
  }

  /** Markdown source to a compact plain-text excerpt (cards, search) */
  function toPlainText(md) {
    return String(md || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s*>\s?/gm, '')
      .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '')
      .replace(/^\s*([-*+]|\d+\.)\s+/gm, '')
      .replace(/^\s*([-*_]\s*){3,}$/gm, '')
      .replace(/(\*\*|__|~~)(.*?)\1/g, '$2')
      .replace(/(\*|_)(.*?)\1/g, '$2')
      .replace(/\|/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  window.VG.Markdown = {
    createEditor,
    setValue,
    getValue,
    sanitize,
    render,
    toPlainText
  };
})();
