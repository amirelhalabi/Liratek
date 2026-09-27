/**
 * ReleaseNotesBody — a tiny safe renderer for the release-notes Markdown
 * subset (## headings, - bullets, **bold**, paragraphs). Written FIRST
 * (rule 17): the component does not exist yet, so this fails red.
 *
 * The load-bearing assertion is the last test: raw HTML/script-looking text
 * in the source markdown must never become a real DOM element — this
 * renderer must NEVER use dangerouslySetInnerHTML.
 */
import { render, screen } from "@testing-library/react";
import { ReleaseNotesBody } from "../renderReleaseNotes";

describe("ReleaseNotesBody", () => {
  it("renders a heading", () => {
    render(<ReleaseNotesBody markdown="## 🎉 Area" />);
    expect(
      screen.getByRole("heading", { name: /🎉 Area/ }),
    ).toBeInTheDocument();
  });

  it("renders a bullet list", () => {
    render(<ReleaseNotesBody markdown={"## Area\n- first item\n- second item"} />);
    expect(screen.getByText("first item")).toBeInTheDocument();
    expect(screen.getByText("second item")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("renders bold text as a real <strong> element", () => {
    render(<ReleaseNotesBody markdown="A line with **bold** text." />);
    const strong = screen.getByText("bold");
    expect(strong.tagName).toBe("STRONG");
  });

  it("renders a leading paragraph before any heading", () => {
    render(
      <ReleaseNotesBody markdown={"An intro paragraph.\n\n## Area\n- item"} />,
    );
    expect(screen.getByText("An intro paragraph.")).toBeInTheDocument();
  });

  it("renders multiple heading groups, each with their own bullets", () => {
    render(
      <ReleaseNotesBody
        markdown={"## First\n- a\n- b\n\n## Second\n- c"}
      />,
    );
    expect(screen.getByRole("heading", { name: "First" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Second" })).toBeInTheDocument();
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("c")).toBeInTheDocument();
  });

  it("NEVER injects HTML — a markdown string containing a tag renders as literal text, not an element", () => {
    const { container } = render(
      <ReleaseNotesBody markdown={'- <img src=x onerror="window.__pwned = true">'} />,
    );
    // No <img> was ever created, and the dangerous attribute never ran.
    expect(container.querySelector("img")).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
    // The literal text is visible instead.
    expect(container.textContent).toContain("<img src=x onerror=");
  });
});
