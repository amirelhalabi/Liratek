/**
 * LIRA-296 — word-wrap free text (the shop's receipt header and warranty
 * terms) to a thermal receipt's character width. One helper for the sale
 * receipts (58mm/80mm) and the service receipt (rule 14). Honours the
 * owner's own line breaks; a single word longer than the width is split.
 */
export function wrapReceiptText(text: string, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    let current = "";
    for (let word of words) {
      while (word.length > width) {
        if (current) {
          out.push(current);
          current = "";
        }
        out.push(word.slice(0, width));
        word = word.slice(width);
      }
      if (!word) continue;
      if (!current) current = word;
      else if (current.length + 1 + word.length <= width) current += ` ${word}`;
      else {
        out.push(current);
        current = word;
      }
    }
    if (current) out.push(current);
  }
  return out;
}
