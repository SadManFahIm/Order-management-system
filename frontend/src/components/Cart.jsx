import React from 'react';

export default function Cart({ cart, summary, onQtyChange, onRemove }) {
  return (
    <div>
      <h3>Cart</h3>
      <table width="100%" border="1" cellPadding="4">
        <thead>
          <tr>
            <th>Product</th>
            <th>Unit price</th>
            <th>Qty</th>
            <th>Weight/Unit (gm)</th>
            <th>Base total</th>
            <th>Discount</th>
            <th>Line total</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {cart.map((item) => (
            <tr key={item.product.id}>
              <td>{item.product.name}</td>
              <td>{item.product.price}</td>
              <td>
                <input
                  type="number"
                  min="1"
                  value={item.quantity}
                  onChange={(e) =>
                    onQtyChange(item.product.id, Number(e.target.value))
                  }
                  style={{ width: 60 }}
                />
              </td>
              <td>{item.product.weight_gm}</td>
              <td>{item.baseTotal?.toFixed(2) ?? '-'}</td>
              <td>{item.discount?.toFixed(2) ?? '-'}</td>
              <td>{item.lineTotal?.toFixed(2) ?? '-'}</td>
              <td>
                <button onClick={() => onRemove(item.product.id)}>X</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {summary && (
        <div style={{ marginTop: 8 }}>
          <p>Subtotal: {summary.subtotal.toFixed(2)}</p>
          <p>Total discount: {summary.totalDiscount.toFixed(2)}</p>
          <p>
            <b>Grand total: {summary.grandTotal.toFixed(2)}</b>
          </p>
        </div>
      )}
    </div>
  );
}
