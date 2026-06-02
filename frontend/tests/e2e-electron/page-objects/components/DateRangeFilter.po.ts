import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Set a React-controlled date input.
 *
 * Two-pronged approach for reliability:
 * 1. Playwright locator.fill() — fires CDP-level InputEvent/change that React
 *    listens to at the root container.
 * 2. Direct __reactProps$ call — bypasses the event system entirely and invokes
 *    the onChange function directly, so React's state setter is always called
 *    even if CDP-level events are intercepted by Electron.
 *
 * Object.getOwnPropertyNames() is used instead of Object.keys() because
 * React's expando properties on DOM nodes may be non-enumerable in some
 * Chromium builds.
 */
async function setDateInputValue(page: Page, testid: string, value: string): Promise<void> {
  const locator = page.getByTestId(testid);

  // Step 1: Playwright fill (handles CDP-level events)
  if (value) {
    await locator.fill(value).catch(() => {
      // Some date inputs reject fill; the __reactProps$ step below covers us
    });
  } else {
    await locator.evaluate((el: HTMLInputElement) => {
      el.value = "";
    }).catch(() => {});
  }

  // Step 2: Directly call React's onChange via __reactProps$ so state updates
  // even if fill() didn't fire the right events.
  await page.evaluate(
    ({ testid, value }) => {
      const el = document.querySelector(`[data-testid="${testid}"]`) as HTMLInputElement | null;
      if (!el) return;

      // Set the DOM value via the native prototype setter so React reads
      // the correct e.target.value inside the onChange handler.
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      nativeSetter?.call(el, value);

      // React 18 stores props as a non-enumerable expando: __reactProps$<rand>
      // Use getOwnPropertyNames to find it regardless of enumerability.
      const propsKey =
        Object.getOwnPropertyNames(el).find((k) => k.startsWith("__reactProps$")) ??
        Object.keys(el).find((k) => k.startsWith("__reactProps$"));

      if (propsKey) {
        const props = (el as Record<string, unknown>)[propsKey] as Record<string, unknown>;
        if (typeof props?.onChange === "function") {
          (props.onChange as (e: unknown) => void)({
            target: el,
            currentTarget: el,
            bubbles: true,
            type: "change",
            preventDefault: () => {},
            stopPropagation: () => {},
          });
          return;
        }
      }

      // Ultimate fallback: native DOM events
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { testid, value },
  );
}

export class DateRangeFilterPO {
  constructor(private page: Page) {}

  get fromInput(): Locator {
    return this.page.getByTestId("date-range-from");
  }

  get toInput(): Locator {
    return this.page.getByTestId("date-range-to");
  }

  async setFrom(date: string): Promise<void> {
    await setDateInputValue(this.page, "date-range-from", date);
    await this.page.waitForTimeout(300);
  }

  async setTo(date: string): Promise<void> {
    await setDateInputValue(this.page, "date-range-to", date);
    await this.page.waitForTimeout(300);
  }

  async clearBoth(): Promise<void> {
    await setDateInputValue(this.page, "date-range-from", "");
    await setDateInputValue(this.page, "date-range-to", "");
    await this.page.waitForTimeout(300);
  }

  async expectFromValue(date: string): Promise<void> {
    await expect(this.fromInput).toHaveValue(date);
  }

  async expectToValue(date: string): Promise<void> {
    await expect(this.toInput).toHaveValue(date);
  }
}
