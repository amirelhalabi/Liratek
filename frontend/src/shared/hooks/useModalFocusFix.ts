/**
 * The implementation lives in `@liratek/ui` (packages/ui/src/hooks) so the
 * shared UI package's own modals use the same focus fix as the app's. This
 * path stays as the app-wide import site (and the module tests mock).
 */
export { useModalFocusFix } from "@liratek/ui";
