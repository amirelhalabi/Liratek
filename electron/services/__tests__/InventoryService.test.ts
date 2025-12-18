/**
 * InventoryService Unit Tests
 * 
 * Tests all business logic in InventoryService with mocked repository.
 */

import { InventoryService, resetInventoryService } from '../InventoryService';
import { ProductRepository } from '../../database/repositories';
import { ValidationError, NotFoundError } from '../../utils/errors';

// Mock the repository module
jest.mock('../../database/repositories', () => ({
  getProductRepository: jest.fn(),
  ProductRepository: jest.fn(),
}));

describe('InventoryService', () => {
  let service: InventoryService;
  let mockRepo: jest.Mocked<ProductRepository>;

  beforeEach(() => {
    resetInventoryService();

    // Create mock repository
    mockRepo = {
      findAllProducts: jest.fn(),
      findById: jest.fn(),
      findByBarcode: jest.fn(),
      search: jest.fn(),
      getCategories: jest.fn(),
      barcodeExists: jest.fn(),
      createProduct: jest.fn(),
      exists: jest.fn(),
      updateProductFull: jest.fn(),
      softDeleteById: jest.fn(),
      adjustStock: jest.fn(),
      adjustStockDelta: jest.fn(),
      deductStockForSale: jest.fn(),
      getStockStats: jest.fn(),
      findLowStock: jest.fn(),
      getVirtualStock: jest.fn(),
    } as unknown as jest.Mocked<ProductRepository>;

    service = new InventoryService(mockRepo);
  });

  // ===========================================================================
  // Product Queries
  // ===========================================================================

  describe('getProducts', () => {
    it('returns all products without filter', () => {
      const mockProducts = [
        { id: 1, barcode: '123', name: 'Product A' },
        { id: 2, barcode: '456', name: 'Product B' },
      ];
      mockRepo.findAllProducts.mockReturnValue(mockProducts as any);

      const result = service.getProducts();

      expect(mockRepo.findAllProducts).toHaveBeenCalledWith(undefined);
      expect(result).toEqual(mockProducts);
    });

    it('passes search term to repository', () => {
      mockRepo.findAllProducts.mockReturnValue([]);

      service.getProducts('phone');

      expect(mockRepo.findAllProducts).toHaveBeenCalledWith('phone');
    });
  });

  describe('getProductById', () => {
    it('returns product when found', () => {
      const mockProduct = { id: 1, barcode: '123', name: 'Product A' };
      mockRepo.findById.mockReturnValue(mockProduct as any);

      const result = service.getProductById(1);

      expect(mockRepo.findById).toHaveBeenCalledWith(1);
      expect(result).toEqual(mockProduct);
    });

    it('throws NotFoundError when product not found', () => {
      mockRepo.findById.mockReturnValue(null);

      expect(() => service.getProductById(999)).toThrow(NotFoundError);
    });
  });

  describe('getProductByBarcode', () => {
    it('returns product when found', () => {
      const mockProduct = { id: 1, barcode: '123', name: 'Product A' };
      mockRepo.findByBarcode.mockReturnValue(mockProduct as any);

      const result = service.getProductByBarcode('123');

      expect(mockRepo.findByBarcode).toHaveBeenCalledWith('123');
      expect(result).toEqual(mockProduct);
    });

    it('throws ValidationError for empty barcode', () => {
      expect(() => service.getProductByBarcode('')).toThrow(ValidationError);
    });

    it('trims whitespace from barcode', () => {
      mockRepo.findByBarcode.mockReturnValue(null);

      service.getProductByBarcode('  123  ');

      expect(mockRepo.findByBarcode).toHaveBeenCalledWith('123');
    });
  });

  describe('searchProducts', () => {
    it('returns matching products', () => {
      const mockProducts = [{ id: 1, barcode: '123', name: 'iPhone' }];
      mockRepo.search.mockReturnValue(mockProducts as any);

      const result = service.searchProducts('phone');

      expect(mockRepo.search).toHaveBeenCalledWith('phone', undefined);
      expect(result).toEqual(mockProducts);
    });

    it('returns empty array for empty search term', () => {
      const result = service.searchProducts('');

      expect(mockRepo.search).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('passes options to repository', () => {
      mockRepo.search.mockReturnValue([]);

      service.searchProducts('phone', { limit: 10, category: 'Electronics' });

      expect(mockRepo.search).toHaveBeenCalledWith('phone', { 
        limit: 10, 
        category: 'Electronics' 
      });
    });
  });

  describe('getCategories', () => {
    it('returns categories from repository', () => {
      const mockCategories = ['Electronics', 'Accessories', 'Services'];
      mockRepo.getCategories.mockReturnValue(mockCategories);

      const result = service.getCategories();

      expect(mockRepo.getCategories).toHaveBeenCalled();
      expect(result).toEqual(mockCategories);
    });
  });

  // ===========================================================================
  // Product CRUD
  // ===========================================================================

  describe('createProduct', () => {
    const validProductData = {
      barcode: '123456',
      name: 'Test Product',
      category: 'Electronics',
      cost_price: 10,
      retail_price: 20,
      current_stock: 100,
      min_stock_level: 10,
    };

    it('creates product successfully', () => {
      mockRepo.barcodeExists.mockReturnValue(false);
      mockRepo.createProduct.mockReturnValue({ id: 1 });

      const result = service.createProduct(validProductData);

      expect(mockRepo.createProduct).toHaveBeenCalledWith({
        ...validProductData,
        barcode: '123456',
        name: 'Test Product',
        category: 'Electronics',
      });
      expect(result).toEqual({ success: true, id: 1 });
    });

    it('returns error for missing barcode', () => {
      const result = service.createProduct({
        ...validProductData,
        barcode: '',
      });

      expect(result).toEqual({ success: false, error: 'Barcode is required' });
      expect(mockRepo.createProduct).not.toHaveBeenCalled();
    });

    it('returns error for missing name', () => {
      const result = service.createProduct({
        ...validProductData,
        name: '',
      });

      expect(result).toEqual({ success: false, error: 'Product name is required' });
    });

    it('returns error for missing category', () => {
      const result = service.createProduct({
        ...validProductData,
        category: '',
      });

      expect(result).toEqual({ success: false, error: 'Category is required' });
    });

    it('returns error for negative cost price', () => {
      const result = service.createProduct({
        ...validProductData,
        cost_price: -5,
      });

      expect(result).toEqual({ success: false, error: 'Cost price cannot be negative' });
    });

    it('returns error for negative retail price', () => {
      const result = service.createProduct({
        ...validProductData,
        retail_price: -10,
      });

      expect(result).toEqual({ success: false, error: 'Retail price cannot be negative' });
    });

    it('returns error for duplicate barcode', () => {
      mockRepo.barcodeExists.mockReturnValue(true);

      const result = service.createProduct(validProductData);

      expect(result).toEqual({ success: false, error: 'Barcode already exists' });
    });

    it('handles repository error', () => {
      mockRepo.barcodeExists.mockReturnValue(false);
      mockRepo.createProduct.mockImplementation(() => {
        throw new Error('DB error');
      });

      const result = service.createProduct(validProductData);

      expect(result).toEqual({ success: false, error: 'DB error' });
    });
  });

  describe('updateProduct', () => {
    const updateData = {
      barcode: '123456',
      name: 'Updated Product',
      category: 'Electronics',
      cost_price: 15,
      retail_price: 30,
      min_stock_level: 5,
    };

    it('updates product successfully', () => {
      mockRepo.exists.mockReturnValue(true);
      mockRepo.barcodeExists.mockReturnValue(false);
      mockRepo.updateProductFull.mockReturnValue(true);

      const result = service.updateProduct(1, updateData);

      expect(mockRepo.updateProductFull).toHaveBeenCalledWith(1, updateData);
      expect(result).toEqual({ success: true });
    });

    it('returns error for missing product ID', () => {
      const result = service.updateProduct(0, updateData);

      expect(result).toEqual({ success: false, error: 'Product ID required' });
    });

    it('returns error when product not found', () => {
      mockRepo.exists.mockReturnValue(false);

      const result = service.updateProduct(999, updateData);

      expect(result).toEqual({ success: false, error: 'Product not found' });
    });

    it('returns error for duplicate barcode', () => {
      mockRepo.exists.mockReturnValue(true);
      mockRepo.barcodeExists.mockReturnValue(true);

      const result = service.updateProduct(1, updateData);

      expect(result).toEqual({ success: false, error: 'Barcode already exists' });
    });
  });

  describe('deleteProduct', () => {
    it('soft deletes product successfully', () => {
      mockRepo.softDeleteById.mockReturnValue(true);

      const result = service.deleteProduct(1);

      expect(mockRepo.softDeleteById).toHaveBeenCalledWith(1);
      expect(result).toEqual({ success: true });
    });

    it('returns error for missing product ID', () => {
      const result = service.deleteProduct(0);

      expect(result).toEqual({ success: false, error: 'Product ID required' });
    });

    it('handles repository error', () => {
      mockRepo.softDeleteById.mockImplementation(() => {
        throw new Error('DB error');
      });

      const result = service.deleteProduct(1);

      expect(result).toEqual({ success: false, error: 'DB error' });
    });
  });

  // ===========================================================================
  // Stock Management
  // ===========================================================================

  describe('adjustStock', () => {
    it('adjusts stock to absolute value', () => {
      mockRepo.adjustStock.mockReturnValue(true);

      const result = service.adjustStock(1, 50);

      expect(mockRepo.adjustStock).toHaveBeenCalledWith(1, 50);
      expect(result).toEqual({ success: true });
    });

    it('returns error for missing product ID', () => {
      const result = service.adjustStock(0, 50);

      expect(result).toEqual({ success: false, error: 'Product ID required' });
    });

    it('returns error for negative quantity', () => {
      const result = service.adjustStock(1, -10);

      expect(result).toEqual({ success: false, error: 'Stock quantity cannot be negative' });
    });

    it('handles repository error', () => {
      mockRepo.adjustStock.mockImplementation(() => {
        throw new Error('DB error');
      });

      const result = service.adjustStock(1, 50);

      expect(result).toEqual({ success: false, error: 'DB error' });
    });
  });

  describe('adjustStockDelta', () => {
    it('increments stock', () => {
      mockRepo.adjustStockDelta.mockReturnValue(true);

      const result = service.adjustStockDelta(1, 10);

      expect(mockRepo.adjustStockDelta).toHaveBeenCalledWith(1, 10);
      expect(result).toEqual({ success: true });
    });

    it('decrements stock', () => {
      mockRepo.adjustStockDelta.mockReturnValue(true);

      const result = service.adjustStockDelta(1, -5);

      expect(mockRepo.adjustStockDelta).toHaveBeenCalledWith(1, -5);
      expect(result).toEqual({ success: true });
    });

    it('returns error for missing product ID', () => {
      const result = service.adjustStockDelta(0, 10);

      expect(result).toEqual({ success: false, error: 'Product ID required' });
    });
  });

  describe('deductStockForSale', () => {
    it('calls repository to deduct stock', () => {
      mockRepo.deductStockForSale.mockReturnValue(undefined);

      service.deductStockForSale(123);

      expect(mockRepo.deductStockForSale).toHaveBeenCalledWith(123);
    });
  });

  // ===========================================================================
  // Reporting
  // ===========================================================================

  describe('getStockStats', () => {
    it('returns stock stats from repository', () => {
      const mockStats = {
        totalBudget: 50000,
        totalItems: 500,
      };
      mockRepo.getStockStats.mockReturnValue(mockStats as any);

      const result = service.getStockStats();

      expect(mockRepo.getStockStats).toHaveBeenCalled();
      expect(result).toEqual(mockStats);
    });
  });

  describe('getLowStockProducts', () => {
    it('returns low stock products from repository', () => {
      const mockProducts = [
        { id: 1, name: 'Low Stock Item', current_stock: 2, min_stock_level: 10 },
      ];
      mockRepo.findLowStock.mockReturnValue(mockProducts as any);

      const result = service.getLowStockProducts();

      expect(mockRepo.findLowStock).toHaveBeenCalled();
      expect(result).toEqual(mockProducts);
    });
  });

  describe('getVirtualStock', () => {
    it('returns virtual stock from repository', () => {
      mockRepo.getVirtualStock.mockReturnValue(2500);

      const result = service.getVirtualStock();

      expect(mockRepo.getVirtualStock).toHaveBeenCalled();
      expect(result).toBe(2500);
    });
  });
});
