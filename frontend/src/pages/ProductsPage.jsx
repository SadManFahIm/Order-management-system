import { useEffect, useRef, useState } from 'react';
import api from '../api';
import ProductForm from '../components/ProductForm';
import { PageHeader, Card, Table, Button, Badge, Skeleton, useToast } from '../components/ui';

export default function ProductsPage() {
  const [products, setProducts] = useState(null); // null = loading
  const [editing, setEditing] = useState(null);
  const toast = useToast();

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
    await api.put(`/products/${editing.id}`, data);
    setEditing(null);
    toast.success('Product updated');
    await load();
  };

  return (
    <div className="oms-page">
      <PageHeader
        title="Products"
        desc="Manage your menu items and availability."
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
                { key: 'enabled', label: 'Status' },
                { key: 'actions', label: '', align: 'right' },
              ]}
              rows={products}
              render={(p, key) => {
                if (key === 'price') return <span className="oms-table__cell-strong">৳ {Number(p.price).toFixed(2)}</span>;
                if (key === 'weight_gm') return `${p.weight_gm} gm`;
                if (key === 'enabled')
                  return p.enabled ? <Badge tone="success">Available</Badge> : <Badge tone="neutral">Hidden</Badge>;
                if (key === 'name') return <span className="oms-table__cell-strong">{p.name}</span>;
                if (key === 'actions')
                  return (
                    <div className="oms-table__actions">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(p)}>
                        Edit
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
