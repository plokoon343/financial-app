'use strict';
// House style for what the assistant says back: no emoji and no em dashes, whatever
// the model felt like writing. Applied to every reply before it is shown or saved.

// Pictographs, symbols, flags and the joiners and selectors that glue emoji together.
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu;
// Em dash, with any spaces around it, becomes a comma.
const EM_DASH = /\s*—\s*/g;

function cleanAiText(s) {
  return String(s == null ? '' : s)
    .replace(EMOJI, '')
    .replace(EM_DASH, ', ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([,.;:!?])/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

module.exports = { cleanAiText };
