import { DataTypes } from 'sequelize';

/**
 * 019 — SAML single logout (SLO) + the SP's own signing identity.
 *
 * Adds the IdP's SLO endpoint to each tenant's SAML config (so an
 * SP-initiated logout can redirect a LogoutRequest to the right place),
 * and creates the `saml_sp_config` singleton (id = 1) that holds the SP's
 * entity ID and the SP signing key/certificate pair. The SP key is what
 * signs LogoutRequests (and could sign AuthnRequests later) and is what the
 * SP metadata advertises as the signing credential — generated once at
 * first use with node-forge, never from user input.
 */
const t = (transaction) => ({ transaction });

export const up = async (qi, transaction) => {
  await qi.addColumn(
    'tenant_saml_configs',
    'idp_slo_url',
    {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    t(transaction)
  );

  await qi.createTable(
    'saml_sp_config',
    {
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        defaultValue: 1, // singleton row
      },
      entity_id: { type: DataTypes.STRING(255), allowNull: false },
      cert: { type: DataTypes.TEXT, allowNull: false },
      private_key: { type: DataTypes.TEXT, allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    { ...t(transaction) }
  );
};

export const down = async (qi, transaction) => {
  await qi.dropTable('saml_sp_config', { transaction });
  await qi.removeColumn('tenant_saml_configs', 'idp_slo_url', t(transaction));
};
