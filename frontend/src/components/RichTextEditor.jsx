import React, { useRef, useEffect, useCallback } from 'react';

// Lightweight, dependency-free visual editor (contentEditable + a formatting toolbar).
// Emits HTML via onChange. Deliberately limited to email-safe formatting: bold/italic/
// underline, headings, lists, links, a few colours, email-safe font families + sizes.
// Fancy web fonts don't render reliably in Gmail/Outlook, so we don't offer them.

const FONTS = [
  { label: 'Default', value: '' },
  { label: 'Poppins', value: "'Poppins', Arial, sans-serif" },
  { label: 'Josefin Sans', value: "'Josefin Sans', Arial, sans-serif" },
  { label: 'Tahoma', value: 'Tahoma, Geneva, sans-serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times', value: "'Times New Roman', Times, serif" },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Courier', value: "'Courier New', Courier, monospace" },
];
// Named colours only — no black / white / automatic (per request).
const COLORS = [
  { name: 'Teal', value: '#139DA0' },
  { name: 'Green', value: '#0f6e56' },
  { name: 'Blue', value: '#185FA5' },
  { name: 'Purple', value: '#6d28d9' },
  { name: 'Pink', value: '#d4537e' },
  { name: 'Orange', value: '#d97706' },
  { name: 'Red', value: '#dc2626' },
  { name: 'Gray', value: '#6b7280' },
];

export default function RichTextEditor({ value, onChange, disabled, uploadImage }) {
  const ref = useRef(null);
  const fileRef = useRef(null);
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
  const pickImage = () => { if (!disabled) fileRef.current?.click(); };
  const onImagePicked = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file || !uploadImage) return;
    try {
      const url = await uploadImage(file);
      if (url) { ref.current?.focus(); document.execCommand('insertImage', false, url); emit(); }
    } catch { /* the composer surfaces the error */ }
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
        {uploadImage && <Btn title="Insert image" onClick={pickImage}><i className="fas fa-image"></i></Btn>}
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
        <select className="rte-select" title="Text colour" disabled={disabled} onChange={(e) => { if (e.target.value) cmd('foreColor', e.target.value); e.target.selectedIndex = 0; }} defaultValue="">
          <option value="">Colour</option>
          {COLORS.map((c) => <option key={c.name} value={c.value}>{c.name}</option>)}
        </select>
      </div>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onImagePicked} />
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
        .rte-area img { max-width: 100%; height: auto; border-radius: 6px; }
        .rte-area ul, .rte-area ol { padding-left: 1.4em; }
        .rte-disabled { opacity: 0.7; }
      `}</style>
    </div>
  );
}
