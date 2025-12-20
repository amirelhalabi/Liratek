/**
 * Type barrel file - re-exports all types
 */

// App-specific shared types used by this repo
export * from "./appTypes";

// Note: ./entities and ./dtos intentionally not re-exported here because they
// contain overlapping names (Product, Client, SaleItem, CartItem). If we need
// them later, we should either:
// - rename them (e.g., DomainProduct vs Product), or
// - expose them via separate entry points.
