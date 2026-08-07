import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import Promotion from './Promotion.js';

/**
 * Weight-based promotion tier. Table `promotion_slabs` (migration 004) — no
 * timestamp columns at all.
 */
const PromotionSlab = sequelize.define(
  'PromotionSlab',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    min_weight_gm: { type: DataTypes.INTEGER, allowNull: false },
    max_weight_gm: { type: DataTypes.INTEGER, allowNull: false },
    discount_per_500gm: { type: DataTypes.FLOAT, allowNull: false },
  },
  {
    tableName: 'promotion_slabs',
    timestamps: false,
  }
);

Promotion.hasMany(PromotionSlab, { foreignKey: 'promotion_id', as: 'slabs' });
PromotionSlab.belongsTo(Promotion, { foreignKey: 'promotion_id' });

export default PromotionSlab;
