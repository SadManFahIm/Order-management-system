import { useEffect, useRef, useState } from 'react';
import api from '../api';
import {
  PageHeader,
  Card,
  Table,
  Button,
  Badge,
  Skeleton,
  Modal,
  Input,
  Field,
  useToast,
} from '../components/ui';

/**
 * Menu manager (Phase 4) — Wolt/Deliveroo style.
 *  - Left: category tree (create/rename/delete, drag-order via sort order)
 *  - Right: products grouped by category, with a detail modal for
 *    variants (size/price adjustments) and add-ons (paid extras).
 */

export default function MenuPage() {
  const [categories, setCategories] = useState(null);
  const [products, setProducts] = useState(null);
  const [catModal, setCatModal] = useState(null); // { mode: 'create'|'edit', category? }
  const [detail, setDetail] = useState(null); // { product, variants, addons }
  const [detailLoading, setDetailLoading] = useState(false);
  const toast = useToast();

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    loadAll();
    return () => { mounted.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAll = async () => {
    try {
      const [cats, prods] = await Promise.all([
        api.get('/menu/categories'),
        api.get('/products'),
      ]);
      if (!mounted.current) return;
      setCategories(cats.data);
      setProducts(prods.data);
    } catch {
      if (mounted.current) {
        setCategories([]);
        setProducts([]);
        toast?.error('Failed to load the menu');
      }
    }
  };

  const openDetail = async (product) => {
    setDetailLoading(true);
    setDetail({ product, variants: [], addons: [] });
    try {
      const [variants, addons] = await Promise.all([
        api.get(`/menu/products/${product.id}/variants`),
        api.get(`/menu/products/${product.id}/addons`),
      ]);
      if (!mounted.current) return;
      setDetail({ product, variants: variants.data, addons: addons.data });
    } catch {
      toast.error('Failed to load item details');
    } finally {
      if (mounted.current) setDetailLoading(false);
    }
  };

  const saveCategory = async (payload) => {
    if (catModal.mode === 'edit') {
      await api.put(`/menu/categories/${catModal.category.id}`, payload);
      toast.success('Category updated');
    } else {
      await api.post('/menu/categories', payload);
      toast.success('Category created');
    }
    setCatModal(null);
    await loadAll();
  };

  const deleteCategory = async (category) => {
    await api.delete(`/menu/categories/${category.id}`);
    toast.success('Category deleted');
    await loadAll();
  };

  const addVariant = async (name, priceAdjustment) => {
    await api.post(`/menu/products/${detail.product.id}/variants`, {
      name,
      priceAdjustment,
    });
    toast.success('Variant added');
    await openDetail(detail.product);
  };

  const addAddon = async (name, price) => {
    await api.post(`/menu/products/${detail.product.id}/addons`, { name, price });
    toast.success('Add-on added');
    await openDetail(detail.product);
  };

  const removeVariant = async (id) => {
    await api.delete(`/menu/variants/${id}`);
    toast.success('Variant removed');
    await openDetail(detail.product);
  };

  const removeAddon = async (id) => {
    await api.delete(`/menu/addons/${id}`);
    toast.success('Add-on removed');
    await openDetail(detail.product);
  };

  const byCategory = (id) => (products ?? []).filter((p) => p.category_id === id);

  return (
    <div className="oms-page">
      <PageHeader
        title="Menu"
        desc="Structure your menu with categories, sizes and add-ons — just like the big delivery apps."
        actions={
          <Button onClick={() => setCatModal({ mode: 'create' })}>New category</Button>
        }
      />

      {categories === null ? (
        <Card>
          <div style={{ padding: 24, display: 'grid', gap: 12 }}>
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} height={42} />
            ))}
          </div>
        </Card>
      ) : (
        <div className="oms-grid oms-grid--2col">
          {/* ── Categories ── */}
          <Card title="Categories" subtitle={`${categories.length} in this workspace`} bodyPadding={false}>
            <Table
              columns={[
                { key: 'name', label: 'Category' },
                { key: 'items', label: 'Items', align: 'right' },
                { key: 'actions', label: '', align: 'right' },
              ]}
              rows={categories}
              render={(c, key) => {
                if (key === 'name') return <span className="oms-table__cell-strong">{c.name}</span>;
                if (key === 'items') {
                  const n = byCategory(c.id).length;
                  return n > 0 ? <Badge tone="accent">{n}</Badge> : <span style={{ color: 'var(--text-muted)' }}>—</span>;
                }
                if (key === 'actions')
                  return (
                    <div className="oms-table__actions">
                      <Button variant="ghost" size="sm" onClick={() => setCatModal({ mode: 'edit', category: c })}>
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        tone="danger"
                        onClick={() => deleteCategory(c)}
                      >
                        Delete
                      </Button>
                    </div>
                  );
                return c[key];
              }}
              empty={{
                title: 'No categories yet',
                description: 'Create one to group your items, e.g. “Burgers” or “Drinks”.',
              }}
            />
          </Card>

          {/* ── Items grouped by category ── */}
          <Card title="Menu items" subtitle="Grouped by category — click an item to manage sizes & extras" bodyPadding={false}>
            {products?.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: 26 }}>🍽️</div>
                <p>Add products on the Products page first.</p>
              </div>
            ) : (
              <div style={{ padding: 16, display: 'grid', gap: 20 }}>
                {categories.map((c) => {
                  const items = byCategory(c.id);
                  if (items.length === 0 && c.parent_id) return null;
                  return (
                    <div key={c.id}>
                      <div className="oms-menu-group">
                        <span>{c.name}</span>
                        <Badge tone="neutral">{items.length}</Badge>
                      </div>
                      <div style={{ display: 'grid', gap: 8 }}>
                        {items.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            className="oms-menu-item"
                            onClick={() => openDetail(p)}
                          >
                            <span className="oms-menu-item__name">{p.name}</span>
                            <span className="oms-menu-item__meta">
                              {p.prep_minutes ? `${p.prep_minutes} min` : '—'}
                            </span>
                            <span className="oms-menu-item__price">৳ {Number(p.price).toFixed(0)}</span>
                            <span className="oms-menu-item__arrow">›</span>
                          </button>
                        ))}
                        {items.length === 0 && (
                          <div className="oms-menu-empty">No items in this category yet.</div>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div style={{ display: 'grid', gap: 8 }}>
                  <div className="oms-menu-group">
                    <span>Uncategorized</span>
                    <Badge tone="neutral">{byCategory(null).length}</Badge>
                  </div>
                  {byCategory(null).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="oms-menu-item"
                      onClick={() => openDetail(p)}
                    >
                      <span className="oms-menu-item__name">{p.name}</span>
                      <span className="oms-menu-item__price">৳ {Number(p.price).toFixed(0)}</span>
                      <span className="oms-menu-item__arrow">›</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ── Category create/edit modal ── */}
      {catModal && (
        <CategoryModal
          mode={catModal.mode}
          category={catModal.category}
          onSave={saveCategory}
          onClose={() => setCatModal(null)}
        />
      )}

      {/* ── Item detail modal ── */}
      {detail && (
        <ItemDetailModal
          detail={detail}
          loading={detailLoading}
          onAddVariant={addVariant}
          onAddAddon={addAddon}
          onRemoveVariant={removeVariant}
          onRemoveAddon={removeAddon}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

function CategoryModal({ mode, category, onSave, onClose }) {
  const [name, setName] = useState(category?.name ?? '');
  const [sortOrder, setSortOrder] = useState(category?.sort_order ?? 0);

  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({ name: name.trim(), sortOrder: Number(sortOrder) || 0 });
  };

  return (
    <Modal open title={mode === 'edit' ? 'Rename category' : 'New category'} onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'grid', gap: 16 }}>
        <Field label="Name">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Burgers" />
        </Field>
        <Field label="Sort order" hint="Lower numbers appear first">
          <Input
            type="number"
            min={0}
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
          />
        </Field>
        <div className="oms-modal__actions">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={!name.trim()}>
            {mode === 'edit' ? 'Save changes' : 'Create category'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ItemDetailModal({ detail, loading, onAddVariant, onAddAddon, onRemoveVariant, onRemoveAddon, onClose }) {
  const [vName, setVName] = useState('');
  const [vPrice, setVPrice] = useState(0);
  const [aName, setAName] = useState('');
  const [aPrice, setAPrice] = useState(0);

  const submitVariant = (e) => {
    e.preventDefault();
    if (!vName.trim()) return;
    onAddVariant(vName.trim(), Number(vPrice) || 0);
    setVName('');
    setVPrice(0);
  };

  const submitAddon = (e) => {
    e.preventDefault();
    if (!aName.trim()) return;
    onAddAddon(aName.trim(), Number(aPrice) || 0);
    setAName('');
    setAPrice(0);
  };

  return (
    <Modal
      open
      width={720}
      title={detail.product.name}
      description={`৳ ${Number(detail.product.price).toFixed(0)} · ${detail.product.prep_minutes ? `${detail.product.prep_minutes} min prep` : 'no prep time'}`}
      onClose={onClose}
    >
      <div className="oms-item-detail">
        <div>
          <h4 className="oms-item-detail__heading">Sizes / variants</h4>
          {loading ? (
            <div style={{ display: 'grid', gap: 8 }}>
              <Skeleton height={28} /><Skeleton height={28} />
            </div>
          ) : detail.variants.length === 0 ? (
            <p className="oms-item-detail__none">No variants — item has a single size.</p>
          ) : (
            detail.variants.map((v) => (
              <div key={v.id} className="oms-item-detail__row">
                <span>{v.name}</span>
                <span className="oms-item-detail__delta">
                  {v.price_adjustment > 0 ? `+৳ ${v.price_adjustment}` : 'included'}
                </span>
                <button
                  type="button"
                  className="oms-item-detail__remove"
                  onClick={() => onRemoveVariant(v.id)}
                  aria-label={`Remove ${v.name}`}
                >
                  ×
                </button>
              </div>
            ))
          )}
          <form onSubmit={submitVariant} className="oms-item-detail__form">
            <Input
              placeholder="e.g. Large"
              value={vName}
              onChange={(e) => setVName(e.target.value)}
              style={{ flex: 1 }}
            />
            <Input
              type="number"
              min={0}
              placeholder="+৳"
              value={vPrice}
              onChange={(e) => setVPrice(e.target.value)}
              style={{ width: 76 }}
            />
            <Button size="sm" type="submit" disabled={!vName.trim()}>Add</Button>
          </form>
        </div>

        <div>
          <h4 className="oms-item-detail__heading">Add-ons</h4>
          {loading ? (
            <div style={{ display: 'grid', gap: 8 }}>
              <Skeleton height={28} /><Skeleton height={28} />
            </div>
          ) : detail.addons.length === 0 ? (
            <p className="oms-item-detail__none">No add-ons — extras like cheese or sauce go here.</p>
          ) : (
            detail.addons.map((a) => (
              <div key={a.id} className="oms-item-detail__row">
                <span>{a.name}</span>
                <span className="oms-item-detail__delta">৳ {a.price}</span>
                <button
                  type="button"
                  className="oms-item-detail__remove"
                  onClick={() => onRemoveAddon(a.id)}
                  aria-label={`Remove ${a.name}`}
                >
                  ×
                </button>
              </div>
            ))
          )}
          <form onSubmit={submitAddon} className="oms-item-detail__form">
            <Input
              placeholder="e.g. Extra cheese"
              value={aName}
              onChange={(e) => setAName(e.target.value)}
              style={{ flex: 1 }}
            />
            <Input
              type="number"
              min={0}
              placeholder="৳"
              value={aPrice}
              onChange={(e) => setAPrice(e.target.value)}
              style={{ width: 76 }}
            />
            <Button size="sm" type="submit" disabled={!aName.trim()}>Add</Button>
          </form>
        </div>
      </div>

      <div className="oms-modal__actions">
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}
