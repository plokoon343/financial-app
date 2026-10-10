import React, { useEffect, useState } from 'react';
import { subscribeUndo, undoLast } from '../lib/undo';

// The snackbar for undoable deletes and dismissals. Mounted once in the app layout.
export default function UndoBar() {
  const [item, setItem] = useState(null);
  const [failed, setFailed] = useState('');

  useEffect(() => subscribeUndo(setItem), []);
  useEffect(() => {
    const onFail = () => { setFailed('That didn’t go through, so it’s back.'); setTimeout(() => setFailed(''), 4000); };
    window.addEventListener('automonie:undo-failed', onFail);
    return () => window.removeEventListener('automonie:undo-failed', onFail);
  }, []);

  if (!item && !failed) return null;
  return (
    <div className="undo-bar" role="status" aria-live="polite">
      <span>{item ? item.message : failed}</span>
      {item && <button type="button" onClick={undoLast}>Undo</button>}
    </div>
  );
}
