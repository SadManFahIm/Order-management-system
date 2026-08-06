import { useState } from 'react';
import { Field, Input, Select, Checkbox, Button } from './ui';

export default function PromotionForm({ onCreate }) {
  const [type, setType] = useState('percentage');
  const [title, setTitle] = useState('');
  const [percentage, setPercentage] = useState(10);
  const [fixed, setFixed] = useState(10);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [slabs, setSlabs] = useState([]);

  const addSlab = () => {
    setSlabs((s) => [
      ...s,
      { min_weight_gm: 1000, max_weight_gm: 5500, discount_per_500gm: 2 }
    ]);
  };

  const updateSlab = (idx, field, value) => {
    setSlabs((s) =>
      s.map((sl, i) => (i === idx ? { ...sl, [field]: Number(value) } : sl))
    );
  };

  const submit = (e) => {
    e.preventDefault();
    const payload = {
      title,
      type,
      start_date: start,
      end_date: end,
      enabled
    };
    if (type === 'percentage') payload.percentage_value = Number(percentage);
    if (type === 'fixed') payload.fixed_value = Number(fixed);
    if (type === 'weighted') payload.slabs = slabs;
    onCreate(payload);
    setTitle('');
    setStart('');
    setEnd('');
    setSlabs([]);
  };

  return (
    <form onSubmit={submit}>
      <Field label="Title">
        <Input placeholder="e.g. Winter Mega Deal" value={title} onChange={(e) => setTitle(e.target.value)} required />
      </Field>
      <Field label="Type">
        <Select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="percentage">Percentage discount</option>
          <option value="fixed">Fixed amount (Tk)</option>
          <option value="weighted">Weighted (slabs)</option>
        </Select>
      </Field>

      {type === 'percentage' && (
        <Field label="Percentage off">
          <Input type="number" min="0" max="100" value={percentage} onChange={(e) => setPercentage(e.target.value)} />
        </Field>
      )}
      {type === 'fixed' && (
        <Field label="Fixed amount (Tk)">
          <Input type="number" min="0" step="0.01" value={fixed} onChange={(e) => setFixed(e.target.value)} />
        </Field>
      )}
      {type === 'weighted' && (
        <Field label="Weight slabs" hint="Discount per 500 gm within each weight band.">
          <Button type="button" variant="outline" size="sm" onClick={addSlab}>
            + Add slab
          </Button>
          <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
            {slabs.map((sl, idx) => (
              <div key={idx} className="oms-slab">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <Input
                    type="number"
                    placeholder="Min (gm)"
                    value={sl.min_weight_gm}
                    onChange={(e) => updateSlab(idx, 'min_weight_gm', e.target.value)}
                  />
                  <Input
                    type="number"
                    placeholder="Max (gm)"
                    value={sl.max_weight_gm}
                    onChange={(e) => updateSlab(idx, 'max_weight_gm', e.target.value)}
                  />
                </div>
                <div style={{ marginTop: 8 }}>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="Discount per 500 gm (Tk)"
                    value={sl.discount_per_500gm}
                    onChange={(e) => updateSlab(idx, 'discount_per_500gm', e.target.value)}
                  />
                </div>
              </div>
            ))}
          </div>
        </Field>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="Start date">
          <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
        </Field>
        <Field label="End date">
          <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} required />
        </Field>
      </div>

      <Field>
        <Checkbox label="Enabled immediately" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
      </Field>

      <div className="oms-form-actions">
        <Button type="submit" variant="primary">
          Create promotion
        </Button>
      </div>
    </form>
  );
}
