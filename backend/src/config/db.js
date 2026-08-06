import { Sequelize } from 'sequelize';
import { env } from './env.js';

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: env.DB_STORAGE,
  logging: env.NODE_ENV === 'development' ? console.log : false,
});

export default sequelize;
