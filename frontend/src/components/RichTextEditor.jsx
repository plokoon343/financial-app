import React, { useRef, useEffect, useCallback } from 'react';

// Lightweight, dependency-free visual editor (contentEditable + a formatting toolbar).
// Emits HTML via onChange. Deliberately limited to email-safe formatting: bold/italic/
// underline, headings, lists, links, a few colours, email-safe font families + sizes.
// Fancy web fonts don't render reliably in Gmail/Outlook, so we don't offer them.

const FONTS = [
  { label: 'Default', value: '' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times', value: "'Times New Roman', Times, serif" },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Courier', value: "'Courier New', Courier, monospace" },
];
const COLORS = ['#0b1326', '#0f6e56', '#139DA0', '#d97706', '#dc2626', '#6d28d9', '#6b7280'];

export default function RichTextEditor({ value, onChange, disabled }) {
  const ref = useRef(null);
  const lastHtml = useRef(value || '');

  // Seed the editor once, and reflect external resets (e.g. after send) without
  // clobbering the caret while the user is typing.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement !== el && (value || '') !== el.innerHTML) {
      el.innerHTML = value || '';
      lastHtml.current = value || '';
    }
  }, [value]);

  const emit = useCallback(() => {
    const html = ref.current?.innerHTML || '';
    lastHtml.current = html;
    onChange && onChange(html);
  }, [onChange]);

  // execCommand is deprecated-but-universally-supported; perfect for a small internal
  // editor whose output only needs to be email HTML.
  const cmd = (command, arg) => {
    if (disabled) return;
    ref.current?.focus();
    document.execCommand(command, false, arg);
    emit();
  };
  const block = (tag) => cmd('formatBlock', tag);
  const link = () => {
    const url = window.prompt('Link URL (include https://)');
    if (url) cmd('createLink', /^https?:\/\//i.test(url) ? url : `https://${url}`);
  };

  const Btn = ({ title, onClick, children }) => (
    <button type="button" className="rte-btn" title={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick} disabled={disabled}>{children}</button>
  );

  return (
    <div className={`rte ${disabled ? 'rte-disabled' : ''}`}>
      <div className="rte-toolbar">
        <Btn title="Bold" onClick={() => cmd('bold')}><b>B</b></Btn>
        <Btn title="Italic" onClick={() => cmd('italic')}><i>I</i></Btn>
        <Btn title="Underline" onClick={() => cmd('underline')}><u>U</u></Btn>
        <span className="rte-sep" />
        <Btn title="Heading" onClick={() => block('H2')}>H1</Btn>
        <Btn title="Subheading" onClick={() => block('H3')}>H2</Btn>
        <Btn title="Normal text" onClick={() => block('P')}>¶</Btn>
        <span className="rte-sep" />
        <Btn title="Bulleted list" onClick={() => cmd('insertUnorderedList')}>• List</Btn>
        <Btn title="Numbered list" onClick={() => cmd('insertOrderedList')}>1. List</Btn>
        <Btn title="Add link" onClick={link}><i className="fas fa-link"></i></Btn>
        <span className="rte-sep" />
        <select className="rte-select" title="Font" disabled={disabled} onChange={(e) => { if (e.target.value) cmd('fontName', e.target.value); e.target.selectedIndex = 0; }} defaultValue="">
          {FONTS.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
        </select>
        <select className="rte-select" title="Size" disabled={disabled} onChange={(e) => { if (e.target.value) cmd('fontSize', e.target.value); e.target.selectedIndex = 0; }} defaultValue="">
          <option value="">Size</option>
          <option value="2">Small</option>
          <option value="3">Normal</option>
          <option value="5">Large</option>
          <option value="6">Huge</option>
        </select>
        <span className="rte-colors">
          {COLORS.map((c) => (
            <button key={c} type="button" className="rte-color" title={`Text colour ${c}`} style={{ background: c }} onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('foreColor', c)} disabled={disabled} />
          ))}
        </span>
      </div>
      <div
        ref={ref}
        className="rte-area"
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={emit}
        onBlur={emit}
        data-placeholder="Write your newsletter here — use the toolbar to format."
      />

      <style jsx="true">{`
        .rte { border: 1px solid var(--border-color, #e2e8f0); border-radius: var(--radius-md, 8px); overflow: hidden; background: var(--bg-card, #fff); }
        .rte-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 8px; border-bottom: 1px solid var(--border-color, #e2e8f0); background: var(--glass-bg, #f8fafc); }
        .rte-btn { min-width: 30px; height: 30px; padding: 0 8px; border: 1px solid var(--border-color, #e2e8f0); background: var(--bg-card, #fff); color: var(--text-primary, #1a365d); border-radius: 6px; cursor: pointer; font-size: 0.85rem; }
        .rte-btn:hover { border-color: var(--accent-primary, #139DA0); }
        .rte-btn:disabled { opacity: 0.5; cursor: default; }
        .rte-sep { width: 1px; height: 22px; background: var(--border-color, #e2e8f0); margin: 0 4px; }
        .rte-select { height: 30px; border: 1px solid var(--border-color, #e2e8f0); border-radius: 6px; background: var(--bg-card, #fff); color: var(--text-primary, #1a365d); font-size: 0.8rem; padding: 0 4px; }
        .rte-colors { display: inline-flex; gap: 3px; align-items: center; margin-left: 2px; }
        .rte-color { width: 20px; height: 20px; border-radius: 50%; border: 1px solid rgba(0,0,0,0.15); cursor: pointer; padding: 0; }
        .rte-area { min-height: 240px; max-height: 460px; overflow-y: auto; padding: 14px 16px; color: var(--text-primary, #1a365d); font-size: 1rem; line-height: 1.6; outline: none; }
        .rte-area:empty:before { content: attr(data-placeholder); color: var(--text-secondary, #94a3b8); }
        .rte-area h2 { font-size: 1.4rem; margin: 0.6em 0 0.3em; }
        .rte-area h3 { font-size: 1.15rem; margin: 0.6em 0 0.3em; }
        .rte-area a { color: var(--accent-primary, #139DA0); }
        .rte-area ul, .rte-area ol { padding-left: 1.4em; }
        .rte-disabled { opacity: 0.7; }
      `}</style>
    </div>
  );
}
