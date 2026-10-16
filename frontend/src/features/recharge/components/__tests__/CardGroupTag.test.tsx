/** @jest-environment jsdom */
/**
 * On a card that shows artwork (which hides the subcategory line), a small
 * tag before the title names the item's group: its subcategory, or its
 * category when it has none. Written before the component (rule 17).
 */
import { render, screen } from "@testing-library/react";
import { CardGroupTag } from "../CardGroupTag";
import { cardGroupLabel } from "../../utils/cardGroupLabel";

describe("CardGroupTag", () => {
  it("names the subcategory", () => {
    expect(
      cardGroupLabel({ category: "Internet", subcategory: "Terranet" }),
    ).toBe("Terranet");
    render(
      <CardGroupTag item={{ category: "Internet", subcategory: "Terranet" }} />,
    );
    const tag = screen.getByText("Terranet");
    expect(tag).toHaveAttribute("title", "Terranet");
    expect(tag.className).toMatch(/shrink-0/);
    expect(tag.className).toMatch(/truncate/);
  });

  it("falls back to the category when there is no subcategory", () => {
    expect(cardGroupLabel({ category: "Internet", subcategory: "  " })).toBe(
      "Internet",
    );
  });

  it("renders nothing when the item has neither", () => {
    const { container } = render(
      <CardGroupTag item={{ category: "", subcategory: "" }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
