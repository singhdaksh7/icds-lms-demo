// Turns the admin-entered plain text of a legal page into a small, fixed set
// of render blocks. Nothing here produces HTML: the view prints every value
// with <%= %> (HTML-escaped), so arbitrary text - including "<script>" - can
// only ever be displayed as text.
//
//   "## Heading"      -> { type: 'h2', text }
//   "- item" lines    -> { type: 'ul', items: [...] }
//   anything else     -> { type: 'p', text } (single newlines kept)
function parseLegalText(input) {
  const text = typeof input === 'string' ? input.replace(/\r\n?/g, '\n') : '';
  const blocks = [];

  for (const chunk of text.split(/\n{2,}/)) {
    const lines = chunk.split('\n').map((line) => line.trimEnd()).filter((line) => line.trim() !== '');
    if (lines.length === 0) continue;

    let paragraph = [];
    let list = [];
    const flushParagraph = () => {
      if (paragraph.length) blocks.push({ type: 'p', text: paragraph.join('\n') });
      paragraph = [];
    };
    const flushList = () => {
      if (list.length) blocks.push({ type: 'ul', items: list });
      list = [];
    };

    for (const line of lines) {
      const heading = line.match(/^##\s+(.+)$/);
      const item = line.match(/^-\s+(.+)$/);
      if (heading) {
        flushParagraph();
        flushList();
        blocks.push({ type: 'h2', text: heading[1].trim() });
      } else if (item) {
        flushParagraph();
        list.push(item[1].trim());
      } else {
        flushList();
        paragraph.push(line.trim());
      }
    }
    flushParagraph();
    flushList();
  }

  return blocks;
}

// "2026-10-15" -> "15 October 2026"; anything invalid -> ''.
function formatLegalDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return '';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

module.exports = { parseLegalText, formatLegalDate };
