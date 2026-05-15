# LIRA-046: Configurable Base System (OMT vs Whish) — Design & Implementation Guide

> **Status:** Ready for Implementation  
> **Priority:** Medium  
> **Dependencies:** LIRA-045 (DONE), LIRA-037 (DONE)  
> **Date:** 2026-05-15

---

## Concept

A shop is either **OMT-base** or **Whish-base**. It owns one system and uses a partner for the other. Currently hardcoded to OMT-base (LIRA-045). This ticket makes it configurable during setup.

---

## Rules

| Shop Type  | Owns         | Partner System | Partner Required For      |
| ---------- | ------------ | -------------- | ------------------------- |
| OMT-base   | OMT System   | Whish System   | Whish System SEND/RECEIVE |
| Whish-base | Whish System | OMT System     | OMT System SEND/RECEIVE   |

- **Choice is made during setup and cannot be changed**
- **All drawers exist** regardless of base system
- **OMT App / Whish App are independent** — both work for any shop type
- **UI labels stay as-is** — "OMT System" / "Whish System" (no dynamic renaming)
- **Existing shops silently default to OMT**
- **Whish-specific fee structure** — future ticket (for now Whish-base shops just do SEND/RECEIVE)

---

## Implementation Steps

### Step 1: Database Migration

**File:** `packages/core/src/db/migrations/index.ts`

Add a new migration (next version after current) that inserts `shop_base_system` into settings:

```sql
INSERT INTO settings (key_name, value, description)
VALUES ('shop_base_system', 'OMT', 'Shop base system: OMT or WHISH');
```

Also update `electron-app/create_db.sql` with the same seed.

**Note:** Default is `OMT` — existing shops get this silently.

---

### Step 2: Backend — Read Shop Base Setting

**Option A:** Reuse existing settings repository/service (if one exists for key-value settings).

**Option B:** Create a helper:

```typescript
// packages/core/src/services/ShopSettingsService.ts (or add to existing)

export function getShopBaseSystem(): "OMT" | "WHISH" {
  const setting = getSettingsRepository().getByKey("shop_base_system");
  return (setting?.value as "OMT" | "WHISH") || "OMT";
}

export function getPartnerSystem(): "OMT" | "WHISH" {
  return getShopBaseSystem() === "OMT" ? "WHISH" : "OMT";
}
```

Expose via IPC if not already available (settings may already be readable via `settings:get`).

---

### Step 3: Frontend — Setup Wizard Step

**File:** Create `frontend/src/features/setup/steps/StepBaseSystem.tsx` (or similar)

A simple step with two large buttons/cards:

- **OMT** — "I own an OMT system"
- **WHISH** — "I own a Whish system"

On selection, save to settings via IPC (`settings:set` with key `shop_base_system`).

Integrate into the setup wizard flow (check existing setup steps for the pattern).

---

### Step 4: Frontend — Hook

**Create:** `frontend/src/hooks/useShopBase.ts` (or in an existing hooks folder)

```typescript
export function useShopBase() {
  // Load shop_base_system from settings (via IPC or context)
  // Return: { baseSystem: "OMT" | "WHISH", partnerSystem: "OMT" | "WHISH" }
}
```

This hook is used by components that need to know which system requires a partner.

---

### Step 5: Frontend — Services Page (Partner Requirement Flip)

**File:** `frontend/src/features/services/pages/Services/index.tsx`

Currently hardcoded (around line 458, 644, 1080):

```typescript
// CURRENT: Whish always requires partner
"Whish System transactions require a partner";
```

**Change to:**

```typescript
const { partnerSystem } = useShopBase();

// If selected provider matches the partner system, require partner
if (provider === partnerSystem) {
  // Partner required
}
```

**Specific locations to update:**

- Line ~458: `// If WHISH is selected but no partner exists, force switch to OMT` → generalize
- Line ~644: `"Whish System transactions require a partner"` → `"${partnerSystem} System transactions require a partner"`
- Line ~1080: `title={isDisabled ? "No active WHISH partner..."` → use `partnerSystem`

---

### Step 6: Frontend — PartnerSelector Component

**File:** `frontend/src/features/partners/components/PartnerSelector.tsx`

The `required` prop is already dynamic (passed from parent). No change needed here — just ensure the Services page passes `required={provider === partnerSystem}` correctly.

---

### Step 7: Frontend — Checkpoint/Closing

**File:** Checkpoint page (find in `frontend/src/features/closing/`)

When the partner system has no active partner:

- Show the partner-system drawer as **inactive/greyed out**
- Tooltip: "No active partner for [OMT/Whish] System"
- Don't require input for that drawer

**Logic:**

```typescript
const { partnerSystem } = useShopBase();
const hasPartner = partners.some((p) => p.is_active);

// If no partner, mark partnerSystem drawer as inactive
const isDrawerInactive = (drawerName: string) => {
  if (drawerName === `${partnerSystem}_System` && !hasPartner) return true;
  return false;
};
```

---

### Step 8: Supplier Deactivation

**LIRA-045 already deactivates WHISH supplier.** For Whish-base shops, we need to deactivate OMT supplier instead.

**Option:** Handle this in the setup wizard — when shop chooses base system, deactivate the partner system's supplier.

```typescript
// During setup, after base system is chosen:
if (baseSystem === "OMT") {
  deactivateSupplier("WHISH");
} else {
  deactivateSupplier("OMT");
}
```

Check if LIRA-045's migration already deactivated WHISH — for existing OMT shops this is fine. For new Whish-base shops, the setup wizard handles it.

---

### Step 9: Rebuild & Test

```bash
cd packages/core && npm run build
yarn typecheck
yarn lint
yarn build
yarn workspace @liratek/backend test
```

---

## Files to Modify (Summary)

| File                                                      | Change                                                         |
| --------------------------------------------------------- | -------------------------------------------------------------- |
| `packages/core/src/db/migrations/index.ts`                | New migration: add `shop_base_system` setting                  |
| `electron-app/create_db.sql`                              | Add `shop_base_system` seed                                    |
| `packages/core/src/services/` (or existing settings)      | `getShopBaseSystem()` / `getPartnerSystem()` helpers           |
| `frontend/src/features/setup/steps/StepBaseSystem.tsx`    | NEW — setup wizard step                                        |
| `frontend/src/hooks/useShopBase.ts`                       | NEW — hook returning base/partner system                       |
| `frontend/src/features/services/pages/Services/index.tsx` | Replace hardcoded Whish partner requirement with dynamic check |
| `frontend/src/features/closing/` (checkpoint page)        | Inactive drawer when no partner for partner system             |

---

## Edge Cases

1. **Existing shops:** Silently default to OMT. No prompt, no migration issue.
2. **Setup wizard restart:** If someone re-runs setup, the setting is already written. Don't allow changing it (or skip the step if already set).
3. **No partner added yet:** Partner-system drawer shows inactive in checkpoint. Services page blocks partner-system transactions with clear message.
4. **Whish-base fee structure:** Not part of this ticket. Whish-base shops can do SEND/RECEIVE but fee calculation (equivalent of OMT's `omtFees.ts`) is a future ticket.

---

## Verification Checklist

- [ ] Migration adds `shop_base_system` defaulting to `OMT`
- [ ] Existing shops unaffected (silent OMT default)
- [ ] Setup wizard shows OMT/Whish choice
- [ ] Setting is saved and cannot be changed after setup
- [ ] OMT-base shop: Whish System requires partner (existing behavior preserved)
- [ ] Whish-base shop: OMT System requires partner
- [ ] Whish-base shop: Whish System works without partner
- [ ] OMT App / Whish App work independently of base system
- [ ] Checkpoint shows partner-system drawer as inactive when no partner
- [ ] Partner-system supplier deactivated during setup
- [ ] Typecheck passes
- [ ] Lint passes
- [ ] Build succeeds
- [ ] Backend tests pass

---

## After Implementation

- [ ] Test both shop types end-to-end
- [ ] Update `current_sprint.md` — mark LIRA-046 as DONE
- [ ] Update summary table
