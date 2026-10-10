import React, { useEffect, useId, useRef } from 'react';

// A modal question with a few labelled answers, on the native <dialog> (focus
// handling, Esc and the backdrop come with it). Esc or the backdrop answers null.
// choices: [{ value, label, tone: 'primary' | 'danger' | undefined }]
export default function ChoiceDialog({ open, title, message, choices, onChoose }) {
  const ref = useRef(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="choice-dialog"
      aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); onChoose(null); }}
      onClick={(e) => { if (e.target === ref.current) onChoose(null); }}
    >
      <h3 id={titleId}>{title}</h3>
      {message && <p>{message}</p>}
      <div className="choice-dialog-actions">
        {choices.map((c) => (
          <button
            key={c.value}
            type="button"
            className={c.tone === 'danger' ? 'btn-danger' : c.tone === 'primary' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => onChoose(c.value)}
          >
            {c.label}
          </button>
        ))}
      </div>
    </dialog>
  );
}
