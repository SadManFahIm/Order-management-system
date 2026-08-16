import { useEffect, useRef, useState } from 'react';
import api from '../api';
import { useI18n } from '../i18n';
import { PageHeader, Card, Skeleton, Badge } from '../components/ui';

const STATUS_TONE = {
  active: 'success',
  trial: 'warning',
  suspended: 'danger',
  archived: 'neutral',
};

/**
 * Platform-admin SSO overview (Phase 3 follow-up).
 *
 * Every workspace's SAML configuration status (enabled / IdP entity /
 * SLO endpoint / default role / last updated) plus the most recent
 * `auth.saml_login` events — so a platform admin sees at a glance which
 * workspaces use enterprise SSO and how active it is. Route is gated
 * client-side by platform_role and server-side by requireRole.
 */
export default function AdminSsoOverviewPage() {
  const { t } = useI18n();
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    setData(null);
    api
      .get('/admin/sso')
      .then((res) => {
        if (mounted.current) setData(res.data);
      })
      .catch(() => {
        if (mounted.current) setError(true);
      });
    return () => {
      mounted.current = false;
    };
  }, []);

  if (error) {
    return (
      <div className="oms-page">
        <PageHeader title={t('admin.sso')} desc={t('admin.ssoSub')} />
        <Card>
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
            Could not load the SSO overview.
          </div>
        </Card>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="oms-page">
        <PageHeader title={t('admin.sso')} desc={t('admin.ssoSub')} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} height={110} />
          ))}
        </div>
        <Skeleton height={320} />
      </div>
    );
  }

  const { workspaces, recentLogins, totals } = data;
  const stats = [
    { label: t('admin.ssoWorkspaces'), value: String(totals.tenants), tone: 'default' },
    { label: t('admin.ssoConfigured'), value: String(totals.configured), tone: 'default' },
    { label: t('admin.ssoEnabled'), value: String(totals.enabled), tone: 'success' },
  ];

  return (
    <div className="oms-page">
      <PageHeader
        title={t('admin.sso')}
        desc={t('admin.ssoSub')}
        actions={<Badge tone="primary">SAML · SP metadata at /api/auth/saml/metadata</Badge>}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        {stats.map((s) => (
          <div key={s.label} className="oms-card">
            <div className="oms-card__body" style={{ padding: '18px 20px' }}>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600 }}>{s.label}</div>
              <div
                style={{
                  fontSize: 26,
                  fontWeight: 800,
                  marginTop: 6,
                  fontVariantNumeric: 'tabular-nums',
                  color: s.tone === 'success' ? 'var(--success)' : 'var(--text)',
                }}
              >
                {s.value}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginTop: 16 }}>
        <Card title={t('admin.ssoWorkspaces')} subtitle={t('admin.ssoSub')}>
          <div style={{ overflowX: 'auto' }}>
            <table className="oms-table" style={{ width: '100%', minWidth: 620 }}>
              <thead>
                <tr>
                  <th>Workspace</th>
                  <th>Status</th>
                  <th>SSO</th>
                  <th>{t('admin.ssoIdp')}</th>
                  <th>{t('admin.ssoRole')}</th>
                  <th>{t('admin.ssoUpdated')}</th>
                </tr>
              </thead>
              <tbody>
                {workspaces.map((w) => (
                  <tr key={w.id}>
                    <td>
                      <div style={{ fontWeight: 700 }}>{w.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>/{w.slug}</div>
                    </td>
                    <td>
                      <Badge tone={STATUS_TONE[w.status] || 'neutral'}>{w.status}</Badge>
                    </td>
                    <td>
                      {!w.sso ? (
                        <Badge tone="neutral">{t('admin.ssoNotConfigured')}</Badge>
                      ) : w.sso.enabled ? (
                        <Badge tone="success">{t('admin.ssoEnabledBadge')}</Badge>
                      ) : (
                        <Badge tone="warning">{t('admin.ssoDisabled')}</Badge>
                      )}
                    </td>
                    <td style={{ fontSize: 13, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {w.sso ? w.sso.idpEntityId : '—'}
                    </td>
                    <td style={{ fontSize: 13 }}>{w.sso ? w.sso.defaultRole : '—'}</td>
                    <td style={{ fontSize: 12.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {w.sso ? new Date(w.sso.updatedAt).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title={t('admin.ssoRecent')} subtitle={t('admin.ssoRecentSub')}>
          {recentLogins.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 36, color: 'var(--text-muted)', fontSize: 13.5 }}>
              {t('admin.ssoNoActivity')}
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {recentLogins.map((l) => (
                <div
                  key={l.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: 'var(--surface-2)',
                  }}
                >
                  <div
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: '50%',
                      background: 'var(--primary)',
                      color: '#fff',
                      display: 'grid',
                      placeItems: 'center',
                      fontWeight: 800,
                      fontSize: 13,
                      flexShrink: 0,
                    }}
                  >
                    {(l.name || l.email || '?').slice(0, 1).toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {l.email || '—'}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {t('admin.ssoLoginAt')} ·{' '}
                      {l.at ? new Date(l.at).toLocaleString() : '—'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
