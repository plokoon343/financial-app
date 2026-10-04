import React from 'react';

// Renders the small subset of markdown the assistant uses (paragraphs, bullet and
// numbered lists, short headings, **bold**) as React elements. No HTML is injected,
// so nothing in the model's text can run as markup.
const inline = (text, keyBase) =>
  text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, i) =>
    /^\*\*[^*]+\*\*$/.test(part)
      ? <strong key={`${keyBase}-${i}`}>{part.slice(2, -2)}</strong>
      : part.replace(/\*\*/g, ''));

export default function RichText({ text, className = '' }) {
  const blocks = [];
  let list = null;
  const flush = () => { if (list) { blocks.push(list); list = null; } };

  String(text || '').split('\n').forEach((raw) => {
    const line = raw.trim();
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    if (bullet || numbered) {
      const kind = bullet ? 'ul' : 'ol';
      if (!list || list.kind !== kind) { flush(); list = { kind, items: [] }; }
      list.items.push((bullet || numbered)[1]);
      return;
    }
    flush();
    if (!line) return;
    blocks.push(heading ? { kind: 'h', text: heading[1] } : { kind: 'p', text: line });
  });
  flush();

  return (
    <div className={`rich-text ${className}`}>
      {blocks.map((b, i) => {
        if (b.kind === 'ul' || b.kind === 'ol') {
          const List = b.kind;
          return <List key={i}>{b.items.map((it, j) => <li key={j}>{inline(it, `${i}-${j}`)}</li>)}</List>;
        }
        if (b.kind === 'h') return <p key={i} className="rich-text-heading">{inline(b.text, i)}</p>;
        return <p key={i}>{inline(b.text, i)}</p>;
      })}
    </div>
  );
}
