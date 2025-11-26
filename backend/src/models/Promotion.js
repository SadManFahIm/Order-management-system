import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const Promotion = sequelize.define('Promotion', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  title: { type: DataTypes.STRING, allowNull: false },
  type: {
    type: DataTypes.ENUM('percentage', 'fixed', 'weighted'),
    allowNull: false
  },
  percentage_value: { type: DataTypes.FLOAT },
  fixed_value: { type: DataTypes.FLOAT },
  start_date: { type: DataTypes.DATEONLY, allowNull: false },
  end_date: { type: DataTypes.DATEONLY, allowNull: false },
  enabled: { type: DataTypes.BOOLEAN, defaultValue: true }
});

export default Promotion;
