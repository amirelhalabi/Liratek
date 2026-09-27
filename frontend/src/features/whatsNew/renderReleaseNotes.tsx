import type { ReactNode } from "react";

/**
 * A tiny, safe renderer for the release-notes Markdown subset documented in
 * docs/release-notes/UNRELEASED.md: "## <emoji> Area" headings, "- " bullet
 * lists, "**bold**" inline emphasis, and plain paragraphs. Deliberately NOT
 * a general Markdown parser and NEVER uses dangerouslySetInnerHTML — every
 * character of the source that isn't one of these four constructs is
 * rendered as plain text, so nothing in a release note (however it got
 * there) can execute as HTML.
 */

type Block =
  | { kind: "heading"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "paragraph"; text: string };

const HEADING_RE = /^#{1,6}\s+(.*)$/;
const BULLET_RE = /^-\s+(.*)$/;
const BOLD_RE = /\*\*(.+?)\*\*/g;

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (trimmed === "") {
      i++;
      continue;
    }

    const heading = trimmed.match(HEADING_RE);
    if (heading) {
      blocks.push({ kind: "heading", text: heading[1].trim() });
      i++;
      continue;
    }

    if (BULLET_RE.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && BULLET_RE.test(lines[i].trim())) {
        const match = lines[i].trim().match(BULLET_RE);
        items.push(match ? match[1] : "");
        i++;
      }
      blocks.push({ kind: "list", items });
      continue;
    }

    // Paragraph: consecutive non-blank, non-heading, non-bullet lines.
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !HEADING_RE.test(lines[i].trim()) &&
      !BULLET_RE.test(lines[i].trim())
    ) {
      paraLines.push(lines[i].trim());
      i++;
    }
    blocks.push({ kind: "paragraph", text: paraLines.join(" ") });
  }

  return blocks;
}

/** Renders `**bold**` runs as real <strong> elements; everything else stays plain text. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let boldIndex = 0;
  let match: RegExpExecArray | null;

  BOLD_RE.lastIndex = 0;
  while ((match = BOLD_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(<strong key={`${keyPrefix}-b-${boldIndex++}`}>{match[1]}</strong>);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

export interface ReleaseNotesBodyProps {
  markdown: string;
}

/** Renders one release's `body` markdown as safe React elements. */
export function ReleaseNotesBody({ markdown }: ReleaseNotesBodyProps) {
  const blocks = parseBlocks(markdown);

  return (
    <>
      {blocks.map((block, idx) => {
        const key = `block-${idx}`;

        if (block.kind === "heading") {
          return (
            <h3
              key={key}
              className="text-base font-bold text-white mt-4 first:mt-0 mb-2"
            >
              {renderInline(block.text, key)}
            </h3>
          );
        }

        if (block.kind === "list") {
          return (
            <ul
              key={key}
              className="list-disc list-inside space-y-1 text-sm text-slate-300 mb-3"
            >
              {block.items.map((item, itemIdx) => (
                <li key={`${key}-item-${itemIdx}`}>
                  {renderInline(item, `${key}-${itemIdx}`)}
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={key} className="text-sm text-slate-300 mb-3">
            {renderInline(block.text, key)}
          </p>
        );
      })}
    </>
  );
}
