/**
 * LIRA-331 T019: <Ltr> keeps numbers, phones, IMEIs and amounts left-to-right
 * inside Arabic text (FR-015); <DirIcon> mirrors only direction icons in RTL
 * (FR-014).
 */
import { render } from "@testing-library/react";
import { ChevronRight, Printer } from "lucide-react";
import { Ltr } from "../Ltr";
import { DirIcon } from "../DirIcon";

describe("<Ltr>", () => {
  it("wraps its content in <bdi dir=ltr>", () => {
    const { container } = render(<Ltr>$1,234</Ltr>);
    const bdi = container.querySelector("bdi");
    expect(bdi).not.toBeNull();
    expect(bdi).toHaveAttribute("dir", "ltr");
    expect(bdi).toHaveTextContent("$1,234");
  });

  it("passes a className through", () => {
    const { container } = render(<Ltr className="font-mono">71 123 456</Ltr>);
    expect(container.querySelector("bdi")).toHaveClass("font-mono");
  });
});

describe("<DirIcon>", () => {
  it("mirrors the icon in RTL through the rtl: variant", () => {
    const { container } = render(<DirIcon icon={ChevronRight} className="w-4 h-4" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveClass("rtl:-scale-x-100");
    expect(svg).toHaveClass("w-4");
  });

  it("is only for direction icons: a plain icon is rendered as is elsewhere", () => {
    const { container } = render(<Printer className="w-4" />);
    expect(container.querySelector("svg")).not.toHaveClass("rtl:-scale-x-100");
  });
});
