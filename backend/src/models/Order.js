import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const Order = sequelize.define('Order', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  customer_name: { type: DataTypes.STRING, allowNull: false },
  customer_phone: { type: DataTypes.STRING },
  customer_address: { type: DataTypes.TEXT },
  subtotal: { type: DataTypes.FLOAT, allowNull: false },
  total_discount: { type: DataTypes.FLOAT, allowNull: false },
  grand_total: { type: DataTypes.FLOAT, allowNull: false }
});

export default Order;
