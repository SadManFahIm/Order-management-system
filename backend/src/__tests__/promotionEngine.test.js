import { describe, it, expect } from 'vitest';
import { applyPromotionsToCart } from '../utils/promotionEngine.js';

const product = (overrides = {}) => ({
  id: 1,
  name: 'Beef Burger',
  price: 300,
  weight_gm: 500,
  ...overrides,
});

const promo = (overrides = {}) => ({
  id: 1,
  title: 'Test promo',
  type: 'percentage',
  enabled: true,
  percentage_value: 10,
  fixed_value: null,
  start_date: '2020-01-01',
  end_date: '2099-12-31',
  slabs: [],
  ...overrides,
});

const cart = (items) =>
  items.map(({ product: p, quantity }) => ({ product: p, quantity }));

describe('applyPromotionsToCart', () => {
  it('applies no discount when there are no promotions', () => {
    const result = applyPromotionsToCart(cart([{ product: product(), quantity: 2 }]), []);
    expect(result.subtotal).toBe(600);
    expect(result.totalDiscount).toBe(0);
    expect(result.grandTotal).toBe(600);
  });

  it('applies a percentage discount per item', () => {
    const result = applyPromotionsToCart(
      cart([{ product: product({ price: 100 }), quantity: 2 }]),
      [promo({ type: 'percentage', percentage_value: 10 })]
    );
    expect(result.subtotal).toBe(200);
    expect(result.totalDiscount).toBe(20);
    expect(result.grandTotal).toBe(180);
  });

  it('applies a fixed discount multiplied by quantity', () => {
    const result = applyPromotionsToCart(
      cart([{ product: product({ price: 100 }), quantity: 3 }]),
      [promo({ type: 'fixed', fixed_value: 5 })]
    );
    expect(result.totalDiscount).toBe(15);
    expect(result.grandTotal).toBe(285);
  });

  it('applies a weighted slab discount based on total weight', () => {
    const result = applyPromotionsToCart(
      cart([{ product: product({ price: 100, weight_gm: 1000 }), quantity: 2 }]),
      [
        promo({
          type: 'weighted',
          slabs: [
            { min_weight_gm: 1000, max_weight_gm: 1999, discount_per_500gm: 2 },
            { min_weight_gm: 2000, max_weight_gm: 9999, discount_per_500gm: 4 },
          ],
        }),
      ]
    );
    // total weight 2000gm → slab 2 → units = 4 → discount = 16
    expect(result.totalDiscount).toBe(16);
    expect(result.grandTotal).toBe(200 - 16);
  });

  it('ignores disabled promotions', () => {
    const result = applyPromotionsToCart(
      cart([{ product: product({ price: 100 }), quantity: 1 }]),
      [promo({ enabled: false, percentage_value: 50 })]
    );
    expect(result.totalDiscount).toBe(0);
  });

  it('ignores promotions outside the active date window', () => {
    const result = applyPromotionsToCart(
      cart([{ product: product({ price: 100 }), quantity: 1 }]),
      [promo({ start_date: '2000-01-01', end_date: '2001-01-01', percentage_value: 50 })]
    );
    expect(result.totalDiscount).toBe(0);
  });

  it('picks the largest discount when multiple promotions match', () => {
    const result = applyPromotionsToCart(
      cart([{ product: product({ price: 1000 }), quantity: 1 }]),
      [
        promo({ id: 1, percentage_value: 10 }),
        promo({ id: 2, percentage_value: 25 }),
      ]
    );
    expect(result.totalDiscount).toBe(250);
    expect(result.grandTotal).toBe(750);
  });

  it('calculates totals correctly across multiple items', () => {
    const result = applyPromotionsToCart(
      cart([
        { product: product({ id: 1, price: 100 }), quantity: 2 },
        { product: product({ id: 2, price: 200 }), quantity: 1 },
      ]),
      [promo({ percentage_value: 10 })]
    );
    expect(result.subtotal).toBe(400);
    expect(result.totalDiscount).toBe(40);
    expect(result.grandTotal).toBe(360);
  });
});
