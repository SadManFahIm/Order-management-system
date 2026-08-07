import { useEffect, useRef, useState } from 'react';
import api from '../api';
import { useI18n } from '../i18n';
import ProductForm from '../components/ProductForm';
import ImportCsvModal from '../components/ImportCsvModal';
import { PageHeader, Card, Table, Button, Badge, Skeleton, useToast } from '../components/ui';

export default function ProductsPage() {
  const [products, setProducts] = useState(null); // null = loading
  const [editing, setEditing] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const toast = useToast();
  const { t } = useI18n();

  const mounted = useRef(true);
  useEffect(() => {
    // Reset on every mount — StrictMode remounts once in dev, and the
    // cleanup would otherwise leave the ref false forever.
    mounted.current = true;
    load();
    return () => { mounted.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    try {
      const res = await api.get('/products');
      if (mounted.current) setProducts(res.data);
    } catch {
      if (mounted.current) {
        setProducts([]);
        toast?.error('Failed to load products');
      }
    }
  };

  const onCreate = async (data) => {
    await api.post('/products', data);
    toast.success('Product added');
    await load();
  };

  const onUpdate = async (data) => {
    try {
      await api.put(`/products/${editing.id}`, data);
      setEditing(null);
      toast.success('Product updated');
      await load();
    } catch (err) {
      // Optimistic-lock conflicts surface as 409 — tell the merchant to reload.
      const msg = err?.response?.data?.error?.message;
      toast.error(msg || 'Could not update product');
      if (err?.response?.status === 409) await load();
    }
  };

  const onDelete = async (p) => {
    if (!window.confirm(`Delete “${p.name}” from the menu? This can't be undone.`)) return;
    try {
      await api.delete(`/products/${p.id}`);
      toast.success('Product deleted');
      if (editing?.id === p.id) setEditing(null);
      await load();
    } catch {
      toast.error('Could not delete product');
    }
  };

  return (
    <div className="oms-page">
      <PageHeader
        title={t('pages.products')}
        desc={t('pages.productsDesc')}
        actions={
          <Button variant="outline" size="sm" icon="⬆" onClick={() => setImportOpen(true)}>
            {t('pages.importCsv')}
          </Button>
        }
      />

      <ImportCsvModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          toast.success('Menu imported');
          load();
        }}
      />

      <div className="oms-grid oms-grid--2col">
        <Card
          title={editing ? 'Edit product' : 'Add a product'}
          subtitle={editing ? `Editing “${editing.name}”` : 'New menu items appear immediately.'}
          actions={
            editing && (
              <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            )
          }
        >
          <ProductForm key={editing?.id ?? 'new'} initial={editing} onSave={editing ? onUpdate : onCreate} />
        </Card>

        <Card bodyPadding={false}>
          {products === null ? (
            <div style={{ padding: 24, display: 'grid', gap: 12 }}>
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} height={34} />
              ))}
            </div>
          ) : (
            <Table
              columns={[
                { key: 'id', label: 'ID' },
                { key: 'name', label: 'Product' },
                { key: 'price', label: 'Price', align: 'right' },
                { key: 'weight_gm', label: 'Weight', align: 'right' },
                { key: 'stock', label: 'Stock', align: 'right' },
                { key: 'enabled', label: 'Status' },
                { key: 'actions', label: '', align: 'right' },
              ]}
              rows={products}
              render={(p, key) => {
                if (key === 'price') return <span className="oms-table__cell-strong">৳ {Number(p.price).toFixed(2)}</span>;
                if (key === 'weight_gm') return `${p.weight_gm} gm`;
                if (key === 'stock') {
                  const inv = p.inventory;
                  const qty = Number(inv?.stock_qty ?? 0);
                  const low = Number(inv?.low_stock_at ?? 0);
                  const isLow = low > 0 && qty <= low;
                  return isLow ? (
                    <Badge tone="danger">{qty} {inv?.unit || 'pcs'} · Low</Badge>
                  ) : (
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {qty} {inv?.unit || 'pcs'}
                    </span>
                  );
                }
                if (key === 'enabled')
                  return p.enabled ? <Badge tone="success">Available</Badge> : <Badge tone="neutral">Hidden</Badge>;
                if (key === 'name') return <span className="oms-table__cell-strong">{p.name}</span>;
                if (key === 'actions')
                  return (
                    <div className="oms-table__actions">
                      <Button variant="ghost" size="sm" onClick={() => setEditing({ ...p, inventory: p.inventory || { stock_qty: 0, low_stock_at: 0, unit: 'pcs' } })}>
                        Edit
                      </Button>
                      <Button variant="danger-ghost" size="sm" onClick={() => onDelete(p)}>
                        Delete
                      </Button>
                    </div>
                  );
                return p[key];
              }}
              empty={{
                icon: <EmojiIcon>🍽️</EmojiIcon>,
                title: 'No products yet',
                description: 'Add your first product to start taking orders.',
              }}
            />
          )}
        </Card>
      </div>
    </div>
  );
}

function EmojiIcon({ children }) {
  return <span style={{ fontSize: 22 }}>{children}</span>;
}
