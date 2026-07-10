// Multi-tenant retrofit (WP1b/WP2b): BaseRepository's generic CRUD methods
// (findById/findAll/create/update/delete/count/...) now resolve tenant_id
// via getCurrentTenantId(), which throws TenantContextError fail-closed if
// no tenant context is set. Core's jest fixtures predate multi-tenancy and
// don't wrap their calls in runWithTenant(), so fix a single fallback
// tenant (1) for the whole test process — mirrors Electron's single-tenant
// desktop mode (see electron-app/main.ts's initFixedTenantContext(1) call).
//
// Imported by direct relative path (NOT the package's own "index.ts"
// barrel) so this setup file only evaluates the tiny, dependency-free
// tenantContext module rather than eagerly loading every repository/service
// in the package before each test file's own jest.mock() calls take effect.
import { initFixedTenantContext } from "./db/tenantContext";

initFixedTenantContext(1);
