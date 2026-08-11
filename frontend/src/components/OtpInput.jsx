import React, { useRef } from 'react';

// Six-box OTP entry: auto-advances on type, backspaces to the previous box when
// empty, and accepts a full pasted code into any box. `value` is the joined
// string (e.g. "1234"); `onChange` receives the updated joined string.
export default function OtpInput({ value = '', onChange, length = 6, disabled, autoFocus }) {
  const refs = useRef([]);
  const digits = Array.from({ length }, (_, i) => value[i] || '');

  const emit = (arr, focusIdx) => {
    onChange(arr.join('').slice(0, length));
    if (focusIdx != null) refs.current[Math.min(focusIdx, length - 1)]?.focus();
  };

  const handleChange = (i, e) => {
    const raw = e.target.value.replace(/\D/g, '');
    const arr = digits.slice();
    if (!raw) { arr[i] = ''; emit(arr); return; }
    let idx = i;
    for (const c of raw) { if (idx < length) { arr[idx] = c; idx += 1; } }
    emit(arr, idx);
  };

  const handleKeyDown = (i, e) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus();
    if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
    if (e.key === 'ArrowRight' && i < length - 1) refs.current[i + 1]?.focus();
  };

  const handlePaste = (e) => {
    const pasted = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, length);
    if (!pasted) return;
    e.preventDefault();
    emit(pasted.split(''), pasted.length);
  };

  return (
    <div className="otp-boxes" onPaste={handlePaste}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          className="otp-box"
          value={d}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          aria-label={`Digit ${i + 1}`}
        />
      ))}
    </div>
  );
}
