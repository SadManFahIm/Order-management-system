import User from './User.js';
import Product from './Product.js';
import Promotion from './Promotion.js';
import PromotionSlab from './PromotionSlab.js';
import Order from './Order.js';
import OrderItem from './OrderItem.js';
import RefreshToken from './RefreshToken.js';
import AuthToken from './AuthToken.js';
import AuditLog from './AuditLog.js';
import Tenant from './Tenant.js';
import UserTenant from './UserTenant.js';
import Plan from './Plan.js';
import Subscription from './Subscription.js';
import FeatureFlag from './FeatureFlag.js';
import UsageCounter from './UsageCounter.js';
import TenantInvite from './TenantInvite.js';
import TenantSamlConfig from './TenantSamlConfig.js';
import MenuCategory from './MenuCategory.js';
import ItemVariant from './ItemVariant.js';
import ItemAddon from './ItemAddon.js';
import InventoryItem from './InventoryItem.js';
import Table from './Table.js';
import Payment from './Payment.js';
import DailyStat from './DailyStat.js';
import IdempotencyKey from './IdempotencyKey.js';
import OrderSplitItem from './OrderSplitItem.js';

// Tenant ↔ Plan / SaaS wiring
Tenant.belongsTo(Plan, { foreignKey: 'plan_id', as: 'plan' });
Plan.hasMany(Tenant, { foreignKey: 'plan_id' });

export {
  User,
  Product,
  Promotion,
  PromotionSlab,
  Order,
  OrderItem,
  RefreshToken,
  AuthToken,
  AuditLog,
  Tenant,
  UserTenant,
  Plan,
  Subscription,
  FeatureFlag,
  UsageCounter,
  TenantInvite,
  TenantSamlConfig,
  MenuCategory,
  ItemVariant,
  ItemAddon,
  InventoryItem,
  Table,
  Payment,
  DailyStat,
  IdempotencyKey,
  OrderSplitItem,
};
