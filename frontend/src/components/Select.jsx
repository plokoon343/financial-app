import React, { Children, isValidElement, useEffect, useId, useMemo, useRef, useState } from 'react';

// The app's dropdown, used everywhere in place of the native <select> (whose open list
// renders in the OS's light style and can't be searched). A drop-in: it reads the same
// <option> / <optgroup> children and calls onChange with { target: { value, name } },
// so call sites keep their handlers. Long lists get a type-to-filter box; rows are 48px;
// keyboard works like a native select (arrows, Enter, Escape, typing a letter).
// `footer` adds an action row under the list, e.g. { label: "My bank isn't listed", onClick }.

const textOf = (node) => {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf(node.props.children);
  return '';
};

function readOptions(children, group = '') {
  const out = [];
  Children.toArray(children).forEach((child) => {
    if (!isValidElement(child)) return;
    if (child.type === 'option') {
      const { value, disabled, children: label } = child.props;
      const text = textOf(label);
      out.push({ value: value === undefined ? text : String(value), label: text, disabled: !!disabled, group });
    } else if (child.type === 'optgroup') {
      out.push(...readOptions(child.props.children, child.props.label || ''));
    } else if (child.type === React.Fragment) {
      out.push(...readOptions(child.props.children, group));
    }
  });
  return out;
}

export default function Select({
  value, onChange, children, disabled, id, name, className = '', style, wrapStyle, title, onFocus, onBlur,
  placeholder = 'Choose…', searchable, footer, 'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledby,
}) {
  const options = useMemo(() => readOptions(children), [children]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [up, setUp] = useState(false);
  const wrap = useRef(null);
  const trigger = useRef(null);
  const search = useRef(null);
  const list = useRef(null);
  const typed = useRef({ text: '', at: 0 });
  const listId = useId();
  const canSearch = searchable ?? options.length > 8;

  const current = options.find((o) => o.value === String(value ?? ''));
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q) || o.group.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const pick = (o) => {
    if (!o || o.disabled) return;
    setOpen(false);
    setQuery('');
    trigger.current?.focus();
    if (o.value !== String(value ?? '')) onChange?.({ target: { value: o.value, name, id }, currentTarget: { value: o.value, name, id } });
  };

  const openList = () => {
    if (disabled) return;
    const r = trigger.current?.getBoundingClientRect();
    setUp(!!r && window.innerHeight - r.bottom < 300 && r.top > window.innerHeight - r.bottom);
    setActive(Math.max(0, options.findIndex((o) => o.value === String(value ?? ''))));
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!wrap.current?.contains(e.target)) { setOpen(false); setQuery(''); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('touchstart', away);
    if (canSearch) search.current?.focus();
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('touchstart', away); };
  }, [open, canSearch]);

  useEffect(() => { setActive(shown.length ? 0 : -1); }, [query]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open || active < 0) return;
    // The first option scrolls to the very top so its group heading stays visible.
    if (active === 0) { if (list.current) list.current.scrollTop = 0; return; }
    list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const move = (step) => {
    if (!shown.length) return;
    let i = active;
    for (let n = 0; n < shown.length; n++) {
      i = (i + step + shown.length) % shown.length;
      if (!shown[i].disabled) break;
    }
    setActive(i);
  };

  const onKey = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) openList(); else move(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter' || (e.key === ' ' && !canSearch && open)) {
      e.preventDefault();
      if (open) pick(shown[active]); else openList();
    } else if (e.key === ' ' && !open) {
      e.preventDefault(); openList();
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false); setQuery(''); trigger.current?.focus(); }
    } else if (e.key === 'Tab') {
      setOpen(false); setQuery('');
    } else if (!canSearch && e.key.length === 1 && /\S/.test(e.key)) {
      // Typing jumps to the first option starting with what was typed.
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + e.key.toLowerCase(), at: now };
      const i = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(typed.current.text));
      if (i >= 0) { if (open) setActive(i); else pick(options[i]); }
    }
  };

  let lastGroup = null;
  return (
    <div ref={wrap} className={`ui-select ${open ? 'open' : ''} ${disabled ? 'disabled' : ''} ${className}`} style={wrapStyle} onKeyDown={onKey}>
      <button
        ref={trigger}
        type="button"
        id={id}
        className="ui-select-trigger"
        style={style}
        title={title}
        onFocus={onFocus}
        onBlur={onBlur}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        aria-activedescendant={open && !canSearch && active >= 0 ? `${listId}-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
      >
        <span className={`ui-select-value ${current && current.value !== '' ? '' : 'placeholder'}`}>{current ? current.label : placeholder}</span>
        <svg className="ui-select-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className={`ui-select-pop ${up ? 'up' : ''}`}>
          {canSearch && (
            <input
              ref={search}
              className="ui-select-search"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type to search"
              aria-label="Search the list"
              aria-controls={listId}
              aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
            />
          )}
          <ul ref={list} id={listId} role="listbox" className="ui-select-list" aria-label={ariaLabel}>
            {shown.map((o, i) => {
              const head = o.group && o.group !== lastGroup ? o.group : null;
              lastGroup = o.group;
              return (
                <React.Fragment key={`${o.group}|${o.value}|${i}`}>
                  {head && <li className="ui-select-group" role="presentation">{head}</li>}
                  <li
                    id={`${listId}-${i}`}
                    data-i={i}
                    role="option"
                    aria-selected={o.value === String(value ?? '')}
                    aria-disabled={o.disabled || undefined}
                    className={`ui-select-opt ${i === active ? 'active' : ''} ${o.value === String(value ?? '') ? 'selected' : ''}`}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(o)}
                  >
                    {o.label}
                  </li>
                </React.Fragment>
              );
            })}
            {!shown.length && <li className="ui-select-empty" role="presentation">Nothing matches “{query}”</li>}
          </ul>
          {footer && (
            <button type="button" className="ui-select-footer" onMouseDown={(e) => e.preventDefault()} onClick={() => { setOpen(false); setQuery(''); footer.onClick(query); }}>
              {footer.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
