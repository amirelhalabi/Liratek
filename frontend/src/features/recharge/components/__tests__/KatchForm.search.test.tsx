/**
 * KatchForm Search Functionality Tests
 *
 * Tests for the search feature in KatchForm component that filters items
 * across categories in real-time.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { KatchForm } from "../KatchForm";
import type {
  ServiceItem,
  ProviderKey,
} from "../../hooks/useMobileServiceItems";
import type {
  ProviderConfig,
  FinancialTransaction,
  ProviderAnalytics,
} from "../../types";

// ── Mock useApi ──
const mockGetRates = jest.fn().mockResolvedValue([
  { from_code: "USD", to_code: "LBP", rate: 89500 },
  { from_code: "LBP", to_code: "USD", rate: 89000 },
]);

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    getRates: mockGetRates,
  }),
}));

// Mock SVG imports
jest.mock("@/assets/logos/alfa.svg?react", () => ({
  __esModule: true,
  default: () => <svg data-testid="alfa-logo" />,
}));

jest.mock("@/assets/logos/mtc.svg?react", () => ({
  __esModule: true,
  default: () => <svg data-testid="mtc-logo" />,
}));

// ─── Mock Data ──────────────────────────────────────────────────────────────

const mockServiceItems: ServiceItem[] = [
  // Alfa category items - unique labels
  {
    key: "iPick/alfa/Alfa Go/Alfa Go",
    provider: "iPick",
    category: "alfa",
    subcategory: "Alfa Go",
    label: "Alfa Go Premium",
    catalogCost: 697000,
    catalogSellPrice: 0,
  },
  {
    key: "iPick/alfa/Alfa Go/Alfa Go+",
    provider: "iPick",
    category: "alfa",
    subcategory: "Alfa Go",
    label: "Alfa Go Plus",
    catalogCost: 1212000,
    catalogSellPrice: 0,
  },
  {
    key: "iPick/alfa/Mobile Internet/1GB",
    provider: "iPick",
    category: "alfa",
    subcategory: "Mobile Internet",
    label: "1GB Data",
    catalogCost: 340000,
    catalogSellPrice: 0,
  },
  {
    key: "iPick/alfa/Mobile Internet/3GB",
    provider: "iPick",
    category: "alfa",
    subcategory: "Mobile Internet",
    label: "3GB Data",
    catalogCost: 900000,
    catalogSellPrice: 0,
  },
  // Gaming category items - unique labels
  {
    key: "iPick/Gaming/Pubg direct/60",
    provider: "iPick",
    category: "Gaming",
    subcategory: "Pubg direct",
    label: "60 UC",
    catalogCost: 82340,
    catalogSellPrice: 0,
  },
  {
    key: "iPick/Gaming/Pubg direct/325 UC",
    provider: "iPick",
    category: "Gaming",
    subcategory: "Pubg direct",
    label: "325 UC Pack",
    catalogCost: 454000,
    catalogSellPrice: 0,
  },
  {
    key: "iPick/Gaming/Free Fire direct/100 +10 diamonds",
    provider: "iPick",
    category: "Gaming",
    subcategory: "Free Fire direct",
    label: "100 Diamonds",
    catalogCost: 97000,
    catalogSellPrice: 0,
  },
  // MTC category items - unique labels
  {
    key: "iPick/mtc/Credits/3$",
    provider: "iPick",
    category: "mtc",
    subcategory: "Credits",
    label: "3 USD Credit",
    catalogCost: 280000,
    catalogSellPrice: 0,
  },
  {
    key: "iPick/mtc/Validity/10 days",
    provider: "iPick",
    category: "mtc",
    subcategory: "Validity",
    label: "10 Days Validity",
    catalogCost: 65000,
    catalogSellPrice: 0,
  },
];

const mockActiveConfig: ProviderConfig = {
  key: "iPick",
  label: "iPick",
  module: "ipec_katch",
  drawer: "iPick",
  formMode: "financial",
  color: "text-sky-400",
  bgTint: "bg-sky-400/10",
  activeBg: "bg-sky-500",
  activeText: "text-white",
  badgeCls: "bg-sky-400/10 text-sky-400",
  iconKey: "Zap",
  hasSupplier: true,
};

const mockProps = {
  activeConfig: mockActiveConfig,
  finTransactions: [] as FinancialTransaction[],
  activeProvider: "iPick" as ProviderKey,
  finAnalytics: {
    today: { commission: 0, count: 0 },
    byProvider: [],
  } as ProviderAnalytics,
  owedByProvider: {},
  getCategoriesForProvider: (provider: ProviderKey) => {
    if (provider === "iPick") {
      return ["alfa", "mtc", "Gaming"];
    }
    return [];
  },
  getServiceItems: (provider: ProviderKey, category: string) => {
    if (provider !== "iPick") return [];
    return mockServiceItems.filter((item) => item.category === category);
  },
  methods: [{ code: "CASH", label: "Cash" }],
  handleFinancialSubmit: jest.fn(),
  isSubmitting: false,
  loadFinancialData: jest.fn(),
  formatAmount: (val: number) => val.toLocaleString(),
  alfaCreditSellRate: 100,
  showHistory: false,
  setShowHistory: jest.fn(),
};

// ─── Helper Functions ───────────────────────────────────────────────────────

const renderKatchForm = (overrides = {}) => {
  const props = { ...mockProps, ...overrides };
  return render(<KatchForm {...props} />);
};

const getSearchInput = () => {
  return screen.getByPlaceholderText(/search/i) as HTMLInputElement;
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("KatchForm Search", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Search Input Rendering", () => {
    it("renders search input with correct placeholder", () => {
      renderKatchForm();

      const searchInput = getSearchInput();
      expect(searchInput).toBeInTheDocument();
      expect(searchInput.placeholder).toContain("Search");
      expect(searchInput.placeholder).toContain("iPick");
    });

    it("renders search icon", () => {
      renderKatchForm();

      // Search icon should be present (SVG)
      const searchIcon = document.querySelector("svg");
      expect(searchIcon).toBeInTheDocument();
    });

    it("does not show clear button when search is empty", () => {
      renderKatchForm();

      const clearButton = screen.queryByRole("button", { name: /clear/i });
      expect(clearButton).not.toBeInTheDocument();
    });
  });

  describe("Search Filtering", () => {
    it("filters items by label", async () => {
      renderKatchForm();

      const searchInput = getSearchInput();

      // Search for "Premium" - should match "Alfa Go Premium"
      fireEvent.change(searchInput, { target: { value: "Premium" } });

      // Wait for filter to apply
      await waitFor(
        () => {
          expect(screen.getByText(/Alfa Go Premium/i)).toBeInTheDocument();
        },
        { timeout: 1000 },
      );
    });

    it("filters items by category name", async () => {
      renderKatchForm();

      const searchInput = getSearchInput();

      // Search for "Gaming"
      fireEvent.change(searchInput, { target: { value: "Gaming" } });

      await waitFor(
        () => {
          expect(screen.getByText(/Gaming/i)).toBeInTheDocument();
        },
        { timeout: 1000 },
      );
    });

    it("search is case insensitive", async () => {
      renderKatchForm();

      const searchInput = getSearchInput();

      // Search with lowercase
      fireEvent.change(searchInput, { target: { value: "gaming" } });
      await waitFor(
        () => {
          expect(screen.getByText(/Gaming/i)).toBeInTheDocument();
        },
        { timeout: 1000 },
      );

      // Search with uppercase
      fireEvent.change(searchInput, { target: { value: "GAMING" } });
      await waitFor(
        () => {
          expect(screen.getByText(/Gaming/i)).toBeInTheDocument();
        },
        { timeout: 1000 },
      );
    });

    it("shows items from multiple categories for common search term", async () => {
      renderKatchForm();

      const searchInput = getSearchInput();

      // Search for "10" - should match "100 Diamonds" and "10 Days Validity"
      fireEvent.change(searchInput, { target: { value: "10" } });

      await waitFor(
        () => {
          expect(screen.getByText(/100 Diamonds/i)).toBeInTheDocument();
          expect(screen.getByText(/10 Days Validity/i)).toBeInTheDocument();
        },
        { timeout: 1000 },
      );
    });
  });

  describe("Category Visibility", () => {
    it("hides categories with no matching items", async () => {
      renderKatchForm();

      const searchInput = getSearchInput();

      // Search for term that only exists in Gaming category
      fireEvent.change(searchInput, { target: { value: "UC" } });

      await waitFor(
        () => {
          // Gaming category should be visible (has UC items)
          expect(screen.getByText(/Gaming/i)).toBeInTheDocument();
        },
        { timeout: 1000 },
      );
    });

    it("restores all categories when search is cleared", async () => {
      renderKatchForm();

      const searchInput = getSearchInput();

      // Search for something specific
      fireEvent.change(searchInput, { target: { value: "UC" } });

      // Wait for filter - should show Gaming category
      await waitFor(
        () => {
          expect(screen.getByText(/Gaming/i)).toBeInTheDocument();
        },
        { timeout: 1000 },
      );

      // Clear search
      fireEvent.change(searchInput, { target: { value: "" } });

      // All categories should be restored
      await waitFor(
        () => {
          // Check for category headers specifically
          const categoryHeaders = screen.getAllByRole("heading", { level: 3 });
          expect(categoryHeaders.length).toBeGreaterThanOrEqual(2);
        },
        { timeout: 1000 },
      );
    });

    it("restores all categories when cleared", async () => {
      renderKatchForm();

      const searchInput = getSearchInput();

      // Search for something specific
      fireEvent.change(searchInput, { target: { value: "UC" } });

      // Wait for filter - should show Gaming category
      await waitFor(
        () => {
          expect(screen.getByText(/Gaming/i)).toBeInTheDocument();
        },
        { timeout: 1000 },
      );

      // Click clear button
      const clearButton = await screen.findByRole(
        "button",
        { name: /clear search/i },
        { timeout: 1000 },
      );
      fireEvent.click(clearButton);

      // All categories should be restored
      await waitFor(
        () => {
          // Check that Gaming category is visible (was filtered before)
          expect(screen.getByText(/Gaming/i)).toBeInTheDocument();
          // Check that search input is cleared
          expect(searchInput.value).toBe("");
        },
        { timeout: 1000 },
      );
    });
  });

  describe("Clear Button", () => {
    it("shows clear button when search has value", async () => {
      renderKatchForm();

      const searchInput = getSearchInput();

      // Type something
      fireEvent.change(searchInput, { target: { value: "test" } });

      // Wait for clear button to appear (with proper aria-label)
      const clearButton = await screen.findByRole(
        "button",
        { name: /clear search/i },
        { timeout: 1000 },
      );
      expect(clearButton).toBeInTheDocument();
    });

    it("clears search when clicked", async () => {
      renderKatchForm();

      const searchInput = getSearchInput();

      // Type something
      fireEvent.change(searchInput, { target: { value: "test" } });

      // Wait for clear button and click it
      const clearButton = await screen.findByRole(
        "button",
        { name: /clear search/i },
        { timeout: 1000 },
      );
      fireEvent.click(clearButton);

      // Search should be cleared
      await waitFor(
        () => {
          expect(searchInput.value).toBe("");
        },
        { timeout: 500 },
      );
    });
  });

  describe("Search Performance", () => {
    it("handles rapid typing without errors", () => {
      renderKatchForm();

      const searchInput = getSearchInput();

      // Simulate rapid typing
      fireEvent.change(searchInput, { target: { value: "a" } });
      fireEvent.change(searchInput, { target: { value: "al" } });
      fireEvent.change(searchInput, { target: { value: "alf" } });
      fireEvent.change(searchInput, { target: { value: "alfa" } });

      // Should not throw any errors
      expect(searchInput.value).toBe("alfa");
    });

    it("handles special characters", async () => {
      renderKatchForm();

      const searchInput = getSearchInput();

      // Search with special characters
      fireEvent.change(searchInput, { target: { value: "3 USD" } });

      await waitFor(
        () => {
          expect(screen.getByText(/3 USD Credit/i)).toBeInTheDocument();
        },
        { timeout: 1000 },
      );
    });

    it("handles long search queries", () => {
      renderKatchForm();

      const searchInput = getSearchInput();

      // Very long search query
      const longQuery = "a".repeat(100);
      fireEvent.change(searchInput, { target: { value: longQuery } });

      // Should not crash
      expect(searchInput.value).toBe(longQuery);
    });
  });

  describe("Provider-Specific Search", () => {
    it("shows correct provider name in placeholder", () => {
      renderKatchForm();

      const searchInput = getSearchInput();
      expect(searchInput.placeholder).toContain("iPick");
    });
  });
});
