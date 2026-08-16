import { useEffect, useRef, useState } from 'react';
import api from '../api';
import { useI18n } from '../i18n';
import ProductForm from '../components/ProductForm';
import ImportCsvModal from '../components/ImportCsvModal';
import { PageHeader, Card, Table, Button, Badge, Skeleton, Input, Field, Select, Checkbox, useToast } from '../components/ui';

const ITEM_TAGS = ['veg', 'spicy', 'new', 'bestseller'];

export default function ProductsPage() {
  const [products, setProducts] = useState(null); // null = loading
  const [editing, setEditing] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [selected, setSelected] = useState([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulk, setBulk] = useState({ price: '', stock: '', enabled: '', tags: [] });
  const [bulkSaving, setBulkSaving] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
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
      if (mounted.current) {
        const sorted = [...res.data].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || (a.id - b.id));
        setProducts(sorted);
      }
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

  const toggleSelect = (id) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const allSelected = products?.length > 0 && selected.length === products.length;

  const toggleAll = () => setSelected(allSelected ? [] : (products || []).map((p) => p.id));

  const applyBulk = async () => {
    if (selected.length === 0) return;
    setBulkSaving(true);
    try {
      const body = { ids: selected };
      if (bulk.price !== '') body.price = Number(bulk.price);
      if (bulk.stock !== '') body.inventory = { stock_qty: Number(bulk.stock) };
      if (bulk.enabled !== '') body.enabled = bulk.enabled === 'true';
      if (bulk.tags.length > 0) body.tags = bulk.tags;
      await api.post('/products/bulk', body);
      toast.success(`Updated ${selected.length} item${selected.length > 1 ? 's' : ''}`);
      setSelected([]);
      setBulk({ price: '', stock: '', enabled: '', tags: [] });
      setBulkOpen(false);
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.error?.message || 'Bulk edit failed');
    } finally {
      setBulkSaving(false);
    }
  };

  // Drag-and-drop sort: move a row to a new position, persist via /sort.
  const onDropRow = async (targetId) => {
    if (dragId === null || dragId === targetId || !products) return;
    const from = products.findIndex((p) => p.id === dragId);
    const to = products.findIndex((p) => p.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...products];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setProducts(next);
    try {
      await api.post('/products/sort', { order: next.map((p) => p.id) });
      toast.success('Menu order saved');
    } catch {
      toast.error('Could not save order');
      await load();
    } finally {
      setDragId(null);
      setOverId(null);
    }
  };

  return (
    <div className="oms-page">
      <PageHeader
        title={t('pages.products')}
        desc={t('pages.productsDesc')}
        actions={
          <>
            <Button variant="outline" size="sm" icon="⬆" onClick={() => setImportOpen(true)}>
              {t('pages.importCsv')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setBulkOpen((o) => !o)} disabled={selected.length === 0}>
              Bulk edit {selected.length > 0 ? `(${selected.length})` : ''}
            </Button>
          </>
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

      {bulkOpen && selected.length > 0 && (
        <Card title="Bulk edit" subtitle={`${selected.length} items selected — price, stock, status and tags in one request.`}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 14, alignItems: 'end' }}>
            <Field label="New price (Tk)" hint="Leave empty to keep">
              <Input type="number" min="0" step="0.01" placeholder="e.g. 250" value={bulk.price} onChange={(e) => setBulk((b) => ({ ...b, price: e.target.value }))} />
            </Field>
            <Field label="Stock quantity" hint="Sets every selected item">
              <Input type="number" min="0" placeholder="e.g. 40" value={bulk.stock} onChange={(e) => setBulk((b) => ({ ...b, stock: e.target.value }))} />
            </Field>
            <Field label="Status">
              <Select value={bulk.enabled} onChange={(e) => setBulk((b) => ({ ...b, enabled: e.target.value }))}>
                <option value="">Keep as-is</option>
                <option value="true">Available</option>
                <option value="false">Hidden</option>
              </Select>
            </Field>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="primary" size="sm" loading={bulkSaving} onClick={applyBulk}>Apply</Button>
              <Button variant="ghost" size="sm" onClick={() => setBulkOpen(false)}>Cancel</Button>
            </div>
          </div>
          <Field label="Add tags to all selected">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {ITEM_TAGS.map((tag) => (
                <Checkbox
                  key={tag}
                  id={`bulk-tag-${tag}`}
                  label={tag}
                  checked={bulk.tags.includes(tag)}
                  onChange={() => setBulk((b) => ({ ...b, tags: b.tags.includes(tag) ? b.tags.filter((x) => x !== tag) : [...b.tags, tag] }))}
                />
              ))}
            </div>
          </Field>
        </Card>
      )}

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
              empty={{
                icon: <EmojiIcon>🍽️</EmojiIcon>,
                title: 'No products yet',
                description: 'Add your first product to start taking orders.',
              }}
            >
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
                  </th>
                  <th style={{ width: 30 }} />
                  <th>Product</th>
                  <th>Tags</th>
                  <th className="oms-table__num">Price</th>
                  <th className="oms-table__num">Weight</th>
                  <th className="oms-table__num">Stock</th>
                  <th>Status</th>
                  <th className="oms-table__num">Actions</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr
                    key={p.id}
                    draggable
                    onDragStart={() => setDragId(p.id)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (overId !== p.id) setOverId(p.id);
                    }}
                    onDragLeave={() => setOverId((o) => (o === p.id ? null : o))}
                    onDrop={(e) => {
                      e.preventDefault();
                      onDropRow(p.id);
                    }}
                    style={{
                      cursor: 'grab',
                      opacity: dragId === p.id ? 0.5 : 1,
                      outline: overId === p.id ? '2px dashed var(--oms-accent, #b45309)' : 'none',
                    }}
                  >
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.includes(p.id)}
                        onChange={() => toggleSelect(p.id)}
                        aria-label={`Select ${p.name}`}
                      />
                    </td>
                    <td style={{ color: 'var(--text-muted)' }} title="Drag to reorder">⠿</td>
                    <td>
                      <span className="oms-table__cell-strong">{p.name}</span>
                      {p.tags?.length > 0 && (
                        <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)' }}>
                          {p.tags.join(' · ')}
                        </span>
                      )}
                    </td>
                    <td>
                      {(p.tags || []).slice(0, 3).map((tag) => (
                        <Badge key={tag} tone={tag === 'veg' ? 'success' : tag === 'spicy' ? 'danger' : 'neutral'}>
                          {tag}
                        </Badge>
                      ))}
                    </td>
                    <td className="oms-table__num">
                      <span className="oms-table__cell-strong">৳ {Number(p.price).toFixed(2)}</span>
                    </td>
                    <td className="oms-table__num">{p.weight_gm} gm</td>
                    <td className="oms-table__num">
                      <StockCell p={p} />
                    </td>
                    <td>
                      {p.enabled ? <Badge tone="success">Available</Badge> : <Badge tone="neutral">Hidden</Badge>}
                    </td>
                    <td className="oms-table__num">
                      <div className="oms-table__actions">
                        <Button variant="ghost" size="sm" onClick={() => setEditing({ ...p, inventory: p.inventory || { stock_qty: 0, low_stock_at: 0, unit: 'pcs' } })}>
                          Edit
                        </Button>
                        <Button variant="danger-ghost" size="sm" onClick={() => onDelete(p)}>
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {products !== null && products.length > 0 && (
            <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-muted)', borderTop: '1px solid var(--oms-border)' }}>
              Drag ⠿ to reorder the menu — the storefront follows instantly.
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function StockCell({ p }) {
  const inv = p.inventory;
  const qty = Number(inv?.stock_qty ?? 0);
  const low = Number(inv?.low_stock_at ?? 0);
  const isLow = low > 0 && qty <= low;
  if (isLow) return <Badge tone="danger">{qty} {inv?.unit || 'pcs'} · Low</Badge>;
  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{qty} {inv?.unit || 'pcs'}</span>;
}

function EmojiIcon({ children }) {
  return <span style={{ fontSize: 22 }}>{children}</span>;
}
