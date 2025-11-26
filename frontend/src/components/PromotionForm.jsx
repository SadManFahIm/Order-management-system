import React, { useState } from 'react';

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
  };

  return (
    <form onSubmit={submit} style={{ border: '1px solid #e5e7eb', padding: 8 }}>
      <input
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <br />
      <label>Type </label>
      <select value={type} onChange={(e) => setType(e.target.value)}>
        <option value="percentage">Percentage</option>
        <option value="fixed">Fixed</option>
        <option value="weighted">Weighted</option>
      </select>
      <br />
      {type === 'percentage' && (
        <>
          <label>Percentage %</label>
          <input
            type="number"
            value={percentage}
            onChange={(e) => setPercentage(e.target.value)}
          />
          <br />
        </>
      )}
      {type === 'fixed' && (
        <>
          <label>Fixed Tk</label>
          <input
            type="number"
            value={fixed}
            onChange={(e) => setFixed(e.target.value)}
          />
          <br />
        </>
      )}
      {type === 'weighted' && (
        <>
          <button type="button" onClick={addSlab}>
            Add slab
          </button>
          {slabs.map((sl, idx) => (
            <div key={idx} style={{ border: '1px solid #ddd', marginTop: 4 }}>
              <div>
                Min wt (gm)
                <input
                  type="number"
                  value={sl.min_weight_gm}
                  onChange={(e) =>
                    updateSlab(idx, 'min_weight_gm', e.target.value)
                  }
                />
              </div>
              <div>
                Max wt (gm)
                <input
                  type="number"
                  value={sl.max_weight_gm}
                  onChange={(e) =>
                    updateSlab(idx, 'max_weight_gm', e.target.value)
                  }
                />
              </div>
              <div>
                Discount per 500gm
                <input
                  type="number"
                  value={sl.discount_per_500gm}
                  onChange={(e) =>
                    updateSlab(idx, 'discount_per_500gm', e.target.value)
                  }
                />
              </div>
            </div>
          ))}
        </>
      )}
      <br />
      <label>Start</label>
      <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
      <br />
      <label>End</label>
      <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
      <br />
      <label>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Enabled
      </label>
      <br />
      <button type="submit">Create promotion</button>
    </form>
  );
}
