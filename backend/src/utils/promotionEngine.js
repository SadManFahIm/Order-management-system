export function applyPromotionsToCart(cartItems, promotions) {
  const today = new Date();

  const activePromos = promotions.filter((p) => {
    if (!p.enabled) return false;
    const start = new Date(p.start_date);
    const end = new Date(p.end_date);
    return today >= start && today <= end;
  });

  const itemsWithDiscount = cartItems.map((item) => {
    const unitPrice = item.product.price;
    const quantity = item.quantity;
    const baseTotal = unitPrice * quantity;
    const totalWeightGm = item.product.weight_gm * quantity;

    let bestDiscount = 0;

    for (const promo of activePromos) {
      let discount = 0;

      if (promo.type === 'percentage' && promo.percentage_value) {
        discount = baseTotal * (promo.percentage_value / 100);
      } else if (promo.type === 'fixed' && promo.fixed_value) {
        discount = promo.fixed_value * quantity;
      } else if (promo.type === 'weighted') {
        const slabs = promo.slabs || [];
        const slab = slabs.find(
          (s) =>
            totalWeightGm >= s.min_weight_gm &&
            totalWeightGm <= s.max_weight_gm
        );
        if (slab) {
          const units = totalWeightGm / 500;
          discount = slab.discount_per_500gm * units;
        }
      }

      if (discount > bestDiscount) bestDiscount = discount;
    }

    const lineTotal = baseTotal - bestDiscount;

    return {
      ...item,
      totalWeightGm,
      baseTotal,
      discount: bestDiscount,
      lineTotal
    };
  });

  let subtotal = 0;
  let totalDiscount = 0;
  let grandTotal = 0;

  for (const i of itemsWithDiscount) {
    subtotal += i.baseTotal;
    totalDiscount += i.discount;
    grandTotal += i.lineTotal;
  }

  return { items: itemsWithDiscount, subtotal, totalDiscount, grandTotal };
}
