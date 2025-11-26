import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import Promotion from './Promotion.js';

const PromotionSlab = sequelize.define('PromotionSlab', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  min_weight_gm: { type: DataTypes.INTEGER, allowNull: false },
  max_weight_gm: { type: DataTypes.INTEGER, allowNull: false },
  discount_per_500gm: { type: DataTypes.FLOAT, allowNull: false }
});

Promotion.hasMany(PromotionSlab, { foreignKey: 'promotion_id', as: 'slabs' });
PromotionSlab.belongsTo(Promotion, { foreignKey: 'promotion_id' });

export default PromotionSlab;
